(function () {
  // If a previous instance of this script is still alive, unload it cleanly
  // so we never accumulate duplicate message listeners across re-injections.
  if (window.__icloudSenderUnload) {
    try { window.__icloudSenderUnload(); } catch(_) {}
  }

  // ── Platform detection ────────────────────────────────────────────────────────
  const IS_TITAN = window.location.hostname.includes('titan.email');

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function click(el) {
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ isPrimary: true }, opts)));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ isPrimary: true }, opts)));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch(e) {}
    try { el.click(); } catch(e) {}
  }

  function xpath(expr) {
    try {
      return document.evaluate(expr, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    } catch(e) { return null; }
  }

  function qs(sel) {
    try { return document.querySelector(sel); } catch(e) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── iCLOUD MAIL helpers ───────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function shadowInput(el) {
    if (!el || !el.shadowRoot) return null;
    return el.shadowRoot.querySelector('input') || null;
  }

  function getAutoCompleteInputs() {
    return Array.from(document.querySelectorAll('ui-autocomplete-field'))
      .map(el => shadowInput(el)).filter(Boolean);
  }

  const FIELD_LABELS = {
    To: ['To','À','宛先','An','Para','A','Aan','Till','До','Til','До','Кому',
         'Vastaanottaja','Aan','İlgili','إلى','收件人','받는 사람','Kepada','ถึง','Đến'],
    Subject: ['Subject','Objet','件名','Betreff','Asunto','Oggetto','Onderwerp','Assunto',
              'Ämne','Тема','Emne','Тема','Aihe','Konu','الموضوع','主题','제목','Subjek',
              'หัวเรื่อง','Chủ đề'],
  };

  function findFieldByLabelText(labelKey) {
    const candidates = FIELD_LABELS[labelKey] || [labelKey];
    for (const labelText of candidates) {
      const escaped = labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^' + escaped + ':?\\s*$', 'i');
      const labels = Array.from(document.querySelectorAll('label, [role="label"], span, div, ui-label'))
        .filter(el => re.test((el.textContent || '').trim()));
      for (const label of labels) {
        const id = label.id;
        if (id) {
          const inp = document.querySelector('[aria-labelledby="' + id + '"]');
          if (inp) return inp;
          for (const cel of document.querySelectorAll('ui-autocomplete-field, ui-text-field')) {
            if ((cel.getAttribute('aria-labelledby') || '') === id) return cel;
            if (cel.shadowRoot) {
              const si = cel.shadowRoot.querySelector('[aria-labelledby="' + id + '"], input');
              if (si) return si;
            }
          }
        }
        const parent = label.closest('[class*="field"], [class*="row"], li, div') || label.parentElement;
        if (parent) {
          const si = parent.querySelector('input, [contenteditable], ui-autocomplete-field');
          if (si && si !== label) return si;
        }
      }
    }
    return null;
  }

  async function typeInto(el, value) {
    try { el.focus(); } catch(e) {}
    await sleep(100);
    try { el.value = value; } catch(e) {}
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch(e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
    await sleep(100);
    try {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
    } catch(e) {}
  }

  function findComposeBtn() {
    const COMPOSE_LABELS = [
      'compose', 'new message', 'new mail', 'new email',
      'nouveau message', 'rédiger',
      'verfassen', 'neue nachricht', 'neue e-mail', 'neue e-mail erstellen',
      'redactar', 'nuevo mensaje',
      'scrivi', 'nuovo messaggio',
      'nieuw bericht', 'nieuwe e-mail',
      'nova mensagem',
      'ny besked', 'skriv', 'ny melding',
      'новое сообщение', 'написать',
      'yeni mesaj', 'oluştur',
      'إنشاء', 'رسالة جديدة',
      '新規メッセージを作成', 'メールを作成', '作成',
      '新建', '撰写', '新邮件', '撰寫',
      '새 메시지', '작성',
    ];
    const byLabel = Array.from(document.querySelectorAll('ui-button, button, [role="button"]'))
      .find(b => {
        const lbl = (b.getAttribute('aria-label') || '').toLowerCase().trim();
        return COMPOSE_LABELS.some(l => lbl.includes(l));
      });
    if (byLabel) return byLabel;

    const byText = Array.from(document.querySelectorAll('ui-button, button, [role="button"], a'))
      .find(el => /new\s*message|compose/i.test((el.textContent || '').trim()));
    if (byText) return byText;

    const byIcon = Array.from(document.querySelectorAll('#app-body ui-button'))
      .find(b => b.querySelector('svg') || (b.shadowRoot && b.shadowRoot.querySelector('svg')));
    if (byIcon) return byIcon;

    return Array.from(document.querySelectorAll('#app-body ui-button'))[2] || null;
  }

  function iCloudHasMailUI() {
    return !!(qs('#app-body') || findComposeBtn());
  }

  function diagnose() {
    const lines = [];
    lines.push('url: ' + window.location.href.substring(0, 80));
    lines.push('platform: ' + (IS_TITAN ? 'titan' : 'icloud'));
    lines.push('hasMailUI: ' + (IS_TITAN ? titanHasMailUI() : iCloudHasMailUI()));
    const iframes = Array.from(document.querySelectorAll('iframe'));
    lines.push('iframes: ' + iframes.length);
    const btnLabels = Array.from(document.querySelectorAll('ui-button, button'))
      .map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean).slice(0, 12);
    lines.push('buttons: ' + JSON.stringify(btnLabels));
    return lines.join(' | ');
  }

  // iCloud — closeCompose
  async function iCloudCloseCompose() {
    const composeSelectors = [
      '[class*="compose-message"]', '[class*="ComposeWindow"]',
      '[class*="compose-window"]', '[data-testid*="compose"]',
    ];
    for (const sel of composeSelectors) {
      const win = qs(sel);
      if (win && win.offsetParent !== null) {
        const closeBtn = Array.from(win.querySelectorAll('ui-button, button'))
          .find(b => /close|cancel|discard|dismiss/i.test(b.getAttribute('aria-label') || ''));
        if (closeBtn) { click(closeBtn); await sleep(500); return { ok: true, closed: true }; }
      }
    }
    const discardBtn = Array.from(document.querySelectorAll('ui-button, button'))
      .find(b => /^(discard|verwerfen|annuler|scarta|descartar|verwijderen)$/i.test(
        (b.getAttribute('aria-label') || b.textContent || '').trim()
      ) && b.offsetParent !== null);
    if (discardBtn) { click(discardBtn); await sleep(500); return { ok: true, closed: true }; }
    return { ok: true, closed: false };
  }

  // iCloud — openCompose
  async function iCloudOpenCompose(to) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found. DIAG: ' + diagnose() };
    click(composeBtn);

    let toField = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const inputs = getAutoCompleteInputs();
      if (inputs.length > 0) { toField = inputs[0]; break; }
      await sleep(200);
    }
    if (!toField) return { error: 'To field never appeared after compose. DIAG: ' + diagnose() };

    await sleep(800);

    const labelField = findFieldByLabelText('To');
    if (labelField) toField = shadowInput(labelField) || labelField;

    try { click(toField.closest('ui-autocomplete-field') || toField); } catch(e) {}
    await sleep(200);
    try { toField.focus(); } catch(e) {}
    await sleep(100);

    return { ok: true };
  }

  // iCloud — focusToField
  async function iCloudFocusToField() {
    const inputs = getAutoCompleteInputs();
    const toField = inputs[0];
    if (!toField) return { error: 'To field not found for focus' };
    try { click(toField.closest('ui-autocomplete-field') || toField); } catch(e) {}
    await sleep(150);
    try { toField.focus(); } catch(e) {}
    await sleep(100);
    return { ok: true };
  }

  // iCloud — fillSubject
  async function iCloudFillSubject(subject) {
    let subjectField = findFieldByLabelText('Subject');
    if (!subjectField) { const ac = getAutoCompleteInputs(); subjectField = ac[1]; }
    if (!subjectField) {
      subjectField = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } })[1];
    }
    if (!subjectField) return { error: 'Subject field not found. DIAG: ' + diagnose() };
    await typeInto(subjectField, subject);
    await sleep(300);
    try { subjectField.blur(); } catch(e) {}
    await sleep(500);
    return { ok: true };
  }

  // iCloud — fillBody (runs in mail2-rte iframe)
  async function iCloudFillBody(body, isHtml) {
    const ed = document.querySelector('[contenteditable]') ||
               (document.body.isContentEditable ? document.body : null) ||
               document.body;

    try { click(ed); } catch(e) {}
    await sleep(300);
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

    try { ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); } catch(e) {}
    await sleep(300);
    try { ed.blur(); } catch(e) {}
    await sleep(300);

    return { ok: true };
  }

  // iCloud — findAttachInput
  function iCloudFindAttachInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const found = inputs.some(inp => {
      const inCompose = inp.closest('[class*="compose"],[class*="Compose"],[class*="window"]');
      return inCompose || inp.accept || inp.multiple !== undefined;
    });
    return { found: inputs.length > 0, count: inputs.length };
  }

  // iCloud — clickAttachBtn
  async function iCloudClickAttachBtn() {
    const ATTACH_LABELS = [
      'attach', 'attachment', 'pièce jointe', 'anhang', 'adjuntar',
      'allegato', 'bijlage', 'annexe', 'anexo', 'bifoga',
      'приложить', 'ek', 'إرفاق', '添付', '附件', '첨부',
    ];
    const btn = Array.from(document.querySelectorAll('ui-button, button, [role="button"]'))
      .find(b => {
        const lbl = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
        return ATTACH_LABELS.some(l => lbl.includes(l));
      });
    if (btn) { click(btn); await sleep(500); return { ok: true, clicked: true }; }
    return { ok: true, clicked: false };
  }

  // iCloud — clickSend
  async function iCloudClickSend() {
    await sleep(800);

    const sendBtn = Array.from(document.querySelectorAll('ui-button'))
      .find(b => {
        const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
        const SEND_LABELS = ['send','nachricht senden','送信','envoyer','senden','enviar',
          'invia','verzenden','enviar','skicka','отправить','küldés','wyślij','gönder',
          'إرسال','发送','傳送','보내기'];
        return SEND_LABELS.some(s => lbl.includes(s));
      });

    if (!sendBtn) {
      const labels = Array.from(document.querySelectorAll('ui-button'))
        .map(b => b.getAttribute('aria-label') || '').filter(Boolean);
      return { error: 'Send button not found. Labels: ' + JSON.stringify(labels) };
    }

    const enableDeadline = Date.now() + 6000;
    while (Date.now() < enableDeadline) {
      const disabled = sendBtn.hasAttribute('disabled') ||
        sendBtn.getAttribute('aria-disabled') === 'true';
      if (!disabled) break;
      await sleep(400);
    }
    const isDisabled = sendBtn.hasAttribute('disabled') ||
      sendBtn.getAttribute('aria-disabled') === 'true';
    if (isDisabled) return { error: 'Send button is disabled — To token may not be confirmed' };

    try {
      const rect = sendBtn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const realTarget = document.elementFromPoint(x, y);
      if (realTarget && realTarget !== sendBtn) {
        realTarget.click();
        await sleep(200);
      }
    } catch(e) {}

    click(sendBtn);
    await sleep(500);

    await sleep(300);
    const dialogs = Array.from(document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], .dialog, .modal, ui-dialog, ui-alert'
    )).filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
    for (const dlg of dialogs) {
      const dlgText = (dlg.innerText || dlg.textContent || '').toLowerCase();
      const btns = Array.from(dlg.querySelectorAll('button, ui-button, [role="button"]'))
        .filter(b => { try { return b.offsetParent !== null; } catch(e) { return false; } });
      if (/invalid|error|incorrect|wrong|ungültig|invalide|无效|無効|inválid/i.test(dlgText) &&
          /email|address|adresse|アドレス|邮件|메일/i.test(dlgText)) {
        if (btns[0]) { try { btns[0].click(); } catch(e) {} }
        return { error: 'Invalid email address rejected by iCloud' };
      }
      const confirmWords = /send|confirm|ok|yes|continue|proceed/i;
      const confirmBtn = btns.find(b => confirmWords.test(b.getAttribute('aria-label') || b.textContent || ''));
      if (confirmBtn) { click(confirmBtn); await sleep(300); }
    }

    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── TITAN MAIL helpers ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function findTitanComposeWindow() {
    // Look for the floating compose panel by common class/attribute patterns
    const selectors = [
      '[data-testid="compose-wrapper"]',
      '[class*="compose-wrapper"]',
      '[class*="ComposeWindow"]',
      '[class*="compose-container"]',
      '[class*="new-message"]',
      '[class*="compose-modal"]',
      '[class*="mail-compose"]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      } catch(e) {}
    }
    // Fallback: find visible dialog/modal that contains a Subject input or Send button
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter(d => d.offsetParent !== null);
    for (const dlg of dialogs) {
      if (dlg.querySelector('input[placeholder*="Subject" i]') ||
          Array.from(dlg.querySelectorAll('button')).some(b => /^send$/i.test((b.textContent || '').trim()))) {
        return dlg;
      }
    }
    // Last resort: any visible overlay containing a Send button
    const overlays = Array.from(document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="panel"], [class*="popup"]'))
      .filter(el => el.offsetParent !== null);
    for (const ov of overlays) {
      if (Array.from(ov.querySelectorAll('button')).some(b => /^send$/i.test((b.textContent || '').trim()))) {
        return ov;
      }
    }
    return null;
  }

  function findTitanComposeBtn() {
    return Array.from(document.querySelectorAll('button, [role="button"], a'))
      .find(b => /new\s*(email|mail)/i.test(
        (b.textContent || b.getAttribute('aria-label') || '').trim()
      ) && b.offsetParent !== null);
  }

  function titanHasMailUI() {
    return !!(findTitanComposeBtn() ||
      document.querySelector('[class*="inbox"]') ||
      document.querySelector('[class*="mail-list"]') ||
      document.querySelector('[class*="email-list"]'));
  }

  // Find an input inside compose (or document) by placeholder/aria-label
  function findTitanInput(placeholder, compose) {
    const roots = compose ? [compose, document] : [document];
    for (const root of roots) {
      const found = Array.from(root.querySelectorAll('input'))
        .find(i => new RegExp(placeholder, 'i').test(
          (i.placeholder || i.getAttribute('aria-label') || i.getAttribute('name') || '')
        ) && i.offsetParent !== null);
      if (found) return found;
    }
    return null;
  }

  function findTitanBody(compose) {
    const root = compose || document;
    // Pick the tallest visible contenteditable — that's the email body
    const editables = Array.from(root.querySelectorAll('[contenteditable="true"]'))
      .filter(el => el.offsetParent !== null);
    if (!editables.length) return null;
    return editables.sort((a, b) =>
      b.getBoundingClientRect().height - a.getBoundingClientRect().height
    )[0];
  }

  function findTitanSendBtn(compose) {
    const root = compose || document;
    // Look for a button with exactly "Send" as text or aria-label
    const inRoot = Array.from(root.querySelectorAll('button, [role="button"]'))
      .find(b => /^send$/i.test((b.textContent || '').trim()) ||
                 /^send$/i.test(b.getAttribute('aria-label') || ''));
    if (inRoot) return inRoot;
    // Global fallback
    return Array.from(document.querySelectorAll('button'))
      .find(b => /^send$/i.test((b.textContent || '').trim()) && b.offsetParent !== null);
  }

  // Titan — closeCompose
  async function titanCloseCompose() {
    const compose = findTitanComposeWindow();
    if (!compose) return { ok: true, closed: false };
    // Look for close/discard/cancel button in the compose header
    const closeBtn = Array.from(compose.querySelectorAll('button, [role="button"]'))
      .find(b => /close|cancel|discard|dismiss/i.test(
        b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || ''
      ) && b.offsetParent !== null);
    if (closeBtn) { click(closeBtn); await sleep(500); return { ok: true, closed: true }; }
    // Fallback: first button in compose header area (usually the X)
    const headerBtns = Array.from(compose.querySelectorAll('[class*="header"] button, [class*="title-bar"] button, [class*="toolbar"] button'))
      .filter(b => b.offsetParent !== null);
    const xBtn = headerBtns.find(b => {
      const t = (b.textContent || '').trim();
      return t === '×' || t === '✕' || t === '' || t === 'x' || t === 'X';
    }) || headerBtns[headerBtns.length - 1];
    if (xBtn) { click(xBtn); await sleep(500); return { ok: true, closed: true }; }
    return { ok: true, closed: false };
  }

  // Titan — openCompose
  async function titanOpenCompose() {
    const btn = findTitanComposeBtn();
    if (!btn) return { error: 'Titan: "New email" button not found. DIAG: ' + diagnose() };
    click(btn);

    // Wait for compose window to appear
    let compose = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      compose = findTitanComposeWindow();
      if (compose) break;
      await sleep(200);
    }
    if (!compose) return { error: 'Titan: compose window did not open. DIAG: ' + diagnose() };
    await sleep(500);

    // Focus To field
    const toField = findTitanInput('To', compose);
    if (toField) { click(toField); await sleep(100); toField.focus(); }
    return { ok: true };
  }

  // Titan — focusToField
  async function titanFocusToField() {
    const compose = findTitanComposeWindow();
    const toField = findTitanInput('To', compose);
    if (!toField) return { error: 'Titan: To field not found' };
    click(toField); await sleep(100); toField.focus();
    return { ok: true };
  }

  // Titan — focusBccField (reveal + focus BCC input)
  async function titanFocusBccField() {
    const compose = findTitanComposeWindow();
    // Try to click the "Bcc" toggle button to reveal the BCC input
    const bccToggle = Array.from((compose || document).querySelectorAll('button, [role="button"], span, a'))
      .find(b => /^bcc$/i.test((b.textContent || b.getAttribute('aria-label') || '').trim()) &&
                 b.offsetParent !== null);
    if (bccToggle) {
      click(bccToggle);
      await sleep(400);
    }
    // Now find the BCC input
    await sleep(200);
    const bccField = findTitanInput('Bcc', compose);
    if (!bccField) return { error: 'Titan: BCC field not found' };
    click(bccField); await sleep(100); bccField.focus();
    return { ok: true };
  }

  // Titan — fillSubject
  async function titanFillSubject(subject) {
    const compose = findTitanComposeWindow();
    const field = findTitanInput('Subject', compose);
    if (!field) return { error: 'Titan: Subject field not found. DIAG: ' + diagnose() };
    await typeInto(field, subject);
    await sleep(200);
    try { field.blur(); } catch(e) {}
    return { ok: true };
  }

  // Titan — fillBody
  async function titanFillBody(body, isHtml) {
    const compose = findTitanComposeWindow();
    const ed = findTitanBody(compose);
    if (!ed) return { error: 'Titan: body editor not found. DIAG: ' + diagnose() };

    click(ed); await sleep(200); ed.focus(); await sleep(150);

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
    await sleep(200);
    return { ok: true };
  }

  // Titan — findAttachInput
  function titanFindAttachInput() {
    const compose = findTitanComposeWindow();
    const root = compose || document;
    const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
    if (inputs.length > 0) return { found: true, count: inputs.length };
    // Check globally too
    const all = Array.from(document.querySelectorAll('input[type="file"]'));
    return { found: all.length > 0, count: all.length };
  }

  // Titan — clickAttachBtn
  async function titanClickAttachBtn() {
    const compose = findTitanComposeWindow();
    const root = compose || document;
    const btn = Array.from(root.querySelectorAll('button, [role="button"], label'))
      .find(b => /attach|paperclip|file/i.test(
        b.getAttribute('aria-label') || b.getAttribute('title') || b.getAttribute('data-testid') || ''
      ) && b.offsetParent !== null);
    if (btn) { click(btn); await sleep(500); return { ok: true, clicked: true }; }
    return { ok: true, clicked: false };
  }

  // Titan — clickSend
  async function titanClickSend() {
    await sleep(600);
    const compose = findTitanComposeWindow();
    const sendBtn = findTitanSendBtn(compose);
    if (!sendBtn) {
      const allBtns = Array.from(document.querySelectorAll('button'))
        .map(b => (b.textContent || '').trim()).filter(Boolean);
      return { error: 'Titan: Send button not found. Buttons: ' + JSON.stringify(allBtns.slice(0, 15)) };
    }

    // Poll up to 6s for send button to enable
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const disabled = sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true' ||
        sendBtn.getAttribute('disabled') !== null;
      if (!disabled) break;
      await sleep(400);
    }

    click(sendBtn);
    await sleep(500);
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Unified dispatch (platform-aware) ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function hasMailUI() {
    return IS_TITAN ? titanHasMailUI() : iCloudHasMailUI();
  }

  // ── Message listener (self-unloading) ────────────────────────────────────────

  function _messageHandler(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasMailUI: hasMailUI(), url: window.location.href, platform: IS_TITAN ? 'titan' : 'icloud' });
      return true;
    }
    if (msg.action === 'init') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === 'diagnose') {
      sendResponse({ diag: diagnose() });
      return true;
    }

    if (msg.action === 'closeCompose') {
      (IS_TITAN ? titanCloseCompose() : iCloudCloseCompose())
        .then(r => sendResponse(r)).catch(() => sendResponse({ ok: true, closed: false }));
      return true;
    }
    if (msg.action === 'openCompose') {
      (IS_TITAN ? titanOpenCompose() : iCloudOpenCompose(msg.to))
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'focusToField') {
      (IS_TITAN ? titanFocusToField() : iCloudFocusToField())
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'focusBccField') {
      // Only Titan supports BCC field navigation
      titanFocusBccField()
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillSubject') {
      (IS_TITAN ? titanFillSubject(msg.subject) : iCloudFillSubject(msg.subject))
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillBody') {
      (IS_TITAN ? titanFillBody(msg.body, msg.isHtml) : iCloudFillBody(msg.body, msg.isHtml))
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message + ' DIAG: ' + diagnose() }));
      return true;
    }
    if (msg.action === 'findAttachInput') {
      sendResponse(IS_TITAN ? titanFindAttachInput() : iCloudFindAttachInput());
      return true;
    }
    if (msg.action === 'clickAttachBtn') {
      (IS_TITAN ? titanClickAttachBtn() : iCloudClickAttachBtn())
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'clickSend') {
      (IS_TITAN ? titanClickSend() : iCloudClickSend())
        .then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
  }

  chrome.runtime.onMessage.addListener(_messageHandler);

  window.__icloudSenderUnload = function() {
    chrome.runtime.onMessage.removeListener(_messageHandler);
    window.__icloudSenderUnload = null;
  };
})();
