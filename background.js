// Service worker — orchestrates sending via iCloud Mail web UI.

let stopRequested = false;
let mailTabId = null;
let debuggerAttached = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startSending') {
    stopRequested = false;
    runSendLoop(msg).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.action === 'stop') {
    stopRequested = true;
    detachDebugger();
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function attachDebugger(tabId) {
  if (debuggerAttached) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerAttached = true;
}

async function detachDebugger() {
  if (!debuggerAttached || !mailTabId) return;
  try { await chrome.debugger.detach({ tabId: mailTabId }); } catch (_) {}
  debuggerAttached = false;
}

async function sendDebuggerKey(tabId, key, keyCode) {
  const base = { modifiers: 0, key, code: key === 'Enter' ? 'Enter' : 'Tab', keyCode, nativeVirtualKeyCode: keyCode, autoRepeat: false, isKeypad: false, isSystemKey: false };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sleep(50);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function execInFrame(frameId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: mailTabId, frameIds: [frameId] },
    func,
    args,
  });
  return result?.result;
}

async function findMainFrame() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => []);
    for (const frame of frames) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: mailTabId, frameIds: [frame.frameId] },
          func: () => ({ count: document.querySelectorAll('ui-button').length, url: location.href }),
        });
        if (r?.result?.count > 0) {
          broadcast({ type: 'log', text: `Mail frame: ${frame.frameId} (${r.result.url})`, level: 'info' });
          return frame.frameId;
        }
      } catch (_) {}
    }
    await sleep(500);
  }
  return 0;
}

async function findRteFrame(maxMs = 6000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => []);
    for (const frame of frames) {
      if (frame.url && frame.url.includes('mail2-rte')) {
        try {
          const [r] = await chrome.scripting.executeScript({
            target: { tabId: mailTabId, frameIds: [frame.frameId] },
            func: () => !!(document.querySelector('[contenteditable]') || document.body),
          });
          if (r?.result) return frame.frameId;
        } catch (_) {}
      }
    }
    await sleep(300);
  }
  return null;
}

async function runSendLoop({ emails, subject, body, isHtml, delay }) {
  const total = emails.length;
  let sent = 0;

  broadcast({ type: 'log', text: `Starting — ${total} emails, ${delay}s delay.`, level: 'info' });

  mailTabId = await getOrOpenMailTab();

  try {
    await attachDebugger(mailTabId);
    broadcast({ type: 'log', text: 'Debugger attached.', level: 'info' });
  } catch (e) {
    broadcast({ type: 'log', text: `Debugger attach failed: ${e.message}`, level: 'err' });
  }

  await waitForMailReady();
  const mailFrameId = await findMainFrame();
  broadcast({ type: 'log', text: `Using mail frame: ${mailFrameId}`, level: 'info' });

  for (const email of emails) {
    if (stopRequested) break;
    broadcast({ type: 'log', text: `Composing to ${email}…`, level: 'info' });

    try {
      // Step 1: Click compose
      const composeResult = await execInFrame(mailFrameId, clickCompose, []);
      if (composeResult?.error) throw new Error(composeResult.error);
      broadcast({ type: 'log', text: 'Compose clicked.', level: 'info' });

      // Step 2: Wait for To field to appear (poll up to 5s)
      let toReady = false;
      for (let i = 0; i < 25; i++) {
        const r = await execInFrame(mailFrameId, checkToFieldReady, []);
        if (r?.ready) { toReady = true; break; }
        await sleep(200);
      }
      if (!toReady) throw new Error('To field never appeared after compose');
      broadcast({ type: 'log', text: 'To field ready.', level: 'info' });

      // Step 3: Type email into To field
      const fillToResult = await execInFrame(mailFrameId, fillToField, [email]);
      if (fillToResult?.error) throw new Error(fillToResult.error);
      broadcast({ type: 'log', text: 'To field filled.', level: 'info' });

      // Step 4: Press Enter via debugger (trusted) to confirm token
      await sleep(300);
      await sendDebuggerKey(mailTabId, 'Enter', 13);
      broadcast({ type: 'log', text: 'Enter sent (trusted) — token should confirm.', level: 'info' });

      // Step 5: Fill Subject
      await sleep(800);
      const subjectResult = await execInFrame(mailFrameId, fillSubject, [subject]);
      if (subjectResult?.error) throw new Error(subjectResult.error);
      broadcast({ type: 'log', text: 'Subject filled.', level: 'info' });

      // Step 6: Fill body in RTE iframe
      const rteFrameId = await findRteFrame(6000);
      if (rteFrameId === null) throw new Error('RTE body iframe not found');
      broadcast({ type: 'log', text: `RTE frame: ${rteFrameId}`, level: 'info' });

      const bodyResult = await execInFrame(rteFrameId, fillBody, [body, isHtml]);
      if (bodyResult?.error) throw new Error(bodyResult.error);
      broadcast({ type: 'log', text: 'Body filled.', level: 'info' });

      // Step 7: Click Send
      await sleep(600);
      const sendResult = await execInFrame(mailFrameId, clickSend, []);
      if (sendResult?.error) throw new Error(sendResult.error);

      sent++;
      broadcast({ type: 'progress', sent, total });
      broadcast({ type: 'log', text: `✓ Sent to ${email}`, level: 'ok' });
    } catch (err) {
      broadcast({ type: 'log', text: `✗ Failed for ${email}: ${err.message}`, level: 'err' });
    }

    if (sent < total && !stopRequested) {
      broadcast({ type: 'log', text: `Waiting ${delay}s…`, level: 'info' });
      await sleep(delay * 1000);
    }
  }

  await detachDebugger();
  broadcast({ type: 'done', sent, total });
}

async function getOrOpenMailTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.icloud.com/mail/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }
  const tab = await chrome.tabs.create({ url: 'https://www.icloud.com/mail/' });
  return tab.id;
}

async function waitForMailReady() {
  for (let i = 0; i < 30; i++) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => []);
    for (const frame of frames) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: mailTabId, frameIds: [frame.frameId] },
          func: () => document.querySelectorAll('ui-button').length > 0,
        });
        if (r?.result) return;
      } catch (_) {}
    }
    await sleep(1000);
  }
}

// ── Injected page functions ────────────────────────────────────────────────────────────

function clickCompose() {
  function click(el) {
    ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
    );
    try { el.click(); } catch (_) {}
  }

  // Try XPath first (known compose button path)
  try {
    const xr = document.evaluate(
      '//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button',
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    );
    const btn = xr.singleNodeValue;
    if (btn) { click(btn); return { ok: true }; }
  } catch (_) {}

  // Fallback: any ui-button with compose/new label
  const btn = [...document.querySelectorAll('ui-button')].find(b => {
    const lbl = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
    return lbl.includes('compose') || lbl.includes('new message') || lbl.includes('new mail');
  });
  if (btn) { click(btn); return { ok: true }; }

  const allBtns = [...document.querySelectorAll('ui-button')]
    .map(b => b.getAttribute('aria-label') || b.textContent?.trim()).join(' | ');
  return { error: `Compose button not found. Buttons: ${allBtns}` };
}

function checkToFieldReady() {
  function getShadowInput(el) {
    if (!el) return null;
    if (el.shadowRoot) {
      const i = el.shadowRoot.querySelector('input');
      if (i) return i;
    }
    const d = el.querySelector('input');
    if (d) return d;
    return null;
  }
  const fields = document.querySelectorAll('ui-autocomplete-field');
  for (const f of fields) {
    if (getShadowInput(f)) return { ready: true, count: fields.length };
  }
  return { ready: false, count: fields.length };
}

function fillToField(toEmail) {
  function getShadowInput(el) {
    if (!el) return null;
    if (el.shadowRoot) {
      const i = el.shadowRoot.querySelector('input');
      if (i) return i;
    }
    const d = el.querySelector('input');
    if (d) return d;
    return null;
  }

  const fields = document.querySelectorAll('ui-autocomplete-field');
  if (!fields.length) return { error: `No ui-autocomplete-field found. Total inputs: ${document.querySelectorAll('input').length}` };

  const toInput = getShadowInput(fields[0]);
  if (!toInput) return { error: 'No input inside first ui-autocomplete-field shadow root' };

  toInput.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(toInput, toEmail);
  else toInput.value = toEmail;
  toInput.dispatchEvent(new Event('input', { bubbles: true }));
  toInput.dispatchEvent(new Event('change', { bubbles: true }));

  // Keep focus on the input so the debugger Enter key lands here
  toInput.focus();
  return { ok: true };
}

function fillSubject(subjectText) {
  function getShadowInput(el) {
    if (!el) return null;
    if (el.shadowRoot) {
      const i = el.shadowRoot.querySelector('input');
      if (i) return i;
    }
    const d = el.querySelector('input');
    if (d) return d;
    return null;
  }

  // Look for input with 'subject' in aria-label or placeholder
  let subjectInput = [...document.querySelectorAll('input')].find(i =>
    (i.getAttribute('aria-label') || i.getAttribute('placeholder') || '').toLowerCase().includes('subject')
  );

  // Fallback: second ui-autocomplete-field
  if (!subjectInput) {
    const fields = document.querySelectorAll('ui-autocomplete-field');
    if (fields.length >= 2) subjectInput = getShadowInput(fields[1]);
  }

  if (!subjectInput) return { error: 'Subject input not found' };

  subjectInput.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(subjectInput, subjectText);
  else subjectInput.value = subjectText;
  subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
  subjectInput.blur();
  return { ok: true };
}

function fillBody(bodyText, isHtml) {
  let editor = document.querySelector('[contenteditable="true"]');
  if (!editor && document.body?.isContentEditable) editor = document.body;
  if (!editor) editor = document.querySelector('[role="textbox"]');
  if (!editor) editor = document.body;
  if (!editor) return { error: 'No contenteditable editor in RTE frame' };

  editor.focus();
  document.execCommand('selectAll', false, null);
  if (isHtml) document.execCommand('insertHTML', false, bodyText);
  else document.execCommand('insertText', false, bodyText);

  // Fallback if execCommand didn't work
  if (!editor.textContent.trim()) {
    if (isHtml) editor.innerHTML = bodyText;
    else editor.innerText = bodyText;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  editor.blur();
  return { ok: true };
}

function clickSend() {
  function click(el) {
    ['mousedown','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
    );
    try { el.click(); } catch (_) {}
  }

  const sendBtn = [...document.querySelectorAll('ui-button')]
    .find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('send'));

  if (!sendBtn) {
    const labels = [...document.querySelectorAll('ui-button')].map(b => b.getAttribute('aria-label')).join(', ');
    return { error: `Send button not found. Buttons: ${labels}` };
  }

  const isDisabled = sendBtn.hasAttribute('disabled') || sendBtn.getAttribute('aria-disabled') === 'true';
  if (isDisabled) return { error: 'Send button disabled — token not confirmed?' };

  const rect = sendBtn.getBoundingClientRect();
  const realTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (realTarget) click(realTarget);
  click(sendBtn);
  return { ok: true };
}
