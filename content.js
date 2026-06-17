(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    try { ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))); } catch(e) {}
  }

  function pressKey(el, key, code) {
    try {
      ['keydown','keypress','keyup'].forEach(t =>
        el.dispatchEvent(new KeyboardEvent(t, { key, keyCode: code, which: code, bubbles: true })));
    } catch(e) {}
  }

  function xpath(expr) {
    try {
      return document.evaluate(expr, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    } catch(e) { return null; }
  }

  function qs(sel, ctx) {
    try { return (ctx || document).querySelector(sel); } catch(e) { return null; }
  }

  function shadowInput(el) {
    if (!el || !el.shadowRoot) return null;
    return el.shadowRoot.querySelector('input') || null;
  }

  function getAutoCompleteInputs() {
    return Array.from(document.querySelectorAll('ui-autocomplete-field'))
      .map(el => shadowInput(el)).filter(Boolean);
  }

  function findFieldByLabelText(labelText) {
    const re = new RegExp('^' + labelText + ':?\\s*$', 'i');
    const labels = Array.from(document.querySelectorAll('label, [role="label"], span, div, ui-label'))
      .filter(el => re.test((el.textContent || '').trim()));
    for (const label of labels) {
      const id = label.id;
      if (id) {
        const inp = document.querySelector('[aria-labelledby="' + id + '"]');
        if (inp) return inp;
        for (const cel of document.querySelectorAll('ui-autocomplete-field, ui-text-field')) {
          if ((cel.getAttribute('aria-labelledby') || '') === id) return cel;
          if (cel.shadowRoot) {
            const si = cel.shadowRoot.querySelector('[aria-labelledby="' + id + '"], input');
            if (si) return si;
          }
        }
      }
      const parent = label.closest('[class*="field"], [class*="row"], li, div') || label.parentElement;
      if (parent) {
        const si = parent.querySelector('input, [contenteditable], ui-autocomplete-field');
        if (si && si !== label) return si;
      }
    }
    return null;
  }

  async function typeInto(el, value) {
    try { el.focus(); } catch(e) {}
    await sleep(100);
    try {
      el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {}
    await sleep(100);
    try {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
    } catch(e) {}
  }

  // Find the actual editable body element using isContentEditable
  function findEditableBody() {
    // isContentEditable catches elements that are editable via inheritance,
    // even without an explicit contenteditable attribute
    const candidates = Array.from(document.querySelectorAll('div, p, section'))
      .filter(el => {
        try {
          return el.isContentEditable &&
                 el.tagName !== 'IFRAME' &&
                 el.offsetHeight > 50;
        } catch(e) { return false; }
      })
      .sort((a, b) => b.offsetHeight - a.offsetHeight);
    return candidates[0] || null;
  }

  async function waitForBody(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      // Best: find any truly editable element (isContentEditable)
      const byEditable = findEditableBody();
      if (byEditable) return byEditable;

      // User-provided XPath
      const byXPath = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
      if (byXPath && byXPath.tagName !== 'IFRAME') return byXPath;

      // User-provided CSS
      const byCSS = qs('body > div:nth-child(4) > ui-main-pane > div > div > div > div > div > div');
      if (byCSS) return byCSS;

      // [contenteditable] attribute
      const eds = Array.from(document.querySelectorAll('[contenteditable]'))
        .filter(el => { try { return el.tagName !== 'IFRAME' && el.offsetHeight > 30 && el.offsetParent; } catch(e) { return false; } })
        .sort((a, b) => b.offsetHeight - a.offsetHeight);
      if (eds.length) return eds[0];

      await sleep(300);
    }
    return null;
  }

  async function fillBody(el, text, isHtml) {
    // Click and focus the element
    click(el);
    await sleep(150);
    try { el.focus(); } catch(e) {}
    await sleep(150);

    if (isHtml) {
      try {
        el.innerHTML = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      } catch(e) {}
      return;
    }

    // Strategy 1: execCommand selectAll + insertText (works in true contenteditable)
    let worked = false;
    try {
      el.focus();
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      if (ok) worked = true;
    } catch(e) {}

    if (!worked) {
      // Strategy 2: ClipboardEvent paste
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        dt.setData('text/html', text);
        el.focus();
        const pasteOk = el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
        );
        if (pasteOk) worked = true;
      } catch(e) {}
    }

    if (!worked) {
      // Strategy 3: set innerText directly
      try {
        el.innerText = text;
        worked = true;
      } catch(e) {}
    }

    try {
      el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {}
  }

  function hasMailUI() {
    return !!(qs('#app-body') || qs('ui-split-container') || qs('ui-button'));
  }

  function findComposeBtn() {
    return xpath('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button') ||
           Array.from(document.querySelectorAll('#app-body ui-button'))[2] || null;
  }

  async function waitForComposeCard(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const card = qs('#root ui-card') || qs('ui-card') || qs('#root ui-pane');
      if (card && card.querySelector('input, ui-autocomplete-field')) return card;
      await sleep(200);
    }
    return null;
  }

  function findSendBtn() {
    const bySpan = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span');
    if (bySpan) return bySpan;
    const byOld = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]');
    if (byOld) return byOld;

    const pane = qs('#root ui-pane') || qs('ui-pane');
    if (pane) {
      const btns = Array.from(pane.querySelectorAll('ui-button'));
      const byLabel = btns.find(b => /^send$/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''));
      if (byLabel) return byLabel.querySelector('span') || byLabel;
      if (btns.length > 0) {
        const last = btns[btns.length - 1];
        return last.querySelector('span') || last;
      }
    }

    const all = Array.from(document.querySelectorAll('ui-button'));
    const byLabel = all.find(b => /^send$/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''));
    if (byLabel) return byLabel.querySelector('span') || byLabel;
    return null;
  }

  async function compose(to, subject, body, isHtml) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);

    const card = await waitForComposeCard(5000);
    if (!card) return { error: 'Compose dialog did not open' };
    await sleep(600);

    // To
    let toField = findFieldByLabelText('To');
    if (!toField) { const ac = getAutoCompleteInputs(); toField = ac[0]; }
    if (!toField) toField = Array.from(document.querySelectorAll('input'))
      .find(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
    if (!toField) return { error: 'To field not found' };
    await typeInto(toField, to);
    await sleep(300);
    pressKey(toField, 'Tab', 9);
    await sleep(500);

    // Subject
    let subjectField = findFieldByLabelText('Subject');
    if (!subjectField) { const ac = getAutoCompleteInputs(); subjectField = ac[1]; }
    if (!subjectField) {
      subjectField = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[1];
    }
    if (!subjectField) return { error: 'Subject field not found' };
    await typeInto(subjectField, subject);
    await sleep(300);
    pressKey(subjectField, 'Tab', 9);
    await sleep(500);

    // Body — wait for the actual editable element
    const bodyEl = await waitForBody(8000);
    if (!bodyEl) {
      const isEditables = Array.from(document.querySelectorAll('*')).filter(el => { try { return el.isContentEditable; } catch(e) { return false; } }).length;
      return { error: 'Body not found after 8s. isContentEditable count: ' + isEditables };
    }
    await fillBody(bodyEl, body, isHtml);
    await sleep(800);

    // Send
    const sendBtn = findSendBtn();
    if (!sendBtn) {
      const allBtnLabels = Array.from(document.querySelectorAll('ui-button'))
        .map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().substring(0, 30));
      return { error: 'Send button not found. ui-buttons: ' + JSON.stringify(allBtnLabels) };
    }
    click(sendBtn);
    await sleep(2000);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
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
