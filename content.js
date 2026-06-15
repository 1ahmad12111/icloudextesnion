(function () {
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

  function findComposeBtn() {
    // Try every known selector for iCloud Mail compose button
    const selectors = [
      '[data-type="mail-compose-button"]',
      '.compose-button',
      '[aria-label="New Message"]',
      '[aria-label="New message"]',
      '[aria-label="Compose"]',
      '[aria-label="compose"]',
      '[title="New Message"]',
      '[title="Compose"]',
      '[data-action="compose"]',
      '[data-name="compose"]',
      'button.new-message',
      '.new-message-button',
      '[class*="compose"]',
      '[class*="new-message"]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch(e) {}
    }
    // Broad text/aria search over all clickable elements
    const all = Array.from(document.querySelectorAll('button, [role="button"], a, [tabindex]'));
    return all.find(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      return /compose|new message|new mail|write|pencil/.test(text + aria + title);
    }) || null;
  }

  function debugButtons() {
    const all = Array.from(document.querySelectorAll('button, [role="button"]'));
    return all.slice(0, 20).map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').trim().slice(0, 40),
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      cls: el.className ? el.className.toString().slice(0, 60) : ''
    }));
  }

  async function compose(to, subject, body, isHtml) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) {
      const buttons = debugButtons();
      return { error: 'Compose button not found. Buttons on page: ' + JSON.stringify(buttons) };
    }

    click(composeBtn);
    await sleep(2500);

    // To field
    const toSelectors = [
      'input[data-field="to"]',
      '.mail-compose-recipients input',
      'input[placeholder*="To"]',
      'input[aria-label*="To"]',
      'input[name="to"]',
      '[class*="compose"] input',
      '[class*="recipient"] input',
      'input[type="email"]'
    ];
    let toField = null;
    for (const sel of toSelectors) {
      try { toField = document.querySelector(sel); if (toField) break; } catch(e) {}
    }
    if (!toField) return { error: 'To field not found after compose opened' };
    toField.focus();
    fill(toField, to);
    await sleep(300);
    toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(500);

    // Subject field
    const subSelectors = [
      'input[data-field="subject"]',
      'input[placeholder*="Subject"]',
      'input[aria-label*="Subject"]',
      'input[name="subject"]',
      '[class*="subject"] input'
    ];
    let subjectField = null;
    for (const sel of subSelectors) {
      try { subjectField = document.querySelector(sel); if (subjectField) break; } catch(e) {}
    }
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus();
    fill(subjectField, subject);
    await sleep(400);

    // Body
    const bodyIframe = document.querySelector('iframe[class*="body"], iframe[class*="compose"], .mail-composer iframe, [class*="compose"] iframe');
    if (bodyIframe) {
      const doc = bodyIframe.contentDocument || bodyIframe.contentWindow.document;
      const ed = doc.querySelector('[contenteditable="true"]') || doc.body;
      ed.focus();
      if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(el => el.offsetHeight > 50);
      const bodyField = editables[editables.length - 1] || null;
      if (!bodyField) return { error: 'Body field not found' };
      bodyField.focus();
      if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // Send button
    const sendSelectors = [
      '[data-type="mail-send-button"]',
      'button[title*="Send"]',
      '[aria-label*="Send"]',
      '[aria-label="Send"]'
    ];
    let sendBtn = null;
    for (const sel of sendSelectors) {
      try { sendBtn = document.querySelector(sel); if (sendBtn) break; } catch(e) {}
    }
    if (!sendBtn) {
      sendBtn = Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(el => /^send$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()));
    }
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
      return true;
    }
  });
})();
