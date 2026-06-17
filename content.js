(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Click with full pointer event sequence at element center coordinates
  function click(el) {
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      el.dispatchEvent(new PointerEvent('pointerover',  Object.assign({ isPrimary: true }, opts)));
      el.dispatchEvent(new PointerEvent('pointerdown',  Object.assign({ isPrimary: true }, opts)));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup',    Object.assign({ isPrimary: true }, opts)));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch(e) {}
    try { el.click(); } catch(e) {}
  }

  function pressKey(el, key, code, extra) {
    try {
      ['keydown','keypress','keyup'].forEach(t =>
        el.dispatchEvent(new KeyboardEvent(t, Object.assign(
          { key, keyCode: code, which: code, bubbles: true, cancelable: true }, extra || {}))));
    } catch(e) {}
  }

  function xpath(expr) {
    try {
      return document.evaluate(expr, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    } catch(e) { return null; }
  }

  function qs(sel) {
    try { return document.querySelector(sel); } catch(e) { return null; }
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

  // Simple fill — restore the approach that was working before
  async function typeInto(el, value) {
    try { el.focus(); } catch(e) {}
    await sleep(100);
    try { el.value = value; } catch(e) {}
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch(e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
    await sleep(100);
    try {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
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

  function diagnose() {
    const lines = [];
    lines.push('url: ' + window.location.href.substring(0, 80));
    lines.push('hasMailUI: ' + hasMailUI());
    const iframes = Array.from(document.querySelectorAll('iframe'));
    lines.push('iframes: ' + iframes.length);
    iframes.slice(0, 5).forEach((fr, i) => {
      lines.push('iframe[' + i + '] src: ' + (fr.src || '').substring(0, 70));
      try {
        const fd = fr.contentDocument;
        lines.push('iframe[' + i + '] accessible:' + !!fd +
          (fd ? ' designMode:' + fd.designMode : ''));
      } catch(e) { lines.push('iframe[' + i + '] blocked'); }
    });
    const btnLabels = Array.from(document.querySelectorAll('ui-button'))
      .map(b => b.getAttribute('aria-label') || '').filter(Boolean);
    lines.push('ui-button labels: ' + JSON.stringify(btnLabels));
    return lines.join(' | ');
  }

  // ── Action: composeOpen ─────────────────────────────────────────────────────
  async function composeOpen(to, subject) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found. DIAG: ' + diagnose() };
    click(composeBtn);

    const card = await waitForComposeCard(5000);
    if (!card) return { error: 'Compose dialog did not open. DIAG: ' + diagnose() };
    await sleep(1000);

    // To field
    let toField = findFieldByLabelText('To');
    if (!toField) { const ac = getAutoCompleteInputs(); toField = ac[0]; }
    if (!toField) toField = Array.from(document.querySelectorAll('input'))
      .find(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
    if (!toField) return { error: 'To field not found. DIAG: ' + diagnose() };
    // Click the parent ui-autocomplete-field to ensure it's focused
    try { click(toField.closest('ui-autocomplete-field') || toField); } catch(e) {}
    await sleep(200);
    await typeInto(toField, to);
    await sleep(400);
    pressKey(toField, 'Enter', 13);
    await sleep(200);
    pressKey(toField, 'Tab', 9);
    await sleep(500);

    // Subject field
    let subjectField = findFieldByLabelText('Subject');
    if (!subjectField) { const ac = getAutoCompleteInputs(); subjectField = ac[1]; }
    if (!subjectField) {
      subjectField = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[1];
    }
    if (!subjectField) return { error: 'Subject field not found. DIAG: ' + diagnose() };
    await typeInto(subjectField, subject);
    await sleep(300);
    pressKey(subjectField, 'Tab', 9);
    await sleep(300);

    return { ok: true };
  }

  // ── Action: fillBody (runs in mail2-rte iframe) ───────────────────────────
  async function fillBody(body, isHtml) {
    const ed = document.querySelector('[contenteditable]') ||
               (document.body.isContentEditable ? document.body : null) ||
               document.body;

    try { ed.focus(); } catch(e) {}
    await sleep(200);

    if (isHtml) {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertHTML', false, body);
      } catch(e) {
        try { ed.innerHTML = body; } catch(e2) {}
      }
    } else {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, body);
      } catch(e) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', body);
          ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch(e2) {
          try { ed.innerText = body; } catch(e3) {}
        }
      }
    }

    try { ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body })); } catch(e) {}
    await sleep(300);
    try { ed.blur(); } catch(e) {}
    await sleep(300);

    // Try sending Cmd+Enter from inside the RTE iframe (may bubble to parent)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', keyCode: 13, metaKey: true, ctrlKey: true,
        bubbles: true, cancelable: true
      }));
    } catch(e) {}

    return { ok: true, diag: diagnose() };
  }

  // ── Action: clickSend ────────────────────────────────────────────────────────
  async function clickSend() {
    await sleep(600);

    const sendBtn = Array.from(document.querySelectorAll('ui-button'))
      .find(b => b.getAttribute('aria-label') === 'Send Message');

    if (!sendBtn) {
      const labels = Array.from(document.querySelectorAll('ui-button'))
        .map(b => b.getAttribute('aria-label') || '').filter(Boolean);
      return { error: 'Send button not found. Labels: ' + JSON.stringify(labels) + ' DIAG: ' + diagnose() };
    }

    // Full pointer event sequence at real coordinates
    click(sendBtn);
    await sleep(300);

    // Also try shadow root inner element
    if (sendBtn.shadowRoot) {
      const inner = sendBtn.shadowRoot.querySelector('button, [role="button"], span');
      if (inner) { click(inner); }
    }
    await sleep(300);

    // Keyboard shortcut in this frame too
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', keyCode: 13, metaKey: true, ctrlKey: true,
        bubbles: true, cancelable: true
      }));
    } catch(e) {}

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasMailUI: hasMailUI(), url: window.location.href });
      return true;
    }
    if (msg.action === 'diagnose') {
      sendResponse({ diag: diagnose() });
      return true;
    }
    if (msg.action === 'composeOpen') {
      composeOpen(msg.to, msg.subject)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillBody') {
      fillBody(msg.body, msg.isHtml)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message + ' DIAG: ' + diagnose() }));
      return true;
    }
    if (msg.action === 'clickSend') {
      clickSend()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
  });
})();
