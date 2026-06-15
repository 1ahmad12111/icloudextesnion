(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    try { ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))); } catch(e) {}
  }

  function fill(el, value) {
    try { el.value = value; } catch(e) {}
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch(e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
  }

  // Type value character by character (works for custom inputs)
  async function typeInto(el, value) {
    try { el.focus(); } catch(e) {}
    fill(el, value);
    await sleep(100);
    // Also try document.execCommand as fallback
    try {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
    } catch(e) {}
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

  // Get input inside an element's shadow root
  function shadowInput(el) {
    if (!el) return null;
    if (el.shadowRoot) {
      const inp = el.shadowRoot.querySelector('input, [contenteditable]');
      if (inp) return inp;
    }
    return null;
  }

  // Find all ui-autocomplete-field elements and get their shadow inputs
  function getAutoCompleteInputs() {
    return Array.from(document.querySelectorAll('ui-autocomplete-field'))
      .map(el => shadowInput(el))
      .filter(Boolean);
  }

  // Find input associated with a label containing specific text
  function findFieldByLabelText(labelText) {
    const re = new RegExp('^' + labelText + ':?\\s*$', 'i');
    // Look for any element whose text matches
    const labels = Array.from(document.querySelectorAll('label, [role="label"], span, div, ui-label'))
      .filter(el => re.test((el.textContent || '').trim()));

    for (const label of labels) {
      const id = label.id;
      if (id) {
        // Find element with aria-labelledby pointing to this label
        const inp = document.querySelector('[aria-labelledby="' + id + '"]');
        if (inp) return inp;
        // Also check shadow roots
        const customEls = Array.from(document.querySelectorAll('ui-autocomplete-field, ui-text-field, [class*="field"]'));
        for (const cel of customEls) {
          if ((cel.getAttribute('aria-labelledby') || '') === id) return cel;
          if (cel.shadowRoot) {
            const si = cel.shadowRoot.querySelector('[aria-labelledby="' + id + '"], input, [contenteditable]');
            if (si) return si;
          }
        }
      }
      // Try sibling/parent approach
      const parent = label.closest('[class*="field"], [class*="row"], li, div') || label.parentElement;
      if (parent) {
        const si = parent.querySelector('input, [contenteditable], ui-autocomplete-field');
        if (si && si !== label) return si;
      }
    }
    return null;
  }

  function hasMailUI() {
    return !!(document.querySelector('#app-body') ||
              document.querySelector('ui-split-container') ||
              document.querySelector('ui-button'));
  }

  function findComposeBtn() {
    return xpath('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button') ||
           Array.from(document.querySelectorAll('#app-body ui-button'))[2] ||
           null;
  }

  async function compose(to, subject, body, isHtml) {
    // 1. Open compose
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);
    await sleep(2500);

    // 2. To field
    // Strategy A: find by label text "To"
    let toField = findFieldByLabelText('To');
    // Strategy B: shadow inputs from ui-autocomplete-field
    if (!toField) {
      const acInputs = getAutoCompleteInputs();
      if (acInputs.length > 0) toField = acInputs[0];
    }
    // Strategy C: any visible input
    if (!toField) {
      toField = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[0];
    }
    if (!toField) {
      return { error: 'To field not found. ui-autocomplete-fields: ' +
        document.querySelectorAll('ui-autocomplete-field').length +
        ', inputs: ' + document.querySelectorAll('input').length };
    }
    await typeInto(toField, to);
    await sleep(400);
    pressKey(toField, 'Enter', 13);
    await sleep(600);

    // 3. Subject field
    let subjectField = findFieldByLabelText('Subject');
    if (!subjectField) {
      const acInputs = getAutoCompleteInputs();
      if (acInputs.length > 1) subjectField = acInputs[1];
    }
    if (!subjectField) {
      const allInputs = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
      subjectField = allInputs[1] || allInputs[0];
    }
    if (!subjectField) return { error: 'Subject field not found' };
    await typeInto(subjectField, subject);
    await sleep(400);

    // 4. Body
    const bodyEl = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
    if (bodyEl) {
      try { bodyEl.focus(); } catch(e) {}
      try {
        if (isHtml) { bodyEl.innerHTML = body; } else { bodyEl.innerText = body; }
        bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(e) { return { error: 'Body fill error: ' + e.message }; }
    } else {
      const eds = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(el => { try { return el.offsetHeight > 40 && el.offsetParent; } catch(e) { return false; } })
        .sort((a, b) => b.offsetHeight - a.offsetHeight);
      if (!eds.length) return { error: 'Body field not found' };
      const ed = eds[0];
      try { ed.focus(); } catch(e) {}
      if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // 5. Send
    const sendBtn =
      xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]') ||
      xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span') ||
      Array.from(document.querySelectorAll('ui-button')).find(el => {
        try {
          const a = (el.getAttribute('aria-label') || '').toLowerCase();
          const t = (el.getAttribute('title') || '').toLowerCase();
          return a === 'send' || t === 'send';
        } catch(e) { return false; }
      });
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn);
    await sleep(1500);
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
