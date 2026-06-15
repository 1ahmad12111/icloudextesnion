let stopRequested = false;
let mailTabId     = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startSending') {
    stopRequested = false;
    runSendLoop(msg).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'stop') {
    stopRequested = true;
  }
});

async function runSendLoop({ emails, subject, body, isHtml, delay }) {
  const total = emails.length;
  let sent    = 0;
  broadcast({ type: 'log', text: 'Starting - ' + total + ' emails, ' + delay + 's delay.', level: 'info' });
  mailTabId = await getOrOpenMailTab();
  await waitForMailReady();
  for (const email of emails) {
    if (stopRequested) break;
    broadcast({ type: 'log', text: 'Sending to ' + email + '...', level: 'info' });
    try {
      await sendViaTab({ to: email, subject, body, isHtml });
      sent++;
      broadcast({ type: 'progress', sent, total });
      broadcast({ type: 'log', text: 'Sent to ' + email, level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: 'Failed for ' + email + ': ' + err.message, level: 'err' });
    }
    if (sent < total && !stopRequested) {
      broadcast({ type: 'log', text: 'Waiting ' + delay + 's...', level: 'info' });
      await sleep(delay * 1000);
    }
  }
  broadcast({ type: 'done', sent, total });
}

function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(function() {}); }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function getOrOpenMailTab() {
  return new Promise(function(resolve) {
    chrome.tabs.query({ url: 'https://www.icloud.com/mail/*' }, function(tabs) {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true }, function() { resolve(tabs[0].id); });
      } else {
        chrome.tabs.create({ url: 'https://www.icloud.com/mail/' }, function(tab) { resolve(tab.id); });
      }
    });
  });
}

async function waitForMailReady() {
  for (var i = 0; i < 30; i++) {
    var ready = await new Promise(function(resolve) {
      chrome.tabs.executeScript(mailTabId, {
        code: '!!(document.querySelector("[data-type=\\"mail-compose-button\\"], .compose-button") || Array.from(document.querySelectorAll("[aria-label]")).find(function(el){ return el.getAttribute("aria-label").indexOf("ompose") > -1; }))'
      }, function(results) {
        resolve(results && results[0]);
      });
    });
    if (ready) return;
    await sleep(1000);
  }
  throw new Error('iCloud Mail did not load in time.');
}

async function sendViaTab({ to, subject, body, isHtml }) {
  var code = '(' + composeAndSend.toString() + ')(' + JSON.stringify({ to: to, subject: subject, body: body, isHtml: isHtml }) + ')';
  var results = await new Promise(function(resolve) {
    chrome.tabs.executeScript(mailTabId, { code: code }, function(r) { resolve(r); });
  });
  if (results && results[0] && results[0].error) throw new Error(results[0].error);
}

function composeAndSend(opts) {
  var to = opts.to, subject = opts.subject, body = opts.body, isHtml = opts.isHtml;

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }

  function setVal(el, value) {
    var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (s) s.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findCompose() {
    return document.querySelector('[data-type="mail-compose-button"], .compose-button, [aria-label*="ompose"]') ||
      Array.from(document.querySelectorAll('button,[role="button"]')).find(function(el) {
        return /compose|new\s*mail|new\s*message/i.test(el.textContent + (el.getAttribute('aria-label') || ''));
      });
  }

  return Promise.resolve().then(function() {
    var composeBtn = findCompose();
    if (!composeBtn) return { error: 'Compose button not found' };
    click(composeBtn);
    return sleep(1500).then(function() {
      var toField = document.querySelector('[data-field="to"] input, [placeholder*="o:"], input[aria-label*="o"]');
      if (!toField) return { error: 'To field not found' };
      toField.focus(); setVal(toField, to);
      toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      return sleep(500).then(function() {
        var subjectField = document.querySelector('[data-field="subject"] input, input[placeholder*="ubject"], input[aria-label*="ubject"]');
        if (!subjectField) return { error: 'Subject field not found' };
        subjectField.focus(); setVal(subjectField, subject);
        return sleep(300).then(function() {
          var bodyField = document.querySelector('[data-field="body"], [aria-label*="ody"], .mail-composer-body [contenteditable="true"], iframe');
          if (!bodyField) return { error: 'Body field not found' };
          if (bodyField.tagName === 'IFRAME') {
            var doc = bodyField.contentDocument || bodyField.contentWindow.document;
            var ed = doc.querySelector('[contenteditable="true"], body');
            if (!ed) return { error: 'Body editable not found' };
            ed.focus();
            if (isHtml) { ed.innerHTML = body; } else { ed.innerText = body; }
            ed.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            bodyField.focus();
            if (isHtml) { bodyField.innerHTML = body; } else { bodyField.innerText = body; }
            bodyField.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return sleep(300).then(function() {
            var sendBtn = document.querySelector('[data-type="mail-send-button"], [aria-label*="end"]') ||
              Array.from(document.querySelectorAll('button,[role="button"]')).find(function(el) {
                return /^send$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim());
              });
            if (!sendBtn) return { error: 'Send button not found' };
            click(sendBtn);
            return sleep(1000).then(function() { return { ok: true }; });
          });
        });
      });
    });
  }).catch(function(e) { return { error: e.message }; });
}
