(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    ['mousedown','mouseup','click'].forEach(function(t) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
    });
  }

  function fill(el, value) {
    var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    el.value = value;
    ['input','change'].forEach(function(t) {
      el.dispatchEvent(new Event(t, { bubbles: true }));
    });
  }

  function pressKey(target, key, keyCode) {
    ['keydown','keypress','keyup'].forEach(function(t) {
      target.dispatchEvent(new KeyboardEvent(t, {
        key: key, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true
      }));
    });
  }

  // Click element at specific screen coordinates
  function clickAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (el) {
      click(el);
      return el;
    }
    return null;
  }

  // Count compose-related visible inputs/textareas that appear after compose opens
  function composeWindowOpen() {
    var inputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
    return inputs.length > 0 && Array.from(inputs).some(function(el) {
      return el.offsetParent !== null; // visible
    });
  }

  function findInput(hints) {
    var all = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
    for (var i = 0; i < hints.length; i++) {
      var re = new RegExp(hints[i], 'i');
      var found = all.find(function(el) {
        return el.offsetParent !== null && re.test(
          (el.getAttribute('placeholder') || '') + ' ' +
          (el.getAttribute('aria-label') || '') + ' ' +
          (el.getAttribute('name') || '') + ' ' +
          (el.className || '')
        );
      });
      if (found) return found;
    }
    return null;
  }

  function findContentEditable() {
    var all = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    // Return the largest visible one (likely the body)
    return all
      .filter(function(el) { return el.offsetParent !== null && el.offsetHeight > 40; })
      .sort(function(a, b) { return b.offsetHeight - a.offsetHeight; })[0] || null;
  }

  function findSendBtn() {
    var all = Array.from(document.querySelectorAll('*'));
    return all.find(function(el) {
      if (!el.offsetParent) return false;
      var aria  = (el.getAttribute('aria-label') || '').toLowerCase();
      var title = (el.getAttribute('title') || '').toLowerCase();
      var text  = (el.textContent || '').trim().toLowerCase();
      var dt    = (el.getAttribute('data-type') || '').toLowerCase();
      return aria === 'send' || title === 'send' || dt.includes('send') ||
             (text === 'send' && ['button','a','div','span'].includes(el.tagName.toLowerCase()));
    }) || null;
  }

  async function openCompose() {
    // Strategy 1: press 'N' (iCloud Mail shortcut for new message)
    document.body.focus();
    pressKey(document.body, 'n', 78);
    await sleep(1500);
    if (composeWindowOpen()) return true;

    // Strategy 2: click the compose icon area (top-right of iCloud Mail)
    // The pencil icon is typically near the right edge, about 60-80px from right, top area
    var w = window.innerWidth;
    clickAt(w - 60, 235);
    await sleep(1500);
    if (composeWindowOpen()) return true;

    // Strategy 3: click slightly different coordinates
    clickAt(w - 30, 235);
    await sleep(1500);
    if (composeWindowOpen()) return true;

    // Strategy 4: find any element at the top-right quadrant and click it
    for (var x = w - 20; x > w - 200; x -= 15) {
      var el = document.elementFromPoint(x, 235);
      if (el && el !== document.body && el !== document.documentElement) {
        click(el);
        await sleep(1000);
        if (composeWindowOpen()) return true;
      }
    }

    return false;
  }

  async function compose(to, subject, body, isHtml) {
    var opened = await openCompose();
    if (!opened) {
      return { error: 'Could not open compose window. Try clicking the pencil icon manually first, then retry.' };
    }
    await sleep(500);

    // To field
    var toField = findInput(['to', 'recipient', 'address']);
    if (!toField) return { error: 'To field not found. Compose may not have opened.' };
    toField.focus(); fill(toField, to); await sleep(300);
    pressKey(toField, 'Enter', 13);
    await sleep(500);

    // Subject
    var subjectField = findInput(['subject']);
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus(); fill(subjectField, subject); await sleep(400);

    // Body
    var bodyIframe = document.querySelector('iframe');
    if (bodyIframe) {
      try {
        var doc = bodyIframe.contentDocument || bodyIframe.contentWindow.document;
        var ed = doc.querySelector('[contenteditable="true"]') || doc.body;
        ed.focus();
        if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
        ed.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(e) {
        return { error: 'Body iframe access error: ' + e.message };
      }
    } else {
      var bodyField = findContentEditable();
      if (!bodyField) return { error: 'Body field not found' };
      bodyField.focus();
      if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // Send
    var sendBtn = findSendBtn();
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn);
    await sleep(1500);

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action === 'ping') { sendResponse({ ok: true }); return true; }
    if (msg.action === 'compose') {
      compose(msg.to, msg.subject, msg.body, msg.isHtml)
        .then(function(r) { sendResponse(r); })
        .catch(function(e) { sendResponse({ error: e.message }); });
      return true;
    }
  });
})();
