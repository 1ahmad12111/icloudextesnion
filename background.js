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

  // Re-inject content script into ALL frames
  try {
    await chrome.scripting.executeScript({
      target: { tabId: mailTabId, allFrames: true },
      files: ['content.js']
    });
  } catch(e) {}
  await sleep(1000);

  // Ping all frames to find which one has iCloud Mail UI
  const frameId = await findMailFrame();
  if (frameId === null) {
    broadcast({ type: 'log', text: 'Could not find iCloud Mail UI frame. Are you logged in?', level: 'err' });
    return;
  }

  broadcast({ type: 'log', text: 'Found mail UI in frame ' + frameId + '!', level: 'ok' });

  for (const email of emails) {
    if (stopRequested) break;
    broadcast({ type: 'log', text: 'Sending to ' + email + '...', level: 'info' });

    try {
      const result = await sendToFrame(frameId, {
        action: 'compose',
        to: email, subject, body, isHtml
      });
      if (result && result.error) throw new Error(result.error);
      sent++;
      broadcast({ type: 'progress', sent, total });
      broadcast({ type: 'log', text: 'Sent to ' + email, level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: 'Failed for ' + email + ': ' + err.message, level: 'err' });
    }

    if (sent < total && !stopRequested) {
      broadcast({ type: 'log', text: 'Waiting ' + delay + 's...', level: 'info' });
      await sleep(delay * 1000);
    }
  }

  broadcast({ type: 'done', sent, total });
}

async function findMailFrame() {
  // Try pinging each frame; the one with the mail UI will respond with hasMailUI: true
  const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => null);
  if (!frames) {
    // getAllFrames needs webNavigation permission — fall back to frameId 0
    const result = await sendToFrame(0, { action: 'ping' });
    return (result && result.ok) ? 0 : null;
  }
  for (const frame of frames) {
    const result = await sendToFrame(frame.frameId, { action: 'ping' });
    if (result && result.hasMailUI) return frame.frameId;
  }
  // Fallback: return any frame that responded
  for (const frame of frames) {
    const result = await sendToFrame(frame.frameId, { action: 'ping' });
    if (result && result.ok) return frame.frameId;
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
