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

  async function typeInto(el, value) {
    try { el.focus(); } catch(e) {}
    fill(el, value);
    await sleep(100);
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

  function qs(selector) {
    try { return document.querySelector(selector); } catch(e) { return null; }
  }

  function shadowInput(el) {
    if (!el || !el.shadowRoot) return null;
    return el.shadowRoot.querySelector('input, [contenteditable]') || null;
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

  function tryFindBody() {
    const byCSS = qs('body > div:nth-child(4) > ui-main-pane > div > div > div > div > div > div');
    if (byCSS) return byCSS;

    const byXPath = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
    if (byXPath && byXPath.tagName !== 'IFRAME') return byXPath;

    const xpaths = [
      '/html/body/div[4]/ui-main-pane/div/div/div/div/div/div',
      '//ui-main-pane/div/div/div/div/div/div',
      '//ui-main-pane//div[@contenteditable]',
    ];
    for (const xp of xpaths) {
      const el = xpath(xp);
      if (el && el.tagName !== 'IFRAME') return el;
    }

    const eds = Array.from(document.querySelectorAll('[contenteditable]'))
      .filter(el => { try { return el.tagName !== 'IFRAME' && el.offsetHeight > 30 && el.offsetParent; } catch(e) { return false; } })
      .sort((a, b) => b.offsetHeight - a.offsetHeight);
    if (eds.length) return eds[0];

    return null;
  }

  async function waitForBody(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const el = tryFindBody();
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  function hasMailUI() {
    return !!(qs('#app-body') || qs('ui-split-container') || qs('ui-button'));
  }

  function findComposeBtn() {
    return xpath('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button') ||
           Array.from(document.querySelectorAll('#app-body ui-button'))[2] || null;
  }

  function findSendBtn() {
    // Try the exact XPath with span (as user identified)
    const bySpan = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span');
    if (bySpan) return bySpan;

    // Try the ui-button itself
    const byBtn = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]');
    if (byBtn) return byBtn;

    // Try shadow root button inside each ui-button
    const uiButtons = Array.from(document.querySelectorAll('ui-button'));
    for (const ub of uiButtons) {
      const a = (ub.getAttribute('aria-label') || '').toLowerCase();
      const t = (ub.getAttribute('title') || '').toLowerCase();
      if (a === 'send' || t === 'send') {
        // Try inner span or shadow button
        const inner = ub.querySelector('span') || (ub.shadowRoot && ub.shadowRoot.querySelector('button, span'));
        return inner || ub;
      }
    }

    // Last resort: any ui-button whose text or label says Send
    return uiButtons.find(el => {
      try {
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'send';
      } catch(e) { return false; }
    }) || null;
  }

  async function compose(to, subject, body, isHtml) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);
    await sleep(2500);

    // To
    let toField = findFieldByLabelText('To');
    if (!toField) { const ac = getAutoCompleteInputs(); if (ac.length > 0) toField = ac[0]; }
    if (!toField) toField = Array.from(document.querySelectorAll('input'))
      .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[0];
    if (!toField) return { error: 'To field not found' };
    await typeInto(toField, to);
    await sleep(400);
    pressKey(toField, 'Enter', 13);
    await sleep(600);

    // Subject
    let subjectField = findFieldByLabelText('Subject');
    if (!subjectField) { const ac = getAutoCompleteInputs(); if (ac.length > 1) subjectField = ac[1]; }
    if (!subjectField) {
      const allInputs = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
      subjectField = allInputs[1] || allInputs[0];
    }
    if (!subjectField) return { error: 'Subject field not found' };
    await typeInto(subjectField, subject);
    await sleep(400);

    // Body
    const bodyEl = await waitForBody(8000);
    if (!bodyEl) {
      const mp = qs('ui-main-pane');
      return { error: 'Body not found after 8s. ui-main-pane children: ' +
        (mp ? mp.querySelectorAll('*').length : 0) +
        ', CSS4 exists: ' + !!qs('body > div:nth-child(4)') };
    }
    try {
      bodyEl.focus();
      if (isHtml) { bodyEl.innerHTML = body; } else { bodyEl.innerText = body; }
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      bodyEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {
      return { error: 'Body fill error: ' + e.message };
    }
    await sleep(800);

    // Send
    const sendBtn = findSendBtn();
    if (!sendBtn) {
      const allUiButtons = Array.from(document.querySelectorAll('ui-button')).map(b =>
        (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().substring(0, 30));
      return { error: 'Send button not found. ui-buttons: ' + JSON.stringify(allUiButtons) };
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
