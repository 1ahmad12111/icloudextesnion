(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    try { ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))); } catch(e) {}
  }

  // Simple fill — no native setter, just direct assignment + events
  function fill(el, value) {
    try { el.value = value; } catch(e) {}
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch(e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
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

  function hasMailUI() {
    return !!(document.querySelector('#app-body') ||
              document.querySelector('ui-split-container') ||
              document.querySelector('ui-button'));
  }

  function findComposeBtn() {
    return xpath('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button') ||
           xpath('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button/span/svg') ||
           Array.from(document.querySelectorAll('#app-body ui-button'))[2] ||
           null;
  }

  // Get visible inputs sorted by offsetTop (no getBoundingClientRect)
  function getVisibleInputs() {
    return Array.from(document.querySelectorAll('input'))
      .filter(el => {
        try { return el.offsetParent !== null; } catch(e) { return false; }
      })
      .sort((a, b) => {
        try { return a.offsetTop - b.offsetTop; } catch(e) { return 0; }
      });
  }

  async function compose(to, subject, body, isHtml) {
    // 1. Compose button
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);
    await sleep(2500);

    // 2. To field — first visible input
    const inputs = getVisibleInputs();
    if (!inputs.length) return { error: 'No inputs found after compose opened' };
    const toField = inputs[0];
    try { toField.focus(); } catch(e) {}
    fill(toField, to);
    await sleep(400);
    pressKey(toField, 'Enter', 13);
    await sleep(600);

    // 3. Subject — second visible input (re-query after To confirmed)
    const inputs2 = getVisibleInputs();
    const subjectField = inputs2[1] || inputs2[0];
    if (!subjectField) return { error: 'Subject field not found' };
    try { subjectField.focus(); } catch(e) {}
    fill(subjectField, subject);
    await sleep(400);

    // 4. Body — XPath provided by user
    const bodyEl = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
    if (bodyEl) {
      try { bodyEl.focus(); } catch(e) {}
      try {
        if (isHtml) { bodyEl.innerHTML = body; } else { bodyEl.innerText = body; }
        bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(e) { return { error: 'Body fill error: ' + e.message }; }
    } else {
      // Fallback: largest contenteditable
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

    // 5. Send button — XPath provided by user
    const sendBtn =
      xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span') ||
      xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]') ||
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
