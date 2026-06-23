importScripts('randomizer.js');
importScripts('id-randomizer.js');

let stopRequested = false;
let mailTabId = null;
let debuggerAttached = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startSending') {
    stopRequested = false;
    runSendLoop(msg);
    sendResponse({ ok: true });
  }
  if (msg.action === 'stop') {
    stopRequested = true;
    detachDebugger();
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

async function sendDebuggerType(tabId, text) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

async function sendDebuggerEnter(tabId) {
  const base = { modifiers: 0, key: 'Enter', code: 'Enter', keyCode: 13,
    nativeVirtualKeyCode: 13, autoRepeat: false, isKeypad: false, isSystemKey: false };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sleep(60);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runSendLoop({ emails, subjects, bodies, isHtml, delay, batchSize, randomize, idRandomize, idDetected, fixedDateIso, chunkEnabled, chunkSize, chunkDelay }) {
  const total = emails.length;
  batchSize  = batchSize  || 10;
  chunkSize  = chunkSize  || 10;
  chunkDelay = chunkDelay || 5;

  broadcast({ type: 'log', text: 'Starting - ' + total + ' emails, ' + delay + 's delay.', level: 'info' });
  if (chunkEnabled)
    broadcast({ type: 'log', text: 'Chunk mode ON — ' + Math.ceil(total / chunkSize) + ' chunks of ' + chunkSize + ', ' + chunkDelay + 's pause between chunks.', level: 'info' });
  if (subjects.length > 1)
    broadcast({ type: 'log', text: subjects.length + ' subject lines loaded — will rotate every batch.', level: 'info' });
  if (randomize)
    broadcast({ type: 'log', text: 'HTML randomizer ON — structural mutations per email.', level: 'info' });
  if (idRandomize)
    broadcast({ type: 'log', text: 'ID randomizer ON — Transaction ID, Invoice ID, date and email randomized per email.', level: 'info' });

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

  try {
    await chrome.scripting.executeScript({
      target: { tabId: mailTabId, allFrames: true },
      files: ['content.js']
    });
  } catch(e) {}
  await sleep(1000);

  const mailFrameId = await findMailFrame();
  if (mailFrameId === null) {
    broadcast({ type: 'log', text: 'Could not find iCloud Mail UI frame. Are you logged in?', level: 'err' });
    broadcast({ type: 'done', sent: 0, total });
    return;
  }
  broadcast({ type: 'log', text: 'Found mail UI in frame ' + mailFrameId + '!', level: 'ok' });

  // Build list of work items: in chunk mode each item is a group of emails;
  // in normal mode each item is a single email (group of 1).
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

      // Step 1: Open compose — focus To field using first recipient
      const composeResult = await sendToFrame(mailFrameId, { action: 'openCompose', to: group[0] });
      if (composeResult && composeResult.error) throw new Error(composeResult.error);
      broadcast({ type: 'log', text: 'Compose open, To focused.', level: 'info' });

      // Step 2: Type all recipients into the To field
      for (const toEmail of group) {
        await sleep(100);
        await sendDebuggerType(mailTabId, toEmail);
        await sleep(300);
        await sendDebuggerEnter(mailTabId);
        broadcast({ type: 'log', text: 'Added: ' + toEmail, level: 'info' });
        await sleep(200);
      }
      broadcast({ type: 'log', text: group.length + ' recipient(s) confirmed.', level: 'info' });

      // Step 3: Fill Subject
      await sleep(800);
      const subjectResult = await sendToFrame(mailFrameId, { action: 'fillSubject', subject });
      if (subjectResult && subjectResult.error) throw new Error(subjectResult.error);
      broadcast({ type: 'log', text: 'Subject filled.', level: 'info' });

      // Step 4: Find RTE iframe and fill body
      const rteFrameId = await findRteFrame(4000);
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
        // Pause between chunks
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

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getOrOpenMailTab() {
  // iCloud Mail redirects /mail/ → /applications/mail2/... so query broadly
  const allTabs = await chrome.tabs.query({ url: 'https://www.icloud.com/*' });
  const mailTab = allTabs.find(t => t.url && (
    t.url.includes('/mail') || t.url.includes('mail2')
  ));
  if (mailTab) {
    broadcast({ type: 'log', text: 'Found iCloud Mail tab (id ' + mailTab.id + ').', level: 'info' });
    await chrome.tabs.update(mailTab.id, { active: true });
    return mailTab.id;
  }
  broadcast({ type: 'log', text: 'No iCloud Mail tab found — opening one...', level: 'info' });
  const tab = await chrome.tabs.create({ url: 'https://www.icloud.com/mail/' });
  await sleep(6000);
  return tab.id;
}
