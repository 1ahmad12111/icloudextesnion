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

// ── Debugger helpers ──────────────────────────────────────────────────────────

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
  const base = {
    modifiers: 0,
    key,
    code: key === 'Enter' ? 'Enter' : 'Tab',
    keyCode,
    nativeVirtualKeyCode: keyCode,
    autoRepeat: false,
    isKeypad: false,
    isSystemKey: false,
  };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sleep(50);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// ── Frame helpers ─────────────────────────────────────────────────────────────

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
      if (frame.url && frame.url.includes('icloud.com/mail') && frame.frameId !== 0) {
        try {
          const [r] = await chrome.scripting.executeScript({
            target: { tabId: mailTabId, frameIds: [frame.frameId] },
            func: () => document.querySelectorAll('ui-button').length,
          });
          if (r?.result > 0) return frame.frameId;
        } catch (_) {}
      }
    }
    await sleep(500);
  }
  return 0;
}

async function findRteFrame(maxMs = 5000) {
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

// ── Main flow ─────────────────────────────────────────────────────────────────

async function runSendLoop({ emails, subject, body, isHtml, delay }) {
  const total = emails.length;
  let sent = 0;

  broadcast({ type: 'log', text: `Starting — ${total} emails, ${delay}s delay.`, level: 'info' });

  mailTabId = await getOrOpenMailTab();

  try {
    await attachDebugger(mailTabId);
    broadcast({ type: 'log', text: 'Debugger attached for trusted key events.', level: 'info' });
  } catch (e) {
    broadcast({ type: 'log', text: `Debugger attach failed: ${e.message}. Token confirmation may not work.`, level: 'err' });
  }

  await waitForMailReady();

  const mailFrameId = await findMainFrame();
  broadcast({ type: 'log', text: `Using mail frame: ${mailFrameId}`, level: 'info' });

  for (const email of emails) {
    if (stopRequested) break;
    broadcast({ type: 'log', text: `Composing email to ${email}…`, level: 'info' });

    try {
      // Step 1: Open compose and fill To field
      const composeResult = await execInFrame(mailFrameId, openComposeAndFillTo, [email]);
      if (composeResult?.error) throw new Error(composeResult.error);
      broadcast({ type: 'log', text: 'Compose opened, To field filled.', level: 'info' });

      // Step 2: Press Enter via debugger to confirm token (trusted event)
      await sleep(300);
      await sendDebuggerKey(mailTabId, 'Enter', 13);
      broadcast({ type: 'log', text: 'Enter sent (trusted) to confirm email token.', level: 'info' });

      // Step 3: Wait for token to appear, then fill Subject
      await sleep(700);
      const subjectResult = await execInFrame(mailFrameId, fillSubject, [subject]);
      if (subjectResult?.error) throw new Error(subjectResult.error);
      broadcast({ type: 'log', text: 'Subject filled.', level: 'info' });

      // Step 4: Fill body in RTE iframe
      const rteFrameId = await findRteFrame(5000);
      if (rteFrameId === null) throw new Error('RTE (body) iframe not found');
      broadcast({ type: 'log', text: `RTE frame found: ${rteFrameId}`, level: 'info' });

      const bodyResult = await execInFrame(rteFrameId, fillBody, [body, isHtml]);
      if (bodyResult?.error) throw new Error(bodyResult.error);
      broadcast({ type: 'log', text: 'Body filled.', level: 'info' });

      // Step 5: Click Send
      await sleep(500);
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

// ── Tab helpers ───────────────────────────────────────────────────────────────

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
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: mailTabId }).catch(() => []);
      for (const frame of frames) {
        if (!frame.url || !frame.url.includes('icloud')) continue;
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: mailTabId, frameIds: [frame.frameId] },
          func: () => document.querySelectorAll('ui-button').length > 0,
        }).catch(() => [{}]);
        if (r?.result) return;
      }
    } catch (_) {}
    await sleep(1000);
  }
}

// ── Functions injected into page frames ──────────────────────────────────────

function openComposeAndFillTo(toEmail) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    try { el.click(); } catch (_) {}
  }

  function getInputInsideShadow(el) {
    if (!el) return null;
    const direct = el.querySelector('input');
    if (direct) return direct;
    if (el.shadowRoot) {
      const si = el.shadowRoot.querySelector('input');
      if (si) return si;
    }
    for (const child of el.children) {
      const found = getInputInsideShadow(child);
      if (found) return found;
    }
    return null;
  }

  function typeInto(input, text) {
    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return (async () => {
    // 1. Find compose button via XPath
    let composeBtn = null;
    const xpathResult = document.evaluate(
      '//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button',
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    );
    composeBtn = xpathResult.singleNodeValue;

    if (!composeBtn) {
      composeBtn = [...document.querySelectorAll('ui-button')]
        .find(b => {
          const lbl = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
          return lbl.includes('compose') || lbl.includes('new');
        });
    }
    if (!composeBtn) return { error: `Compose button not found. ui-buttons: ${[...document.querySelectorAll('ui-button')].map(b => b.getAttribute('aria-label')).join(', ')}` };

    click(composeBtn);
    await sleep(1800);

    // 2. Find To field inside ui-autocomplete-field shadow root
    let toInput = null;
    const autoFields = document.querySelectorAll('ui-autocomplete-field');
    for (const af of autoFields) {
      const inp = getInputInsideShadow(af);
      if (inp) { toInput = inp; break; }
    }

    if (!toInput) return { error: 'To input field not found inside ui-autocomplete-field' };

    // 3. Type email and keep focus for the upcoming debugger Enter key
    typeInto(toInput, toEmail);
    await sleep(300);
    toInput.focus();
    await sleep(200);

    return { ok: true };
  })();
}

function fillSubject(subjectText) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getInputInsideShadow(el) {
    if (!el) return null;
    const direct = el.querySelector('input');
    if (direct) return direct;
    if (el.shadowRoot) {
      const si = el.shadowRoot.querySelector('input');
      if (si) return si;
    }
    for (const child of el.children) {
      const found = getInputInsideShadow(child);
      if (found) return found;
    }
    return null;
  }

  return (async () => {
    let subjectInput = null;

    const allInputs = [...document.querySelectorAll('input')];
    subjectInput = allInputs.find(i =>
      (i.getAttribute('aria-label') || i.getAttribute('placeholder') || '').toLowerCase().includes('subject')
    );

    if (!subjectInput) {
      const autoFields = document.querySelectorAll('ui-autocomplete-field');
      if (autoFields.length >= 2) subjectInput = getInputInsideShadow(autoFields[1]);
    }

    if (!subjectInput) return { error: 'Subject input not found' };

    subjectInput.focus();
    await sleep(100);

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(subjectInput, subjectText);
    else subjectInput.value = subjectText;
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
    subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
    subjectInput.blur();
    await sleep(300);

    return { ok: true };
  })();
}

function fillBody(bodyText, isHtml) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return (async () => {
    let editor = document.querySelector('[contenteditable="true"]');
    if (!editor && document.body?.isContentEditable) editor = document.body;
    if (!editor) editor = document.querySelector('[role="textbox"]');
    if (!editor) editor = document.body;

    if (!editor) return { error: 'No contenteditable editor found in RTE frame' };

    editor.focus();
    await sleep(200);

    document.execCommand('selectAll', false, null);
    await sleep(100);

    if (isHtml) {
      document.execCommand('insertHTML', false, bodyText);
    } else {
      document.execCommand('insertText', false, bodyText);
    }

    if (!editor.textContent.trim()) {
      if (isHtml) editor.innerHTML = bodyText;
      else editor.innerText = bodyText;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    editor.blur();
    await sleep(200);

    return { ok: true, content: editor.innerHTML.substring(0, 100) };
  })();
}

function clickSend() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    try { el.click(); } catch (_) {}
  }

  return (async () => {
    await sleep(400);

    const sendBtn = [...document.querySelectorAll('ui-button')]
      .find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('send'));

    if (!sendBtn) {
      const labels = [...document.querySelectorAll('ui-button')].map(b => b.getAttribute('aria-label')).join(', ');
      return { error: `Send button not found. ui-buttons: ${labels}` };
    }

    const isDisabled = sendBtn.hasAttribute('disabled') ||
      sendBtn.getAttribute('aria-disabled') === 'true' ||
      (sendBtn.shadowRoot && !!sendBtn.shadowRoot.querySelector('[disabled]'));

    if (isDisabled) {
      return { error: 'Send button is disabled — email token may not be confirmed' };
    }

    const rect = sendBtn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const realTarget = document.elementFromPoint(x, y);
    if (realTarget) click(realTarget);
    click(sendBtn);

    await sleep(1500);
    return { ok: true };
  })();
}
