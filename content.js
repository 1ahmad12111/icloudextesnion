(function () {
  // If a previous instance of this script is still alive, unload it cleanly
  // so we never accumulate duplicate message listeners across re-injections.
  if (window.__icloudSenderUnload) {
    try { window.__icloudSenderUnload(); } catch(_) {}
  }

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
      // Allow optional whitespace before AND after the optional colon so that
      // French-typography labels like "Objet :" (space before colon) also match.
      const re = new RegExp('^' + escaped + '\\s*:?\\s*$', 'i');
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
    // Skip the brittle XPath; use label-based matching as primary strategy
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

  function hasMailUI() {
    return !!(qs('#app-body') || findComposeBtn());
  }

  function diagnose() {
    const lines = [];
    lines.push('url: ' + window.location.href.substring(0, 80));
    lines.push('hasMailUI: ' + hasMailUI());
    const iframes = Array.from(document.querySelectorAll('iframe'));
    lines.push('iframes: ' + iframes.length);
    iframes.slice(0, 3).forEach((fr, i) => {
      lines.push('iframe[' + i + '] src: ' + (fr.src || '').substring(0, 70));
    });
    const btnLabels = Array.from(document.querySelectorAll('ui-button'))
      .map(b => b.getAttribute('aria-label') || '').filter(Boolean);
    lines.push('ui-button labels: ' + JSON.stringify(btnLabels));
    return lines.join(' | ');
  }

  // ── Action: closeCompose ────────────────────────────────────────────────────
  // Dismisses any open compose dialog before starting a new one.
  // Prevents the stale-compose / typing-in-body bug.
  async function closeCompose() {
    // Look for a visible compose window container
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
    // Fallback: find any visible Discard/Close button that's not the compose button itself
    const discardBtn = Array.from(document.querySelectorAll('ui-button, button'))
      .find(b => /^(discard|verwerfen|annuler|scarta|descartar|verwijderen)$/i.test(
        (b.getAttribute('aria-label') || b.textContent || '').trim()
      ) && b.offsetParent !== null);
    if (discardBtn) { click(discardBtn); await sleep(500); return { ok: true, closed: true }; }
    return { ok: true, closed: false };
  }

  // ── Action: openCompose ─────────────────────────────────────────────────────
  async function openCompose(to) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found. DIAG: ' + diagnose() };
    click(composeBtn);

    // Poll for ui-autocomplete-field inputs to appear
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

  // ── Action: focusToField ────────────────────────────────────────────────────
  // Called right before debugger typing to guarantee focus is on To field.
  async function focusToField() {
    const inputs = getAutoCompleteInputs();
    const toField = inputs[0];
    if (!toField) return { error: 'To field not found for focus' };
    try { click(toField.closest('ui-autocomplete-field') || toField); } catch(e) {}
    await sleep(150);
    try { toField.focus(); } catch(e) {}
    await sleep(100);
    return { ok: true };
  }

  // Returns the shadow <input> inside a ui-text-field, or null
  function shadowTextField(el) {
    if (!el || !el.shadowRoot) return null;
    return el.shadowRoot.querySelector('input, textarea') || null;
  }

  // All subject-label translations (mirrors FIELD_LABELS.Subject + common placeholders)
  const SUBJECT_PLACEHOLDERS = [
    'subject','objet','件名','betreff','asunto','oggetto','onderwerp','assunto',
    'ämne','тема','emne','aihe','konu','الموضوع','主题','제목','subjek',
    'หัวเรื่อง','chủ đề',
  ];

  // ── Action: fillSubject ─────────────────────────────────────────────────────
  async function fillSubject(subject) {
    let subjectField = findFieldByLabelText('Subject');

    // Strategy 2: second ui-autocomplete-field shadow input (English iCloud)
    if (!subjectField) {
      const ac = getAutoCompleteInputs();
      subjectField = ac[1] || null;
    }

    // Strategy 3: ui-text-field shadow input (used by French and other locales)
    if (!subjectField) {
      for (const tf of document.querySelectorAll('ui-text-field')) {
        const inp = shadowTextField(tf);
        if (inp && inp.offsetParent !== null) { subjectField = inp; break; }
      }
    }

    // Strategy 4: visible <input> whose placeholder matches a known subject label
    if (!subjectField) {
      subjectField = Array.from(document.querySelectorAll('input'))
        .find(el => {
          try {
            if (el.offsetParent === null) return false;
            const ph = (el.placeholder || el.getAttribute('aria-label') || '').toLowerCase().trim();
            return SUBJECT_PLACEHOLDERS.some(s => ph.includes(s));
          } catch(e) { return false; }
        }) || null;
    }

    // Strategy 5: second visible <input> (position-based last resort)
    if (!subjectField) {
      const visible = Array.from(document.querySelectorAll('input'))
        .filter(el => { try { return el.offsetParent !== null; } catch(e) { return false; } });
      subjectField = visible[1] || null;
    }

    if (!subjectField) return { error: 'Subject field not found. DIAG: ' + diagnose() };
    await typeInto(subjectField, subject);
    await sleep(300);
    try { subjectField.blur(); } catch(e) {}
    await sleep(500);
    return { ok: true };
  }

  // ── Action: fillBody (runs in mail2-rte iframe) ──────────────────────────
  async function fillBody(body, isHtml) {
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

  // ── Action: clickSend ──────────────────────────────────────────────────────
  async function clickSend() {
    await sleep(800); // extra breathing room vs the original 600ms

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

    // Handle modal dialogs — language-agnostic inspection
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
      // Only dismiss dialogs that are clearly confirmation/send-related, not arbitrary ones
      const confirmWords = /send|confirm|ok|yes|continue|proceed/i;
      const confirmBtn = btns.find(b => confirmWords.test(b.getAttribute('aria-label') || b.textContent || ''));
      if (confirmBtn) { click(confirmBtn); await sleep(300); }
    }

    return { ok: true };
  }

  // ── Message listener (self-unloading) ────────────────────────────────────────

  function _messageHandler(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasMailUI: hasMailUI(), url: window.location.href });
      return true;
    }
    if (msg.action === 'init') {
      // Acknowledge new run — nothing to reset here since re-injection handled it
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === 'diagnose') {
      sendResponse({ diag: diagnose() });
      return true;
    }
    if (msg.action === 'closeCompose') {
      closeCompose()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ ok: true, closed: false }));
      return true;
    }
    if (msg.action === 'openCompose') {
      openCompose(msg.to)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'focusToField') {
      focusToField()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillSubject') {
      fillSubject(msg.subject)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.action === 'fillBody') {
      fillBody(msg.body, msg.isHtml)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message + ' DIAG: ' + diagnose() }));
      return true;
    }
    if (msg.action === 'clickSend') {
      clickSend()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }
  }

  chrome.runtime.onMessage.addListener(_messageHandler);

  // Expose unload hook so the next injection can clean up this listener
  window.__icloudSenderUnload = function() {
    chrome.runtime.onMessage.removeListener(_messageHandler);
    window.__icloudSenderUnload = null;
  };
})();
