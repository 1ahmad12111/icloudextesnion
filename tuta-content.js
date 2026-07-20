(function () {
  if (window.__tutaSenderLoaded) return;
  window.__tutaSenderLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function qs(sel) {
    try { return document.querySelector(sel); } catch(e) { return null; }
  }
  function qsa(sel) {
    try { return Array.from(document.querySelectorAll(sel)); } catch(e) { return []; }
  }

  function click(el) {
    if (!el) return;
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch(e) {}
    try { el.click(); } catch(e) {}
  }

  function hasTutaUI() {
    // Tutanota has a specific root element or nav
    return !!(qs('.main-view') || qs('[class*="main"]') || qs('button[title*="email" i]') ||
              document.querySelector('html[class*="tuta"]') ||
              qs('.nav-bar') || qs('#root'));
  }

  function findComposeBtnTuta() {
    // Try by title/aria-label containing "new" or "compose"
    const byAttr = qsa('button, [role="button"]').find(b => {
      const t = (b.getAttribute('title') || b.getAttribute('aria-label') || '').toLowerCase();
      return t.includes('new email') || t.includes('compose') || t.includes('new message');
    });
    if (byAttr) return byAttr;

    // Try by text content
    const byText = qsa('button, [role="button"]').find(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'new email' || t === 'compose' || t === 'new message';
    });
    if (byText) return byText;

    // Try common Tutanota button selector patterns
    const candidates = qsa('.pt button, .main-view button, nav button, .column button');
    // Usually the compose button is one of the first prominent buttons
    return candidates[0] || null;
  }

  // After compose opens, the To field is visible. We need to reach BCC.
  // Tutanota reveals BCC by clicking a "Show BCC" toggle or by tabbing through fields.
  async function findOrRevealBcc() {
    // Check if BCC field already exists
    let bcc = findBccField();
    if (bcc) return bcc;

    // Look for a "BCC" toggle button or link
    const bccToggle = qsa('button, a, span, [role="button"]').find(el => {
      const t = (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().toUpperCase();
      return t === 'BCC' || t === 'SHOW BCC' || t.includes('BCC');
    });
    if (bccToggle) {
      click(bccToggle);
      await sleep(400);
      bcc = findBccField();
      if (bcc) return bcc;
    }

    return null;
  }

  function findBccField() {
    // Tutanota uses input or contenteditable fields labeled BCC
    // Try aria-label
    const byLabel = qsa('input[aria-label*="BCC" i], input[placeholder*="BCC" i], [contenteditable][aria-label*="BCC" i]');
    if (byLabel.length) return byLabel[0];

    // Try finding label element with BCC text, then sibling/parent input
    const labels = qsa('label').filter(l => /bcc/i.test(l.textContent));
    for (const lbl of labels) {
      const forEl = lbl.htmlFor && document.getElementById(lbl.htmlFor);
      if (forEl) return forEl;
      const sibling = lbl.nextElementSibling;
      if (sibling && (sibling.tagName === 'INPUT' || sibling.isContentEditable)) return sibling;
      const parent = lbl.parentElement;
      if (parent) {
        const inp = parent.querySelector('input, [contenteditable]');
        if (inp) return inp;
      }
    }

    // Try generic: find all visible inputs in compose area, BCC is typically 3rd (To, CC, BCC)
    const inputs = qsa('.dialog input, .popup input, [role="dialog"] input').filter(el => {
      try { return el.offsetParent !== null; } catch(e) { return false; }
    });
    if (inputs.length >= 3) return inputs[2]; // To=0, CC=1, BCC=2

    return null;
  }

  function findToField() {
    const byLabel = qsa('input[aria-label*="To" i], input[placeholder*="To" i]');
    if (byLabel.length) return byLabel[0];
    // Fallback: first input in compose dialog
    const inputs = qsa('.dialog input, .popup input, [role="dialog"] input, .modal input').filter(el => {
      try { return el.offsetParent !== null; } catch(e) { return false; }
    });
    return inputs[0] || null;
  }

  function findSubjectField() {
    const byLabel = qsa('input[aria-label*="Subject" i], input[placeholder*="Subject" i]');
    if (byLabel.length) return byLabel[0];
    const inputs = qsa('.dialog input, .popup input, [role="dialog"] input, .modal input').filter(el => {
      try { return el.offsetParent !== null; } catch(e) { return false; }
    });
    // Subject is typically after To/CC/BCC fields
    return inputs[inputs.length - 1] || null;
  }

  function findBodyEditor() {
    // Tutanota uses a contenteditable div for the body
    const byRole = qs('[contenteditable="true"]:not([aria-label*="To" i]):not([aria-label*="BCC" i]):not([aria-label*="Subject" i]):not([aria-label*="CC" i])');
    if (byRole) return byRole;
    // Fallback: body element if it's contenteditable
    return qs('.editor [contenteditable]') || qs('[contenteditable]') || null;
  }

  // ── Action: openCompose ─────────────────────────────────────────────────────
  async function openComposeTuta() {
    const btn = findComposeBtnTuta();
    if (!btn) return { error: 'Compose button not found in Tutanota' };
    click(btn);

    // Wait for compose dialog / To field to appear
    let toField = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      toField = findToField();
      if (toField) break;
      await sleep(200);
    }
    if (!toField) return { error: 'To field never appeared after compose' };

    await sleep(400);
    return { ok: true };
  }

  // ── Action: focusBcc ────────────────────────────────────────────────────────
  // Called after openCompose; reveals BCC and focuses it so debugger can type
  async function focusBccTuta() {
    const bcc = await findOrRevealBcc();
    if (!bcc) return { error: 'BCC field not found in Tutanota compose' };
    try { bcc.focus(); } catch(e) {}
    await sleep(100);
    try { click(bcc); } catch(e) {}
    await sleep(100);
    try { bcc.focus(); } catch(e) {}
    return { ok: true };
  }

  // ── Action: fillSubject ─────────────────────────────────────────────────────
  async function fillSubjectTuta(subject) {
    const field = findSubjectField();
    if (!field) return { error: 'Subject field not found in Tutanota' };
    try { field.focus(); } catch(e) {}
    await sleep(100);
    try { field.value = subject; } catch(e) {}
    try { field.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
    try { field.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
    // Also try execCommand for React-controlled inputs
    try {
      field.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, subject);
    } catch(e) {}
    await sleep(200);
    return { ok: true };
  }

  // ── Action: fillBody ────────────────────────────────────────────────────────
  async function fillBodyTuta(body, isHtml) {
    // Wait for body editor to appear (may take a moment after subject is filled)
    let ed = null;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      ed = findBodyEditor();
      if (ed) break;
      await sleep(200);
    }
    if (!ed) return { error: 'Body editor not found in Tutanota' };

    try { click(ed); } catch(e) {}
    await sleep(200);
    try { ed.focus(); } catch(e) {}
    await sleep(200);

    if (isHtml) {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertHTML', false, body);
      } catch(e) {
        try { ed.innerHTML = body; } catch(e2) {}
      }
    } else {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, body);
      } catch(e) {
        try { ed.innerText = body; } catch(e2) {}
      }
    }

    try { ed.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch(e) {}
    await sleep(300);
    return { ok: true };
  }

  // ── Action: clickSend ──────────────────────────────────────────────────────
  async function clickSendTuta() {
    await sleep(400);

    const sendBtn = qsa('button, [role="button"]').find(b => {
      const t = (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').toLowerCase().trim();
      return t.includes('send') || t === 'send email' || t === 'send';
    });

    if (!sendBtn) return { error: 'Send button not found in Tutanota' };

    const isDisabled = sendBtn.hasAttribute('disabled') || sendBtn.getAttribute('aria-disabled') === 'true';
    if (isDisabled) return { error: 'Send button is disabled' };

    click(sendBtn);
    await sleep(500);
    return { ok: true };
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasTutaUI: hasTutaUI(), url: window.location.href });
      return true;
    }
    if (msg.action === 'openCompose') {
      openComposeTuta()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'focusBcc') {
      focusBccTuta()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillSubject') {
      fillSubjectTuta(msg.subject)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillBody') {
      fillBodyTuta(msg.body, msg.isHtml)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'clickSend') {
      clickSendTuta()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
  });
})();
