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

  // DIAGNOSTIC: collect everything about the compose body area
  function diagnoseBody() {
    const lines = [];

    // 1. ui-main-pane
    const mp = qs('ui-main-pane');
    lines.push('ui-main-pane: ' + !!mp);
    if (mp) {
      lines.push('mp.shadowRoot: ' + !!mp.shadowRoot);
      lines.push('mp.children count: ' + mp.children.length);
      // first 3 child tag names
      const childTags = Array.from(mp.children).slice(0, 5).map(c => c.tagName).join(',');
      lines.push('mp child tags: ' + childTags);
      // look for iframes inside mp
      const mpIframes = mp.querySelectorAll('iframe');
      lines.push('mp iframes: ' + mpIframes.length);
      if (mpIframes.length > 0) {
        for (let i = 0; i < mpIframes.length; i++) {
          const fr = mpIframes[i];
          lines.push('iframe[' + i + '] src: ' + (fr.src || 'none').substring(0, 60));
          try {
            const fd = fr.contentDocument;
            lines.push('iframe[' + i + '] accessible: ' + !!fd);
            if (fd) {
              lines.push('iframe[' + i + '] body.isContentEditable: ' + fd.body.isContentEditable);
              lines.push('iframe[' + i + '] designMode: ' + fd.designMode);
              const fce = fd.querySelectorAll('[contenteditable]').length;
              lines.push('iframe[' + i + '] [contenteditable] count: ' + fce);
            }
          } catch(e) {
            lines.push('iframe[' + i + '] blocked: ' + e.message.substring(0, 50));
          }
        }
      }
    }

    // 2. All iframes on page
    const allIframes = document.querySelectorAll('iframe');
    lines.push('total iframes on page: ' + allIframes.length);
    for (let i = 0; i < Math.min(allIframes.length, 5); i++) {
      const fr = allIframes[i];
      lines.push('page-iframe[' + i + '] src: ' + (fr.src || 'none').substring(0, 60));
      try {
        const fd = fr.contentDocument;
        lines.push('page-iframe[' + i + '] accessible: ' + !!fd + ', designMode: ' + (fd ? fd.designMode : 'n/a'));
      } catch(e) {
        lines.push('page-iframe[' + i + '] blocked');
      }
    }

    // 3. [contenteditable] on page
    lines.push('[contenteditable] count: ' + document.querySelectorAll('[contenteditable]').length);

    // 4. isContentEditable elements
    const isEdCount = Array.from(document.querySelectorAll('*'))
      .filter(el => { try { return el.isContentEditable; } catch(e) { return false; } }).length;
    lines.push('isContentEditable count: ' + isEdCount);

    // 5. CSS selector test
    const byCSS = qs('body > div:nth-child(4) > ui-main-pane > div > div > div > div > div > div');
    lines.push('CSS selector found: ' + !!byCSS);
    if (byCSS) {
      lines.push('CSS el tag: ' + byCSS.tagName);
      lines.push('CSS el isContentEditable: ' + byCSS.isContentEditable);
      lines.push('CSS el children: ' + byCSS.children.length);
      const childTags2 = Array.from(byCSS.children).slice(0,5).map(c => c.tagName).join(',');
      lines.push('CSS el child tags: ' + childTags2);
      const innerIframes = byCSS.querySelectorAll('iframe').length;
      lines.push('CSS el iframes inside: ' + innerIframes);
    }

    // 6. XPath test
    const byXP = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
    lines.push('XPath found: ' + !!byXP + (byXP ? ' tag:' + byXP.tagName : ''));

    // 7. ui-button labels (for send)
    const btnLabels = Array.from(document.querySelectorAll('ui-button'))
      .map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim().substring(0, 20))
      .filter(Boolean);
    lines.push('ui-button labels: ' + JSON.stringify(btnLabels));

    return lines.join(' | ');
  }

  async function compose(to, subject, body, isHtml) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);

    const card = await waitForComposeCard(5000);
    if (!card) return { error: 'Compose dialog did not open' };
    await sleep(1500); // wait for body to fully render

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

    // Run diagnostics and return them as an error so the user can see
    const diagnosis = diagnoseBody();
    return { error: 'DIAG: ' + diagnosis };
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
