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

  // Search for the body editor in the main doc AND inside any accessible iframes
  async function waitForBody(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      // 1. isContentEditable in main doc (no iframe)
      const byEditable = Array.from(document.querySelectorAll('div, p, section'))
        .filter(el => { try { return el.isContentEditable && el.tagName !== 'IFRAME' && el.offsetHeight > 50; } catch(e) { return false; } })
        .sort((a, b) => b.offsetHeight - a.offsetHeight)[0];
      if (byEditable) return { el: byEditable, doc: document };

      // 2. Search inside iframes
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const iframe of iframes) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow.document;
          if (!iDoc) continue;
          // editable body or contenteditable
          const ce = iDoc.querySelector('[contenteditable="true"], [contenteditable=""]');
          if (ce && ce.offsetHeight > 20) return { el: ce, doc: iDoc };
          if (iDoc.body && iDoc.body.isContentEditable) return { el: iDoc.body, doc: iDoc };
          if (iDoc.designMode === 'on') return { el: iDoc.body, doc: iDoc };
        } catch(e) { /* cross-origin, skip */ }
      }

      // 3. User-provided XPath (wrapper div fallback)
      const byXPath = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
      if (byXPath && byXPath.tagName !== 'IFRAME') return { el: byXPath, doc: document };

      // 4. User-provided CSS
      const byCSS = qs('body > div:nth-child(4) > ui-main-pane > div > div > div > div > div > div');
      if (byCSS) return { el: byCSS, doc: document };

      await sleep(300);
    }
    return null;
  }

  async function fillBody(result, text, isHtml) {
    const { el, doc } = result;
    click(el);
    await sleep(150);
    try { el.focus(); } catch(e) {}
    await sleep(150);

    if (isHtml) {
      try { el.innerHTML = text; } catch(e) {}
      try { doc.execCommand('selectAll', false, null); doc.execCommand('insertHTML', false, text); } catch(e) {}
    } else {
      // Try execCommand on the element's document (works for iframe docs too)
      let ok = false;
      try {
        el.focus();
        doc.execCommand('selectAll', false, null);
        ok = doc.execCommand('insertText', false, text);
      } catch(e) {}

      if (!ok) {
        // ClipboardEvent paste
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          el.focus();
          el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
          ok = true;
        } catch(e) {}
      }

      if (!ok) {
        // Direct set
        try { el.innerText = text; ok = true; } catch(e) {}
      }
    }

    try { el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: text })); } catch(e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
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

  async function trySend() {
    // 1. Keyboard shortcut Cmd+Enter (most reliable in mail apps)
    const target = document.activeElement || document.body;
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    } catch(e) {}
    await sleep(300);
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    } catch(e) {}
    await sleep(500);

    // 2. Old XPath with span
    const bySpan = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span');
    if (bySpan) { click(bySpan); return; }
    const byOld = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]');
    if (byOld) { click(byOld); return; }

    // 3. ui-button with send label
    const all = Array.from(document.querySelectorAll('ui-button'));
    const byLabel = all.find(b => /^send$/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''));
    if (byLabel) { click(byLabel.querySelector('span') || byLabel); return; }

    // 4. Last ui-button in pane (the send icon button)
    const pane = qs('#root ui-pane') || qs('ui-pane');
    if (pane) {
      const btns = Array.from(pane.querySelectorAll('ui-button'));
      if (btns.length > 0) { click(btns[btns.length - 1].querySelector('span') || btns[btns.length - 1]); return; }
    }

    // 5. Return error info
    return 'no-send-btn';
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

    // Body
    const bodyResult = await waitForBody(8000);
    if (!bodyResult) {
      const iframeCount = document.querySelectorAll('iframe').length;
      const isEditCount = Array.from(document.querySelectorAll('*')).filter(el => { try { return el.isContentEditable; } catch(e) { return false; } }).length;
      return { error: 'Body not found. iframes: ' + iframeCount + ', isContentEditable: ' + isEditCount };
    }
    await fillBody(bodyResult, body, isHtml);
    await sleep(800);

    // Send
    const sendResult = await trySend();
    await sleep(2000);
    if (sendResult === 'no-send-btn') {
      return { error: 'Send button not found and keyboard shortcut may have failed' };
    }
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
