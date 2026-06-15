(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
  }

  function fill(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Deep query that pierces shadow roots
  function deepQueryAll(selector, root) {
    root = root || document;
    var results = [];
    try {
      var found = Array.from(root.querySelectorAll(selector));
      results = results.concat(found);
    } catch(e) {}
    var allEls = Array.from(root.querySelectorAll('*'));
    allEls.forEach(function(el) {
      if (el.shadowRoot) {
        results = results.concat(deepQueryAll(selector, el.shadowRoot));
      }
    });
    return results;
  }

  function deepQuery(selector, root) {
    return deepQueryAll(selector, root)[0] || null;
  }

  // Find any clickable element matching text/aria/title patterns
  function findByPattern(pattern, root) {
    var tags = 'a,button,div,span,li,i,svg,img,[tabindex],[onclick],[role]';
    var all = deepQueryAll(tags, root);
    var re = new RegExp(pattern, 'i');
    return all.find(function(el) {
      var aria  = el.getAttribute('aria-label') || '';
      var title = el.getAttribute('title') || '';
      var cls   = (typeof el.className === 'string' ? el.className : '') || '';
      var dataType = el.getAttribute('data-type') || '';
      var text  = (el.textContent || '').trim().slice(0, 80);
      return re.test(aria + ' ' + title + ' ' + cls + ' ' + dataType + ' ' + text);
    }) || null;
  }

  function findComposeBtn() {
    // Try direct selectors first (including shadow DOM)
    var directSelectors = [
      '[data-type="mail-compose-button"]',
      '[aria-label="New Message"]',
      '[aria-label="New message"]',
      '[aria-label="Compose"]',
      '[title="New Message"]',
      '[title="Compose"]',
      '.compose-button',
      '[class*="compose"]',
      '[class*="new-message"]'
    ];
    for (var i = 0; i < directSelectors.length; i++) {
      var el = deepQuery(directSelectors[i]);
      if (el) return el;
    }
    // Broad pattern search
    return findByPattern('compose|new.?message|new.?mail|newmail');
  }

  function debugAll() {
    var tags = 'a,button,div,span,[tabindex],[aria-label],[role],[title]';
    var all = deepQueryAll(tags);
    return all
      .filter(function(el) {
        var aria = el.getAttribute('aria-label') || '';
        var title = el.getAttribute('title') || '';
        var cls = (typeof el.className === 'string' ? el.className : '') || '';
        return aria || title || /button|compose|mail|send|new/i.test(cls);
      })
      .slice(0, 30)
      .map(function(el) {
        return {
          tag: el.tagName,
          aria: el.getAttribute('aria-label') || '',
          title: el.getAttribute('title') || '',
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
          dataType: el.getAttribute('data-type') || ''
        };
      });
  }

  async function compose(to, subject, body, isHtml) {
    var composeBtn = findComposeBtn();
    if (!composeBtn) {
      return { error: 'Compose btn not found. Debug: ' + JSON.stringify(debugAll()) };
    }

    click(composeBtn);
    await sleep(2500);

    // To field
    var toSelectors = [
      'input[data-field="to"]',
      '[class*="recipient"] input',
      '[class*="compose"] input[type="text"]',
      '[class*="compose"] input',
      'input[placeholder*="To"]',
      'input[aria-label*="To"]'
    ];
    var toField = null;
    for (var s of toSelectors) {
      toField = deepQuery(s); if (toField) break;
    }
    if (!toField) return { error: 'To field not found' };
    toField.focus(); fill(toField, to); await sleep(300);
    toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(500);

    // Subject
    var subSelectors = [
      'input[data-field="subject"]',
      '[class*="subject"] input',
      'input[placeholder*="Subject"]',
      'input[aria-label*="Subject"]'
    ];
    var subjectField = null;
    for (var s of subSelectors) {
      subjectField = deepQuery(s); if (subjectField) break;
    }
    if (!subjectField) return { error: 'Subject field not found' };
    subjectField.focus(); fill(subjectField, subject); await sleep(400);

    // Body
    var bodyIframe = deepQuery('iframe');
    if (bodyIframe) {
      var doc = bodyIframe.contentDocument || bodyIframe.contentWindow.document;
      var ed = doc.querySelector('[contenteditable="true"]') || doc.body;
      ed.focus();
      if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      var editables = deepQueryAll('[contenteditable="true"]').filter(function(el) { return el.offsetHeight > 40; });
      var bodyField = editables[editables.length - 1];
      if (!bodyField) return { error: 'Body field not found' };
      bodyField.focus();
      if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // Send
    var sendBtn = deepQuery('[data-type="mail-send-button"]') ||
      deepQuery('[aria-label*="Send"]') ||
      deepQuery('[title*="Send"]') ||
      findByPattern('^send$');
    if (!sendBtn) return { error: 'Send button not found' };
    click(sendBtn);
    await sleep(1500);

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
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
