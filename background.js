let stopRequested = false;
let mailTabId     = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startSending') {
    stopRequested = false;
    runSendLoop(msg).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'stop') {
    stopRequested = true;
  }
});

async function runSendLoop({ emails, subject, body, isHtml, delay }) {
  const total = emails.length;
  let sent    = 0;
  broadcast({ type: 'log', text: `Starting — ${total} emails, ${delay}s delay.`, level: 'info' });
  mailTabId = await getOrOpenMailTab();
  await waitForMailReady();
  for (const email of emails) {
    if (stopRequested) break;
    broadcast({ type: 'log', text: `Sending to ${email}…`, level: 'info' });
    try {
      await sendViaContentScript({ to: email, subject, body, isHtml });
      sent++;
      broadcast({ type: 'progress', sent, total });
      broadcast({ type: 'log', text: `✓ Sent to ${email}`, level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: `✗ Failed for ${email}: ${err.message}`, level: 'err' });
    }
    if (sent < total && !stopRequested) {
      broadcast({ type: 'log', text: `Waiting ${delay}s…`, level: 'info' });
      await sleep(delay * 1000);
    }
  }
  broadcast({ type: 'done', sent, total });
}

function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getOrOpenMailTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.icloud.com/mail/*' });
  if (tabs.length > 0) { await chrome.tabs.update(tabs[0].id, { active: true }); return tabs[0].id; }
  const tab = await chrome.tabs.create({ url: 'https://www.icloud.com/mail/' });
  return tab.id;
}

async function waitForMailReady() {
  for (let i = 0; i < 30; i++) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: mailTabId },
        func: () => !!document.querySelector('[data-type="mail-compose-button"], .compose-button, [aria-label*="ompose"]'),
      });
      if (r.result) return;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('iCloud Mail did not load in time.');
}

async function sendViaContentScript({ to, subject, body, isHtml }) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: mailTabId },
    func: composeAndSend,
    args: [{ to, subject, body, isHtml }],
  });
  if (result.result && result.result.error) throw new Error(result.result.error);
}

async function composeAndSend({ to, subject, body, isHtml }) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }
  function setVal(el, value) {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (s) s.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function findCompose() {
    return document.querySelector('[data-type="mail-compose-button"], .compose-button, [aria-label*="ompose"]') ||
      [...document.querySelectorAll('button,[role="button"]')].find(el => /compose|new\s*mail|new\s*message/i.test(el.textContent + (el.getAttribute('aria-label') || '')));
  }
  try {
    const composeBtn = findCompose();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn); await sleep(1500);
    const toField = document.querySelector('[data-field="to"] input, [placeholder*="o:"], input[aria-label*="o"]');
    if (!toField) return { error: 'To field not found' };
    toField.focus(); setVal(toField, to);
    toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await sleep(500);
    const subjectField = document.querySelector('[data-field="subject"] input, input[placeholder*="ubject"], input[aria-label*="ubject"]');
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus(); setVal(subjectField, subject); await sleep(300);
    const bodyField = document.querySelector('[data-field="body"], [aria-label*="ody"], .mail-composer-body [contenteditable="true"], iframe');
    if (!bodyField) return { error: 'Body field not found' };
    if (bodyField.tagName === 'IFRAME') {
      const doc = bodyField.contentDocument || bodyField.contentWindow.document;
      const ed = doc.querySelector('[contenteditable="true"], body');
      if (!ed) return { error: 'Body editable not found inside iframe' };
      ed.focus();
      if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      bodyField.focus();
      if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(300);
    const sendBtn = document.querySelector('[data-type="mail-send-button"], [aria-label*="end"]') ||
      [...document.querySelectorAll('button,[role="button"]')].find(el => /^send$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()));
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn); await sleep(1000);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}
