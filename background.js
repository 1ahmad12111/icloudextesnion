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

  try {
    mailTabId = await getOrOpenMailTab();
    await sleep(3000); // wait for iCloud Mail to load
    await waitForMailReady();
  } catch (e) {
    broadcast({ type: 'log', text: 'Error opening iCloud Mail: ' + e.message, level: 'err' });
    return;
  }

  for (const email of emails) {
    if (stopRequested) break;

    broadcast({ type: 'log', text: 'Sending to ' + email + '...', level: 'info' });

    try {
      await injectAndSend(email, subject, body, isHtml);
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
  return tab.id;
}

async function waitForMailReady() {
  for (let i = 0; i < 30; i++) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: mailTabId },
        func: () => {
          return !!(
            document.querySelector('[data-type="mail-compose-button"]') ||
            document.querySelector('.compose-button') ||
            Array.from(document.querySelectorAll('[aria-label]')).find(el => el.getAttribute('aria-label').includes('ompose'))
          );
        }
      });
      if (r && r.result) return;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('iCloud Mail did not load. Make sure you are logged in.');
}

async function injectAndSend(to, subject, body, isHtml) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: mailTabId },
    func: doCompose,
    args: [to, subject, body, isHtml]
  });
  const result = results && results[0] && results[0].result;
  if (result && result.error) throw new Error(result.error);
}

async function doCompose(to, subject, body, isHtml) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }

  function fill(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  try {
    // Click compose
    const composeBtn =
      document.querySelector('[data-type="mail-compose-button"]') ||
      document.querySelector('.compose-button') ||
      Array.from(document.querySelectorAll('button,[role="button"],[aria-label]'))
        .find(el => /compose|new.?mail|new.?message/i.test(el.textContent + (el.getAttribute('aria-label') || '')));

    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);
    await sleep(2000);

    // To field
    const toField =
      document.querySelector('input[data-field="to"]') ||
      document.querySelector('.mail-compose-recipients input') ||
      document.querySelector('[placeholder*="To"]') ||
      document.querySelector('[aria-label*="To"]');
    if (!toField) return { error: 'To field not found' };
    toField.focus();
    fill(toField, to);
    await sleep(300);
    toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(400);

    // Subject field
    const subjectField =
      document.querySelector('input[data-field="subject"]') ||
      document.querySelector('[placeholder*="Subject"]') ||
      document.querySelector('[aria-label*="Subject"]');
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus();
    fill(subjectField, subject);
    await sleep(300);

    // Body
    const bodyFrame = document.querySelector('.mail-composer-body iframe, [data-field="body"] iframe');
    if (bodyFrame) {
      const doc = bodyFrame.contentDocument || bodyFrame.contentWindow.document;
      const editable = doc.querySelector('[contenteditable="true"]') || doc.body;
      editable.focus();
      if (isHtml) { editable.innerHTML = body; } else { editable.innerText = body; }
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const bodyField =
        document.querySelector('[contenteditable="true"].mail-composer-body') ||
        document.querySelector('.mail-composer [contenteditable="true"]') ||
        Array.from(document.querySelectorAll('[contenteditable="true"]')).pop();
      if (!bodyField) return { error: 'Body field not found' };
      bodyField.focus();
      if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // Send button
    const sendBtn =
      document.querySelector('[data-type="mail-send-button"]') ||
      document.querySelector('button[title*="Send"]') ||
      Array.from(document.querySelectorAll('button,[role="button"]'))
        .find(el => /^send$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()));
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn);
    await sleep(1500);

    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}
