(function () {
  // Avoid double-injection
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }

  function fill(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findEl(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch(e) {}
    }
    return null;
  }

  function findByText(selector, text) {
    return Array.from(document.querySelectorAll(selector))
      .find(el => new RegExp(text, 'i').test((el.textContent || '') + (el.getAttribute('aria-label') || '') + (el.getAttribute('title') || '')));
  }

  async function compose(to, subject, body, isHtml) {
    // 1. Click compose button
    const composeBtn =
      document.querySelector('[data-type="mail-compose-button"]') ||
      document.querySelector('.compose-button') ||
      findByText('button,[role="button"],[aria-label]', 'compose|new mail|new message');

    if (!composeBtn) return { error: 'Compose button not found. Is iCloud Mail fully loaded?' };

    click(composeBtn);
    await sleep(2000);

    // 2. Fill To
    const toField = findEl([
      'input[data-field="to"]',
      '.mail-compose-recipients input',
      'input[placeholder*="To"]',
      'input[aria-label*="To"]',
      'input[name="to"]'
    ]);
    if (!toField) return { error: 'To field not found' };
    toField.focus();
    fill(toField, to);
    await sleep(300);
    toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    toField.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(500);

    // 3. Fill Subject
    const subjectField = findEl([
      'input[data-field="subject"]',
      'input[placeholder*="Subject"]',
      'input[aria-label*="Subject"]',
      'input[name="subject"]'
    ]);
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus();
    fill(subjectField, subject);
    await sleep(400);

    // 4. Fill Body
    // Try iframe first (iCloud Mail sometimes uses an iframe for the body)
    const bodyIframe = document.querySelector('.mail-composer-body iframe, [class*="composer"] iframe, [class*="compose"] iframe');
    if (bodyIframe) {
      const doc = bodyIframe.contentDocument || bodyIframe.contentWindow.document;
      const editable = doc.querySelector('[contenteditable="true"]') || doc.body;
      editable.focus();
      if (isHtml) { editable.innerHTML = body; } else { editable.innerText = body; }
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Try contenteditable div
      const bodyField =
        document.querySelector('[data-field="body"] [contenteditable="true"]') ||
        document.querySelector('.mail-composer-body [contenteditable="true"]') ||
        document.querySelector('[class*="composer"] [contenteditable="true"]') ||
        Array.from(document.querySelectorAll('[contenteditable="true"]'))
          .filter(el => el.offsetHeight > 50).pop();

      if (!bodyField) return { error: 'Body field not found' };
      bodyField.focus();
      if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // 5. Click Send
    const sendBtn =
      document.querySelector('[data-type="mail-send-button"]') ||
      document.querySelector('button[title*="Send"]') ||
      findByText('button,[role="button"]', '^send$');

    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn);
    await sleep(1500);

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === 'compose') {
      compose(msg.to, msg.subject, msg.body, msg.isHtml)
        .then(result => sendResponse(result))
        .catch(e => sendResponse({ error: e.message }));
      return true; // keep channel open for async
    }
  });
})();
