(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    try { ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))); } catch(e) {}
  }

  function pressKey(el, key, code, extra) {
    try {
      ['keydown','keypress','keyup'].forEach(t =>
        el.dispatchEvent(new KeyboardEvent(t, Object.assign({ key, keyCode: code, which: code, bubbles: true }, extra || {}))));
    } catch(e) {}
  }

  function xpath(expr, ctx) {
    try {
      return document.evaluate(expr, ctx || document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    } catch(e) { return null; }
  }

  function qs(sel, ctx) {
    try { return (ctx || document).querySelector(sel); } catch(e) { return null; }
  }

  function shadowInput(el) {
    if (!el) return null;
    if (el.shadowRoot) return el.shadowRoot.querySelector('input') || null;
    return null;
  }

  // Pierce shadow roots of all ui-autocomplete-field elements
  function getAutoCompleteInputs() {
    return Array.from(document.querySelectorAll('ui-autocomplete-field'))
      .map(el => shadowInput(el)).filter(Boolean);
  }

  // Type into an input field and commit
  async function typeInto(el, value) {
    try { el.focus(); } catch(e) {}
    await sleep(100);
    try {
      // Clear then set value
      el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {}
    await sleep(100);
    try {
      // Also use execCommand as fallback for React
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

  // The compose dialog lives inside #root > ui-pane > ui-card
  function getComposeCard() {
    return qs('#root ui-card') || qs('ui-card') || qs('#root ui-pane') || null;
  }

  // Wait for compose card to appear after clicking compose
  async function waitForComposeCard(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const card = getComposeCard();
      // Card must have at least one input (To field)
      if (card && card.querySelector('input, ui-autocomplete-field')) return card;
      await sleep(200);
    }
    return null;
  }

  // Find body field WITHIN the compose card
  async function waitForBody(card, maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      // Try contenteditable inside the card
      if (card) {
        const ce = card.querySelector('[contenteditable]');
        if (ce && ce.tagName !== 'IFRAME') return ce;

        // Try ui-main-pane children inside card
        const mp = card.querySelector('ui-main-pane');
        if (mp) {
          const deep = mp.querySelector('div div div div div div') || mp.querySelector('div');
          if (deep) return deep;
        }
      }

      // Also try user's exact XPath
      const byXPath = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
      if (byXPath && byXPath.tagName !== 'IFRAME') return byXPath;

      // Try user's CSS selector
      const byCSS = qs('body > div:nth-child(4) > ui-main-pane > div > div > div > div > div > div');
      if (byCSS) return byCSS;

      // Largest visible contenteditable
      const eds = Array.from(document.querySelectorAll('[contenteditable]'))
        .filter(el => { try { return el.tagName !== 'IFRAME' && el.offsetHeight > 30 && el.offsetParent; } catch(e) { return false; } })
        .sort((a, b) => b.offsetHeight - a.offsetHeight);
      if (eds.length) return eds[0];

      await sleep(300);
    }
    return null;
  }

  function findSendBtn() {
    // User-provided XPath (with /span at end)
    const bySpan = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span');
    if (bySpan) return bySpan;

    const byBtn = xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]');
    if (byBtn) return byBtn;

    // Any ui-button with aria-label/title Send
    const uiButtons = Array.from(document.querySelectorAll('ui-button'));
    for (const ub of uiButtons) {
      const a = (ub.getAttribute('aria-label') || '').toLowerCase();
      const t = (ub.getAttribute('title') || '').toLowerCase();
      if (a === 'send' || t === 'send') {
        return ub.querySelector('span') || ub;
      }
    }
    return null;
  }

  async function compose(to, subject, body, isHtml) {
    // 1. Click compose button
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);

    // 2. Wait for compose card to appear
    const card = await waitForComposeCard(5000);
    if (!card) return { error: 'Compose dialog did not open' };
    await sleep(800);

    // 3. Fill To field — find inputs inside the card
    const acInputs = getAutoCompleteInputs();
    const toField = acInputs[0] ||
      qs('input', card) ||
      Array.from(document.querySelectorAll('input')).find(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
    if (!toField) return { error: 'To field not found' };
    await typeInto(toField, to);
    await sleep(300);
    pressKey(toField, 'Tab', 9);
    await sleep(500);

    // 4. Fill Subject — second input
    const subjectField = acInputs[1] ||
      Array.from(card ? card.querySelectorAll('input') : document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[1] ||
      Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[1];
    if (!subjectField) return { error: 'Subject field not found' };
    await typeInto(subjectField, subject);
    await sleep(300);
    pressKey(subjectField, 'Tab', 9);
    await sleep(500);

    // 5. Fill body — wait for it to appear inside the card
    const bodyEl = await waitForBody(card, 8000);
    if (!bodyEl) {
      const mp = qs('ui-main-pane', card);
      return { error: 'Body not found in compose. card found: ' + !!card +
        ', ui-main-pane: ' + !!mp +
        ', card innerHTML len: ' + (card ? card.innerHTML.length : 0) };
    }
    try {
      bodyEl.focus();
      if (isHtml) {
        bodyEl.innerHTML = body;
      } else {
        // Use execCommand so iCloud registers the edit
        bodyEl.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, body);
      }
      bodyEl.dispatchEvent(new Event('input',  { bubbles: true }));
      bodyEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {
      return { error: 'Body fill error: ' + e.message };
    }
    await sleep(800);

    // 6. Click Send
    const sendBtn = findSendBtn();
    if (!sendBtn) {
      const labels = Array.from(document.querySelectorAll('ui-button'))
        .map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim().substring(0, 20));
      return { error: 'Send button not found. ui-button labels: ' + JSON.stringify(labels) };
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
