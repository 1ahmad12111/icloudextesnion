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

  // Find a field whose label text matches labelText (pierces shadow roots)
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

  // Wait for compose card to appear (has at least one input)
  async function waitForComposeCard(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const card = qs('#root ui-card') || qs('ui-card');
      if (card && card.querySelector('input, ui-autocomplete-field')) return card;
      await sleep(200);
    }
    return null;
  }

  // Find the body field inside the compose card
  async function waitForBody(card, maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      // contenteditable inside the card
      if (card) {
        const ce = card.querySelector('[contenteditable]');
        if (ce && ce.tagName !== 'IFRAME') return ce;
        // ui-main-pane deep div inside card
        const mp = card.querySelector('ui-main-pane');
        if (mp) {
          const deep = mp.querySelector('div div div div div div') || mp.querySelector('div');
          if (deep) return deep;
        }
      }
      // User-provided XPath
      const byXPath = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
      if (byXPath && byXPath.tagName !== 'IFRAME') return byXPath;
      // User-provided CSS
      const byCSS = qs('body > div:nth-child(4) > ui-main-pane > div > div > div > div > div > div');
      if (byCSS) return byCSS;
      // Any visible contenteditable
      const eds = Array.from(document.querySelectorAll('[contenteditable]'))
        .filter(el => { try { return el.tagName !== 'IFRAME' && el.offsetHeight > 30 && el.offsetParent; } catch(e) { return false; } })
        .sort((a, b) => b.offsetHeight - a.offsetHeight);
      if (eds.length) return eds[0];
      await sleep(300);
    }
    return null;
  }

  function findSendBtn() {
    const bySpan = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span');
    if (bySpan) return bySpan;
    const byBtn = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]');
    if (byBtn) return byBtn;
    const uiButtons = Array.from(document.querySelectorAll('ui-button'));
    for (const ub of uiButtons) {
      const a = (ub.getAttribute('aria-label') || '').toLowerCase();
      const t = (ub.getAttribute('title') || '').toLowerCase();
      if (a === 'send' || t === 'send') return ub.querySelector('span') || ub;
    }
    return null;
  }

  async function compose(to, subject, body, isHtml) {
    // 1. Compose
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);

    // 2. Wait for card
    const card = await waitForComposeCard(5000);
    if (!card) return { error: 'Compose dialog did not open' };
    await sleep(600);

    // 3. To field
    let toField = findFieldByLabelText('To');
    if (!toField) { const ac = getAutoCompleteInputs(); toField = ac[0]; }
    if (!toField) toField = Array.from(document.querySelectorAll('input'))
      .find(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
    if (!toField) return { error: 'To field not found' };
    await typeInto(toField, to);
    await sleep(300);
    pressKey(toField, 'Tab', 9);
    await sleep(500);

    // 4. Subject field
    let subjectField = findFieldByLabelText('Subject');
    if (!subjectField) { const ac = getAutoCompleteInputs(); subjectField = ac[1]; }
    if (!subjectField) {
      const allInputs = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
      subjectField = allInputs[1] || allInputs[0];
    }
    if (!subjectField) return { error: 'Subject field not found' };
    await typeInto(subjectField, subject);
    await sleep(300);
    pressKey(subjectField, 'Tab', 9);
    await sleep(500);

    // 5. Body
    const bodyEl = await waitForBody(card, 8000);
    if (!bodyEl) {
      const mp = qs('ui-main-pane', card);
      return { error: 'Body not found. card: ' + !!card + ', ui-main-pane: ' + !!mp };
    }
    try {
      bodyEl.focus();
      if (isHtml) {
        bodyEl.innerHTML = body;
        bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, body);
      }
    } catch(e) {
      return { error: 'Body fill error: ' + e.message };
    }
    await sleep(800);

    // 6. Send
    const sendBtn = findSendBtn();
    if (!sendBtn) {
      const labels = Array.from(document.querySelectorAll('ui-button'))
        .map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim().substring(0, 20));
      return { error: 'Send button not found. Labels: ' + JSON.stringify(labels) };
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
