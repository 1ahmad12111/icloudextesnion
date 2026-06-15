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
           Array.from(document.querySelectorAll('#app-body ui-button')).find(b => {
             const a = (b.getAttribute('aria-label') || '').toLowerCase();
             const t = (b.getAttribute('title') || '').toLowerCase();
             return /compose|new.?message/.test(a + t);
           }) ||
           (document.querySelectorAll('#app-body ui-button')[2] || null);
  }

  // Get all visible inputs sorted by vertical position (top to bottom)
  function getVisibleInputs() {
    return Array.from(document.querySelectorAll('input, ui-autocomplete-field input, [role="textbox"]'))
      .filter(el => el.offsetParent !== null)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  async function compose(to, subject, body, isHtml) {
    // 1. Click compose
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);
    await sleep(2500);

    // 2. To field — first visible input after compose opens
    const inputs = getVisibleInputs();
    if (inputs.length === 0) return { error: 'No inputs found in compose window' };

    const toField = inputs[0];
    toField.focus();
    fill(toField, to);
    await sleep(400);
    // Confirm the recipient by pressing Enter or Tab
    pressKey(toField, 'Enter', 13);
    await sleep(500);

    // 3. Subject — second visible input
    // Re-query because DOM may update after confirming To
    const inputs2 = getVisibleInputs();
    const subjectField = inputs2[1] || inputs2[0];
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus();
    fill(subjectField, subject);
    await sleep(400);

    // 4. Body — use the XPath provided
    const bodyEl = xpath('/html/body/div[2]/ui-main-pane/div/div/div/div/div/div');
    if (bodyEl) {
      bodyEl.focus();
      if (isHtml) { bodyEl.innerHTML = body; } else { bodyEl.innerText = body; }
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Fallback: largest contenteditable
      const ed = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(el => el.offsetHeight > 40 && el.offsetParent)
        .sort((a, b) => b.offsetHeight - a.offsetHeight)[0];
      if (!ed) return { error: 'Body field not found' };
      ed.focus();
      if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // 5. Send button — use the XPath provided
    const sendBtn =
      xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]/span') ||
      xpath('//*[@id="root"]/ui-pane/ui-card/div/div/div[1]/div[2]/div[2]/ui-button[2]') ||
      Array.from(document.querySelectorAll('ui-button, button')).find(el => {
        const a  = (el.getAttribute('aria-label') || '').toLowerCase();
        const t  = (el.getAttribute('title') || '').toLowerCase();
        const tx = (el.textContent || '').trim().toLowerCase();
        return (a === 'send' || t === 'send' || tx === 'send') && el.offsetParent;
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
