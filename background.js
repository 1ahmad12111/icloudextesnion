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

async function sendDebuggerEnter(tabId) {
  const base = { modifiers: 0, key: 'Enter', code: 'Enter', keyCode: 13,
    nativeVirtualKeyCode: 13, autoRepeat: false, isKeypad: false, isSystemKey: false };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sleep(60);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runSendLoop({ emails, subject, body, isHtml, delay }) {
  const total = emails.length;
  let sent = 0;

  broadcast({ type: 'log', text: 'Starting - ' + total + ' emails, ' + delay + 's delay.', level: 'info' });

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

  for (const email of emails) {
    if (stopRequested) break;
    broadcast({ type: 'log', text: 'Sending to ' + email + '...', level: 'info' });

    try {
      // Step 1: Open compose and type To address (returns with To input focused)
      const composeResult = await sendToFrame(mailFrameId, { action: 'openCompose', to: email });
      if (composeResult && composeResult.error) throw new Error(composeResult.error);
      broadcast({ type: 'log', text: 'Compose open, To typed.', level: 'info' });

      // Step 2: Fire trusted Enter via debugger to confirm the email token.
      // Fire quickly (50ms) while the To input still has focus, then retry after 400ms.
      await sleep(50);
      await sendDebuggerEnter(mailTabId);
      await sleep(400);
      await sendDebuggerEnter(mailTabId); // second attempt in case focus shifted
      broadcast({ type: 'log', text: 'Trusted Enter sent — token should be confirmed.', level: 'info' });

      // Step 3: Fill Subject
      await sleep(600);
      const subjectResult = await sendToFrame(mailFrameId, { action: 'fillSubject', subject });
      if (subjectResult && subjectResult.error) throw new Error(subjectResult.error);
      broadcast({ type: 'log', text: 'Subject filled.', level: 'info' });

      // Step 4: Find RTE iframe
      const rteFrameId = await findRteFrame(4000);
      if (rteFrameId === null) throw new Error('Body editor iframe not found');
      broadcast({ type: 'log', text: 'RTE frame found: ' + rteFrameId, level: 'info' });

      // Step 5: Fill body
      const bodyResult = await sendToFrame(rteFrameId, { action: 'fillBody', body, isHtml });
      if (bodyResult && bodyResult.error) throw new Error(bodyResult.error);
      broadcast({ type: 'log', text: 'Body filled.', level: 'info' });

      await sleep(500);

      // Step 6: Click Send
      const sendResult = await sendToFrame(mailFrameId, { action: 'clickSend' });
      if (sendResult && sendResult.error) throw new Error(sendResult.error);

      sent++;
      broadcast({ type: 'progress', sent, total });
      broadcast({ type: 'log', text: '✓ Sent to ' + email, level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: '✗ Failed for ' + email + ': ' + err.message, level: 'err' });
    }

    if (!stopRequested && sent < total) {
      broadcast({ type: 'log', text: 'Waiting ' + delay + 's...', level: 'info' });
      await sleep(delay * 1000);
    }
  }

  await detachDebugger();
  broadcast({ type: 'done', sent, total });
}

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
  const tabs = await chrome.tabs.query({ url: 'https://www.icloud.com/mail/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }
  const tab = await chrome.tabs.create({ url: 'https://www.icloud.com/mail/' });
  await sleep(6000);
  return tab.id;
}
