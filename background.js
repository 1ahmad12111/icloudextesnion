let stopRequested = false;
let mailTabId     = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startSending') {
    stopRequested = false;
    runSendLoop(msg);
    sendResponse({ ok: true });
  }
  if (msg.action === 'stop') {
    stopRequested = true;
  }
});

async function runSendLoop({ emails, subject, body, isHtml, delay }) {
  const total = emails.length;
  let sent = 0;

  broadcast({ type: 'log', text: 'Starting - ' + total + ' emails, ' + delay + 's delay.', level: 'info' });

  mailTabId = await getOrOpenMailTab();
  broadcast({ type: 'log', text: 'Waiting for iCloud Mail to load...', level: 'info' });
  await sleep(5000);

  // Re-inject content script into ALL frames (including icloud-sandbox.com frames)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: mailTabId, allFrames: true },
      files: ['content.js']
    });
  } catch(e) {}
  await sleep(1000);

  // Find the mail UI frame (handles compose/To/Subject/send)
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
      // Step 1: Open compose and fill To + Subject
      const composeResult = await sendToFrame(mailFrameId, {
        action: 'composeOpen',
        to: email,
        subject
      });
      if (composeResult && composeResult.error) throw new Error(composeResult.error);

      // Step 2: Find the RTE iframe (body editor) — it loads after compose opens
      const rteFrameId = await findRteFrame(3000);
      if (rteFrameId === null) throw new Error('Body editor iframe not found');

      // Step 3: Fill the body in the RTE iframe
      const bodyResult = await sendToFrame(rteFrameId, {
        action: 'fillBody',
        body,
        isHtml
      });
      if (bodyResult && bodyResult.error) throw new Error(bodyResult.error);

      await sleep(500);

      // Step 4: Click Send in the mail frame
      const sendResult = await sendToFrame(mailFrameId, { action: 'clickSend' });
      if (sendResult && sendResult.error) throw new Error(sendResult.error);

      sent++;
      broadcast({ type: 'progress', sent, total });
      broadcast({ type: 'log', text: 'Sent to ' + email, level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: 'Failed for ' + email + ': ' + err.message, level: 'err' });
    }

    if (!stopRequested) {
      broadcast({ type: 'log', text: 'Waiting ' + delay + 's...', level: 'info' });
      await sleep(delay * 1000);
    }
  }

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
        // Ping it to confirm content script is running
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
