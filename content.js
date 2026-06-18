(function () {
  if (window.__icloudSenderLoaded) return;
  window.__icloudSenderLoaded = true;

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

  // Finds a field by its visible label text (e.g. "To", "Subject")
  function findFieldByLabelText(labelText) {
    const re = new RegExp('^' + labelText + ':?\\s*$', 'i');
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

  // ── 5-strategy compose button finder (from current branch) ──────────────────
  function findComposeBtn() {
    const byXpath = xpath('//*[@id="app-body"]/ui-split-container/ui-split[2]/div/ui-split-container/ui-split[2]/div/div[1]/div/div[3]/ui-button');
    if (byXpath) return byXpath;

    const COMPOSE_LABELS = ['compose', 'new message', 'new mail', '新規メッセージを作成', '作成',
      'nouveau message', 'verfassen', 'redactar', '新建', '撰写', 'scrivi', 'nieuw bericht'];
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

  // ── Action: openCompose ─────────────────────────────────────────────────────
  // Compose button: 5-strategy from current branch
  // To field typing: from uploaded version
  async function openCompose(to) {
    const composeBtn = findComposeBtn();
    if (!composeBtn) return { error: 'Compose button not found. DIAG: ' + diagnose() };
    click(composeBtn);

    // Poll for ui-autocomplete-field inputs to appear (compose dialog opened)
    let toField = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const inputs = getAutoCompleteInputs();
      if (inputs.length > 0) { toField = inputs[0]; break; }
      await sleep(200);
    }
    if (!toField) return { error: 'To field never appeared after compose. DIAG: ' + diagnose() };

    await sleep(800);

    // Try label-based finder first, fall back to autocomplete input
    const labelField = findFieldByLabelText('To');
    if (labelField) toField = shadowInput(labelField) || labelField;

    try { click(toField.closest('ui-autocomplete-field') || toField); } catch(e) {}
    await sleep(200);

    await typeInto(toField, to);
    await sleep(300);

    try { toField.focus(); } catch(e) {}
    await sleep(100);

    return { ok: true };
  }

  // ── Action: fillSubject ─────────────────────────────────────────────────────
  async function fillSubject(subject) {
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
    await sleep(600);

    const sendBtn = Array.from(document.querySelectorAll('ui-button'))
      .find(b => {
        const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
        return lbl.includes('send') || lbl.includes('送信') || lbl.includes('envoyer') || lbl.includes('senden') || lbl.includes('enviar');
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

    // Handle "no subject" dialog
    const sendAnywayBtn = Array.from(document.querySelectorAll('button, ui-button'))
      .find(b => /send anyway/i.test((b.textContent || b.getAttribute('aria-label') || '')));
    if (sendAnywayBtn) {
      click(sendAnywayBtn);
      await sleep(300);
    }

    // Detect "invalid email address" dialog
    const invalidEmailDialog = Array.from(document.querySelectorAll('button'))
      .find(b => /^ok$/i.test((b.textContent || '').trim()));
    const dialogText = document.body.innerText || '';
    if (invalidEmailDialog && /invalid.*email|addresses.*invalid/i.test(dialogText)) {
      try { invalidEmailDialog.click(); } catch(e) {}
      return { error: 'Invalid email address rejected by iCloud' };
    }

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, hasMailUI: hasMailUI(), url: window.location.href });
      return true;
    }
    if (msg.action === 'diagnose') {
      sendResponse({ diag: diagnose() });
      return true;
    }
    if (msg.action === 'openCompose') {
      openCompose(msg.to)
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
  });
})();
