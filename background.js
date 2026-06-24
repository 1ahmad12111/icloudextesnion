importScripts('randomizer.js');
importScripts('id-randomizer.js');

let stopRequested = false;
let mailTabId = null;
let debuggerAttached = false;

// ── Persistent dashboard window ───────────────────────────────────────────────
// The popup is opened as a standalone window (not default_popup) so it stays
// open across send sessions and survives losing focus.

let popupWindowId = null;

chrome.action.onClicked.addListener(async () => {
  if (popupWindowId !== null) {
    try { await chrome.windows.update(popupWindowId, { focused: true }); return; }
    catch (_) { popupWindowId = null; }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 520,
    height: 780,
    focused: true,
  }).catch(() => null);
  if (win) popupWindowId = win.id;
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === popupWindowId) popupWindowId = null;
});

// ── Log buffer (survives popup close/reopen) ──────────────────────────────────

const LOG_BUFFER = [];
const LOG_BUFFER_MAX = 300;
let sendInProgress = false;
let sendSent = 0;
let sendTotal = 0;

function broadcast(msg) {
  if (msg.type === 'log' || msg.type === 'progress' || msg.type === 'done' || msg.type === 'chunkCountdown') {
    LOG_BUFFER.push(msg);
    if (LOG_BUFFER.length > LOG_BUFFER_MAX) LOG_BUFFER.shift();
  }
  if (msg.type === 'progress') { sendSent = msg.sent; sendTotal = msg.total; }
  if (msg.type === 'done')     { sendInProgress = false; }
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Service-worker keepalive ──────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'swKeepAlive') {
    chrome.storage.local.get('__ka', () => {});
  }
});

function startKeepAlive() {
  chrome.alarms.create('swKeepAlive', { periodInMinutes: 25 / 60 });
}

function stopKeepAlive() {
  chrome.alarms.clear('swKeepAlive');
}

// Reset flag whenever Chrome auto-detaches (tab moved to new window, navigated, etc.)
chrome.debugger.onDetach.addListener(() => {
  debuggerAttached = false;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getStatus') {
    sendResponse({
      inProgress: sendInProgress,
      sent:       sendSent,
      total:      sendTotal,
      logs:       LOG_BUFFER.slice(),
    });
    return true;
  }
  if (msg.action === 'startSending') {
    stopRequested = false;
    sendInProgress = true;
    LOG_BUFFER.length = 0; // fresh buffer for each new run
    runSendLoop(msg);
    sendResponse({ ok: true });
  }
  if (msg.action === 'stop') {
    stopRequested = true;
    detachDebugger();
    stopKeepAlive();
  }
});

// ── Debugger (trusted key events) ────────────────────────────────────────────

async function attachDebugger(tabId) {
  if (debuggerAttached) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerAttached = true;
}

async function detachDebugger() {
  if (!debuggerAttached || !mailTabId) return;
  try { await chrome.debugger.detach({ tabId: mailTabId }); } catch (_) {}
  debuggerAttached = false;
}

// Chrome can silently evict a debugger session (tab crash-recovery, memory
// pressure, internal hot-reload) without always firing onDetach.  Call this
// before any debugger command so we always hold a live session.
async function ensureDebugger() {
  if (debuggerAttached) return;
  try {
    await chrome.debugger.attach({ tabId: mailTabId }, '1.3');
    debuggerAttached = true;
    broadcast({ type: 'log', text: 'Debugger re-attached.', level: 'info' });
  } catch(e) {
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('already')) {
      // Chrome says already attached — treat the session as live
      debuggerAttached = true;
    } else {
      throw new Error('Could not re-attach debugger: ' + e.message);
    }
  }
}

async function sendDebuggerType(tabId, text) {
  await ensureDebugger();
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
  } catch(e) {
    // Session was dead even though flag said true — reset and retry once
    debuggerAttached = false;
    await ensureDebugger();
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
  }
}

async function sendDebuggerEnter(tabId) {
  await ensureDebugger();
  const base = { modifiers: 0, key: 'Enter', code: 'Enter', keyCode: 13,
    nativeVirtualKeyCode: 13, autoRepeat: false, isKeypad: false, isSystemKey: false };
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await sleep(60);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  } catch(e) {
    debuggerAttached = false;
    await ensureDebugger();
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await sleep(60);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
}

// Press Tab via debugger — used after fillSubject to nudge iCloud into
// creating the mail2-rte body iframe (it loads lazily on body focus).
async function sendDebuggerTab(tabId) {
  await ensureDebugger();
  const base = { modifiers: 0, key: 'Tab', code: 'Tab', keyCode: 9,
    nativeVirtualKeyCode: 9, autoRepeat: false, isKeypad: false, isSystemKey: false };
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await sleep(60);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  } catch(e) {
    debuggerAttached = false;
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runSendLoop({ emails, subjects, bodies, isHtml, delay, batchSize, randomize, entityEncode, entityRate, idRandomize, idDetected, fixedDateIso, chunkEnabled, chunkSize, chunkDelay }) {
  const total = emails.length;
  batchSize  = batchSize  || 10;
  chunkSize  = chunkSize  || 10;
  chunkDelay = chunkDelay || 5;

  resetEmailDedup();
  startKeepAlive();
  broadcast({ type: 'log', text: 'Starting - ' + total + ' emails, ' + delay + 's delay.', level: 'info' });
  if (chunkEnabled)
    broadcast({ type: 'log', text: 'Chunk mode ON — ' + Math.ceil(total / chunkSize) + ' chunks of ' + chunkSize + ', ' + chunkDelay + 's pause between chunks.', level: 'info' });
  if (subjects.length > 1)
    broadcast({ type: 'log', text: subjects.length + ' subject lines loaded — will rotate every batch.', level: 'info' });
  if (randomize)
    broadcast({ type: 'log', text: 'HTML randomizer ON — structural mutations per email.', level: 'info' });
  if (idRandomize)
    broadcast({ type: 'log', text: 'ID randomizer ON — Transaction ID, Invoice ID, date and email randomized per email.', level: 'info' });
  if (entityEncode)
    broadcast({ type: 'log', text: 'Entity encoding ON — applied at send time at ' + Math.round((entityRate || 0) * 100) + '% rate.', level: 'info' });

  let sent = 0;

  mailTabId = await getOrOpenMailTab();

  try {
    await attachDebugger(mailTabId);
    broadcast({ type: 'log', text: 'Debugger attached.', level: 'info' });
  } catch(e) {
    broadcast({ type: 'log', text: 'Debugger attach failed: ' + e.message, level: 'err' });
  }

  broadcast({ type: 'log', text: 'Waiting for iCloud Mail to load...', level: 'info' });
  await sleep(3000);

  // Inject content script with a unique run ID so stale instances self-unload
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: mailTabId, allFrames: true },
      files: ['content.js']
    });
  } catch(e) {}
  // Tell content scripts their run ID so old listeners unregister on the next inject
  try {
    await chrome.tabs.sendMessage(mailTabId, { action: 'init', runId });
  } catch(e) {}
  await sleep(1000);

  const mailFrameId = await findMailFrame();
  if (mailFrameId === null) {
    broadcast({ type: 'log', text: 'Could not find iCloud Mail UI frame. Are you logged in?', level: 'err' });
    broadcast({ type: 'done', sent: 0, total });
    return;
  }
  broadcast({ type: 'log', text: 'Found mail UI in frame ' + mailFrameId + '!', level: 'ok' });

  // Build list of work items
  const groups = [];
  if (chunkEnabled) {
    for (let i = 0; i < emails.length; i += chunkSize) {
      groups.push(emails.slice(i, i + chunkSize));
    }
  } else {
    emails.forEach(e => groups.push([e]));
  }
  const totalGroups = groups.length;

  for (let gi = 0; gi < groups.length; gi++) {
    if (stopRequested) break;
    const group = groups[gi];

    broadcast({ type: 'log', text: chunkEnabled
      ? 'Chunk ' + (gi + 1) + '/' + totalGroups + ' — sending to ' + group.length + ' recipients...'
      : 'Sending to ' + group[0] + '...',
      level: 'info' });

    try {
      // Rotate subject and HTML version by group index
      const subjectIndex = Math.floor(gi / batchSize) % subjects.length;
      const subject = subjects[subjectIndex];
      if (subjects.length > 1)
        broadcast({ type: 'log', text: 'Subject #' + (subjectIndex + 1) + ': "' + subject + '"', level: 'info' });

      const versionIndex = Math.floor(gi / batchSize) % bodies.length;
      let body = bodies[versionIndex];
      if (bodies.length > 1)
        broadcast({ type: 'log', text: 'HTML version ' + (versionIndex + 1) + ' of ' + bodies.length + '.', level: 'info' });

      if (randomize && isHtml) {
        body = randomizeHtml(body);
        broadcast({ type: 'log', text: 'HTML randomized.', level: 'info' });
      }

      if (idRandomize && idDetected) {
        const { out, log } = randomizeIds(body, idDetected, fixedDateIso);
        body = out;
        log.forEach(l => broadcast({ type: 'log', text: l, level: 'info' }));
      }

      // Step 0: Close any stale compose dialog from a previous iteration
      await sendToFrame(mailFrameId, { action: 'closeCompose' });
      await sleep(400);

      // Step 1: Open compose — focus To field
      const composeResult = await sendToFrame(mailFrameId, { action: 'openCompose', to: group[0] });
      if (composeResult && composeResult.error) throw new Error(composeResult.error);
      broadcast({ type: 'log', text: 'Compose open, To focused.', level: 'info' });

      // Step 2: Explicitly re-focus To field then type all recipients via debugger
      // Extra delay + re-focus prevents typing landing in the wrong field
      await sleep(500);
      await sendToFrame(mailFrameId, { action: 'focusToField' });
      await sleep(300);

      for (const toEmail of group) {
        await sendDebuggerType(mailTabId, toEmail);
        await sleep(350);
        await sendDebuggerEnter(mailTabId);
        broadcast({ type: 'log', text: 'Added: ' + toEmail, level: 'info' });
        await sleep(250);
      }
      broadcast({ type: 'log', text: group.length + ' recipient(s) confirmed.', level: 'info' });

      // Step 3: Fill Subject
      await sleep(800);
      const subjectResult = await sendToFrame(mailFrameId, { action: 'fillSubject', subject });
      if (subjectResult && subjectResult.error) throw new Error(subjectResult.error);
      broadcast({ type: 'log', text: 'Subject filled.', level: 'info' });

      // Nudge iCloud into creating the mail2-rte body iframe — it loads lazily
      // only when something focuses the body area.  A Tab keypress from the
      // Subject field reliably triggers that focus transition.
      await sleep(300);
      await sendDebuggerTab(mailTabId);
      await sleep(400);

      // Replace {EMAIL} placeholder with the first recipient's address
      body = body.replace(/\{EMAIL\}/gi, group[0]);

      // Apply entity encoding last — after all substitutions
      if (entityEncode && isHtml) {
        body = applyEntityEncoding(body, entityRate || 0.4);
        broadcast({ type: 'log', text: 'Entity encoding applied.', level: 'info' });
      }

      // Step 4: Find RTE iframe and fill body (10 s timeout — iCloud can be slow)
      const rteFrameId = await findRteFrame(10000);
      if (rteFrameId === null) throw new Error('Body editor iframe not found');
      broadcast({ type: 'log', text: 'RTE frame found: ' + rteFrameId, level: 'info' });

      const bodyResult = await sendToFrame(rteFrameId, { action: 'fillBody', body, isHtml });
      if (bodyResult && bodyResult.error) throw new Error(bodyResult.error);
      broadcast({ type: 'log', text: 'Body filled.', level: 'info' });

      await sleep(500);

      // Step 5: Click Send
      const sendResult = await sendToFrame(mailFrameId, { action: 'clickSend' });
      if (sendResult && sendResult.error) throw new Error(sendResult.error);

      sent += group.length;
      broadcast({ type: 'progress', sent: Math.min(sent, total), total });
      broadcast({ type: 'log', text: '✓ Sent to ' + group.join(', '), level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: '✗ Failed for chunk ' + (gi + 1) + ': ' + err.message, level: 'err' });
    }

    if (!stopRequested && gi < groups.length - 1) {
      if (chunkEnabled) {
        broadcast({ type: 'log', text: '— Chunk ' + (gi + 1) + '/' + totalGroups + ' done. Pausing ' + chunkDelay + 's...', level: 'info' });
        const chunkMs  = chunkDelay * 1000;
        const chunkEnd = Date.now() + chunkMs;
        while (Date.now() < chunkEnd) {
          if (stopRequested) break;
          const remaining = Math.ceil((chunkEnd - Date.now()) / 1000);
          broadcast({ type: 'chunkCountdown', remaining, chunkDelay });
          await sleep(Math.min(1000, chunkEnd - Date.now()));
        }
      } else {
        broadcast({ type: 'log', text: 'Waiting ' + delay + 's...', level: 'info' });
        await sleep(delay * 1000);
      }
    }
  }

  await detachDebugger();
  stopKeepAlive();
  broadcast({ type: 'done', sent, total });
}

// ── Frame helpers ─────────────────────────────────────────────────────────────

async function findMailFrame() {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => null);
  if (!frames) {
    const result = await sendToFrame(0, { action: 'ping' });
    return (result && result.ok) ? 0 : null;
  }
  for (const frame of frames) {
    const result = await sendToFrame(frame.frameId, { action: 'ping' });
    if (result && result.hasMailUI) return frame.frameId;
  }
  return null;
}

async function findRteFrame(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => []);
    for (const frame of frames) {
      if (frame.url && frame.url.includes('mail2-rte')) {
        const result = await sendToFrame(frame.frameId, { action: 'ping' });
        if (result && result.ok) return frame.frameId;
      }
    }
    await sleep(300);
  }
  return null;
}

function sendToFrame(frameId, msg) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);
    chrome.tabs.sendMessage(mailTabId, msg, { frameId }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getOrOpenMailTab() {
  const allTabs = await chrome.tabs.query({ url: 'https://www.icloud.com/*' });
  const mailTab = allTabs.find(t => t.url && (
    t.url.includes('/mail') || t.url.includes('mail2')
  ));
  if (mailTab) {
    broadcast({ type: 'log', text: 'Found iCloud Mail tab (id ' + mailTab.id + ').', level: 'info' });
    const win = await chrome.windows.get(mailTab.windowId).catch(() => null);
    if (win && win.type === 'popup') {
      await chrome.windows.update(mailTab.windowId, { state: 'normal' }).catch(() => {});
    } else {
      await detachDebugger();
      const popup = await chrome.windows.create({
        tabId: mailTab.id,
        type: 'popup',
        width: 900,
        height: 700,
        focused: false,
      }).catch(() => null);
      if (!popup) await chrome.tabs.update(mailTab.id, { active: true });
      await sleep(1000);
    }
    return mailTab.id;
  }
  broadcast({ type: 'log', text: 'No iCloud Mail tab found — opening one...', level: 'info' });
  const popup = await chrome.windows.create({
    url: 'https://www.icloud.com/mail/',
    type: 'popup',
    width: 900,
    height: 700,
    focused: false,
  }).catch(() => null);
  if (popup && popup.tabs && popup.tabs[0]) {
    await sleep(6000);
    return popup.tabs[0].id;
  }
  const tab = await chrome.tabs.create({ url: 'https://www.icloud.com/mail/' });
  await sleep(6000);
  return tab.id;
}
