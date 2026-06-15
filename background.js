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

  // Get or open iCloud Mail tab
  mailTabId = await getOrOpenMailTab();
  broadcast({ type: 'log', text: 'Waiting for iCloud Mail to load...', level: 'info' });
  await sleep(4000);

  // Inject content script if not already there
  try {
    await chrome.scripting.executeScript({
      target: { tabId: mailTabId },
      files: ['content.js']
    });
  } catch(e) {
    // Already injected, that's fine
  }
  await sleep(500);

  // Check if mail is ready
  const ready = await pingContentScript();
  if (!ready) {
    broadcast({ type: 'log', text: 'iCloud Mail not ready. Make sure you are logged in at icloud.com/mail', level: 'err' });
    return;
  }

  broadcast({ type: 'log', text: 'iCloud Mail ready!', level: 'ok' });

  for (const email of emails) {
    if (stopRequested) break;

    broadcast({ type: 'log', text: 'Sending to ' + email + '...', level: 'info' });

    try {
      const result = await sendMessage(mailTabId, {
        action: 'compose',
        to: email,
        subject: subject,
        body: body,
        isHtml: isHtml
      });

      if (result && result.error) {
        throw new Error(result.error);
      }

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
  await sleep(5000);
  return tab.id;
}

function sendMessage(tabId, msg) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: 'Timeout - no response from page' }), 20000);
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

async function pingContentScript() {
  const result = await sendMessage(mailTabId, { action: 'ping' });
  return result && result.ok;
}
