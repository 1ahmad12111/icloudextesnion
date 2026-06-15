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

  function xpathFind(xpath) {
    try {
      var result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue || null;
    } catch(e) { return null; }
  }

  function hasMailUI() {
    return !!(document.querySelector('#app-body') ||
              document.querySelector('ui-split-container') ||
              document.querySelector('ui-button'));
  }

  function findComposeBtn() {
    // Use the exact XPath the user provided
    var byXpath = xpathFind('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button');
    if (byXpath) return byXpath;

    // Also try the svg/span inside it
    var bySvg = xpathFind('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button/span/svg');
    if (bySvg) return bySvg;

    // Fallback: find ui-button elements and pick the compose one
    var uiButtons = Array.from(document.querySelectorAll('ui-button'));
    // The compose button is in div[3] - it's typically the 3rd button in the top toolbar
    // Try to find it by aria or title on the ui-button or its children
    var found = uiButtons.find(function(btn) {
      var aria  = (btn.getAttribute('aria-label') || '').toLowerCase();
      var title = (btn.getAttribute('title') || '').toLowerCase();
      var inner = (btn.textContent || '').toLowerCase();
      return /compose|new.?message|new.?mail/.test(aria + title + inner);
    });
    if (found) return found;

    // Last resort: 3rd ui-button in the toolbar area
    var inAppBody = document.querySelector('#app-body');
    if (inAppBody) {
      var buttons = Array.from(inAppBody.querySelectorAll('ui-button'));
      if (buttons.length >= 3) return buttons[2]; // 0-indexed, div[3] = index 2
    }

    return null;
  }

  function composeIsOpen() {
    // Check for inputs that belong to a compose window
    var inputs = Array.from(document.querySelectorAll('input, ui-autocomplete-field, [contenteditable]'));
    return inputs.some(function(el) {
      var ph = (el.getAttribute('placeholder') || '').toLowerCase();
      var ar = (el.getAttribute('aria-label') || '').toLowerCase();
      return /^to$|^subject$|recipient/.test(ph + ' ' + ar) && el.offsetParent !== null;
    });
  }

  function findField(hints) {
    // Search inputs, ui-* elements, and contenteditable
    var candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable], ui-autocomplete-field, ui-text-field'));
    for (var h of hints) {
      var re = new RegExp(h, 'i');
      var found = candidates.find(function(el) {
        if (!el.offsetParent) return false;
        var ph = el.getAttribute('placeholder') || '';
        var ar = el.getAttribute('aria-label') || '';
        var nm = el.getAttribute('name') || '';
        var dt = el.getAttribute('data-field') || '';
        return re.test(ph + ' ' + ar + ' ' + nm + ' ' + dt);
      });
      if (found) return found;
    }
    return null;
  }

  async function compose(to, subject, body, isHtml) {
    // Open compose
    var composeBtn = findComposeBtn();
    if (!composeBtn) {
      var uiButtons = Array.from(document.querySelectorAll('ui-button')).map(function(b) {
        return { aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), text: b.textContent.trim().slice(0,30) };
      });
      return { error: 'Compose button not found. ui-buttons: ' + JSON.stringify(uiButtons) };
    }

    click(composeBtn);
    await sleep(2500);

    if (!composeIsOpen()) {
      // Try clicking the parent element
      if (composeBtn.parentElement) click(composeBtn.parentElement);
      await sleep(1500);
    }

    // To field
    var toField = findField(['to', 'recipient']) ||
      Array.from(document.querySelectorAll('input')).filter(function(el) { return el.offsetParent; })[0];
    if (!toField) return { error: 'To field not found' };
    toField.focus(); fill(toField, to); await sleep(300);
    pressKey(toField, 'Enter', 13); await sleep(500);

    // Subject
    var subjectField = findField(['subject']);
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus(); fill(subjectField, subject); await sleep(400);

    // Body - check iframe first, then contenteditable
    var iframe = document.querySelector('iframe');
    if (iframe) {
      try {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        var ed  = doc.querySelector('[contenteditable]') || doc.body;
        ed.focus();
        if (isHtml) ed.innerHTML = body; else ed.innerText = body;
        ed.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(e) { return { error: 'iframe error: ' + e.message }; }
    } else {
      var editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(function(el) { return el.offsetHeight > 40 && el.offsetParent; });
      var ed = editables[editables.length - 1];
      if (!ed) return { error: 'Body field not found' };
      ed.focus();
      if (isHtml) ed.innerHTML = body; else ed.innerText = body;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // Send button - check ui-button elements too
    var sendBtn = xpathFind('//*[contains(@aria-label,"Send") or contains(@title,"Send") or @data-type="mail-send-button"]') ||
      Array.from(document.querySelectorAll('ui-button, button, [role="button"]')).find(function(el) {
        var a = (el.getAttribute('aria-label') || '').toLowerCase();
        var t = (el.getAttribute('title') || '').toLowerCase();
        var tx = (el.textContent || '').trim().toLowerCase();
        var dt = (el.getAttribute('data-type') || '').toLowerCase();
        return (a === 'send' || t === 'send' || tx === 'send' || dt.includes('send')) && el.offsetParent;
      });
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn); await sleep(1500);

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasMailUI: hasMailUI(), url: window.location.href });
      return true;
    }
    if (msg.action === 'compose') {
      compose(msg.to, msg.subject, msg.body, msg.isHtml)
        .then(function(r) { sendResponse(r); })
        .catch(function(e) { sendResponse({ error: e.message }); });
      return true;
    }
  });
})();
