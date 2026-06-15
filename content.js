(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })));
  }

  function fill(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(el, key, code) {
    ['keydown','keypress','keyup'].forEach(t =>
      el.dispatchEvent(new KeyboardEvent(t, { key, keyCode: code, which: code, bubbles: true })));
  }

  // Does this frame contain the iCloud Mail UI?
  function hasMailUI() {
    const all = Array.from(document.querySelectorAll('*'));
    return all.some(el => {
      const cls = (typeof el.className === 'string' ? el.className : el.className.baseVal || '');
      const tag = el.tagName.toLowerCase();
      return /mail|compose|inbox/i.test(cls) && ['div','section','nav','ul','main'].includes(tag);
    });
  }

  function findAny(selectors) {
    for (const s of selectors) {
      try { const el = document.querySelector(s); if (el) return el; } catch(e) {}
    }
    return null;
  }

  function findComposeBtn() {
    // Try all known selectors
    const el = findAny([
      '[data-type="mail-compose-button"]',
      '[aria-label="New Message"]',
      '[aria-label="New message"]',
      '[aria-label="Compose"]',
      '[aria-label="compose"]',
      '[title="New Message"]',
      '[title="Compose"]',
      '.compose-button',
      '[class*="compose-btn"]',
      '[class*="ComposeButton"]',
      '[class*="newMessage"]',
      '[class*="new-message"]'
    ]);
    if (el) return el;

    // Search all elements by aria/title/class text
    return Array.from(document.querySelectorAll('*')).find(el => {
      const aria  = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const cls   = (typeof el.className === 'string' ? el.className :
                     (el.className && el.className.baseVal) ? el.className.baseVal : '').toLowerCase();
      const dt    = (el.getAttribute('data-type') || '').toLowerCase();
      return /compose|new.?message|new.?mail/.test(aria + ' ' + title + ' ' + cls + ' ' + dt);
    }) || null;
  }

  function composeIsOpen() {
    const inputs = Array.from(document.querySelectorAll('input, textarea'));
    return inputs.some(el => {
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const ar = (el.getAttribute('aria-label') || '').toLowerCase();
      return /to|recipient|subject/.test(ph + ' ' + ar) && el.offsetParent !== null;
    });
  }

  async function openCompose() {
    // Try clicking compose button
    const btn = findComposeBtn();
    if (btn) { click(btn); await sleep(2000); if (composeIsOpen()) return true; }

    // Try keyboard shortcut N
    pressKey(document.body, 'n', 78);
    await sleep(1500);
    if (composeIsOpen()) return true;

    // Try clicking top-right area where compose pencil icon lives
    const w = window.innerWidth;
    const h = 240;
    for (let x = w - 15; x > w - 150; x -= 10) {
      const el = document.elementFromPoint(x, h);
      if (el && el !== document.body && el !== document.documentElement) {
        click(el);
        await sleep(800);
        if (composeIsOpen()) return true;
      }
    }
    return false;
  }

  async function compose(to, subject, body, isHtml) {
    const opened = await openCompose();
    if (!opened) {
      // Dump what we can see for debugging
      const els = Array.from(document.querySelectorAll('*'))
        .filter(el => el.getAttribute('aria-label') || el.getAttribute('title'))
        .slice(0, 20)
        .map(el => ({ tag: el.tagName, aria: el.getAttribute('aria-label'), title: el.getAttribute('title') }));
      return { error: 'Cannot open compose. Elements: ' + JSON.stringify(els) };
    }

    await sleep(300);

    // To
    const toField = findAny([
      '[placeholder*="To"]','[aria-label*="To"]','[placeholder*="to"]',
      'input[name="to"]','[data-field="to"] input','[class*="recipient"] input'
    ]) || Array.from(document.querySelectorAll('input')).find(el => el.offsetParent !== null);
    if (!toField) return { error: 'To field not found' };
    toField.focus(); fill(toField, to); await sleep(300);
    pressKey(toField, 'Enter', 13); await sleep(400);

    // Subject
    const subjectField = findAny([
      '[placeholder*="Subject"]','[aria-label*="Subject"]',
      'input[name="subject"]','[data-field="subject"] input'
    ]);
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus(); fill(subjectField, subject); await sleep(300);

    // Body
    const iframe = document.querySelector('iframe');
    if (iframe) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const ed  = doc.querySelector('[contenteditable]') || doc.body;
        ed.focus();
        if (isHtml) ed.innerHTML = body; else ed.innerText = body;
        ed.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(e) { return { error: 'iframe body error: ' + e.message }; }
    } else {
      const ed = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(el => el.offsetHeight > 40).pop();
      if (!ed) return { error: 'Body not found' };
      ed.focus();
      if (isHtml) ed.innerHTML = body; else ed.innerText = body;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(400);

    // Send
    const sendBtn = Array.from(document.querySelectorAll('*')).find(el => {
      const a = (el.getAttribute('aria-label') || '').toLowerCase();
      const t = (el.getAttribute('title') || '').toLowerCase();
      const tx = (el.textContent || '').trim().toLowerCase();
      const dt = (el.getAttribute('data-type') || '').toLowerCase();
      return (a === 'send' || t === 'send' || tx === 'send' || dt.includes('send')) && el.offsetParent;
    });
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn); await sleep(1500);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasMailUI: hasMailUI(), url: window.location.href });
      return true;
    }
    if (msg.action === 'compose') {
      compose(msg.to, msg.subject, msg.body, msg.isHtml)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
  });
})();
