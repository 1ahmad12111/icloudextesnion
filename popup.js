const emailListEl     = document.getElementById('emailList');
const fileInputEl     = document.getElementById('fileInput');
const htmlFileInputEl = document.getElementById('htmlFileInput');
const versionListEl   = document.getElementById('versionList');
const versionHintEl   = document.getElementById('versionHint');
const emailCountEl    = document.getElementById('emailCount');
const subjectListEl   = document.getElementById('subjectList');
const bodyEl          = document.getElementById('body');
const isHtmlEl        = document.getElementById('isHtml');
const delayEl         = document.getElementById('delay');
const batchSizeEl     = document.getElementById('batchSize');
const randomizeEl     = document.getElementById('randomizeHtml');
const entityEncodeEl  = document.getElementById('entityEncode');
const entityRateEl    = document.getElementById('entityRate');
const entityRateValEl = document.getElementById('entityRateVal');
const entityRateRowEl = document.getElementById('entityRateRow');
const encodeHintEl    = document.getElementById('encodeHint');
const idRandomizeEl   = document.getElementById('idRandomize');
const idRandomizePanelEl = document.getElementById('idRandomizePanel');
const idDetectedBoxEl = document.getElementById('idDetectedBox');
const idDateInputEl   = document.getElementById('idDateInput');
const idDateTodayBtn  = document.getElementById('idDateToday');
const chunkEnabledEl  = document.getElementById('chunkEnabled');
const chunkPanelEl    = document.getElementById('chunkPanel');
const chunkSizeEl     = document.getElementById('chunkSize');
const chunkDelayEl    = document.getElementById('chunkDelay');
const chunkHintEl     = document.getElementById('chunkHint');
const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const progressCard    = document.getElementById('progressCard');
const progressBar     = document.getElementById('progressBar');
const progressText    = document.getElementById('progressText');
const logEl           = document.getElementById('log');

let htmlVersions = [];
// Detected values from the first uploaded HTML version (used for ID randomization)
let idDetected = null; // { txnValue, invValue, dateValue, sellerName, emailValue }

// applyEntityEncoding() lives in randomizer.js (shared with background.js)

// ── ID detection (runs in popup — has DOM access for decodeEntities) ──────────

function _decodeEntities(str) {
  const t = document.createElement('textarea');
  t.innerHTML = str;
  return t.value;
}
function _toPlain(html) {
  return _decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function detectIds(html) {
  const plain = _toPlain(html);
  const txnMatch  = plain.match(/Transaction\s+ID\s*[:\s]+([A-Z0-9\-\._]*\d[A-Z0-9\-\._]*)/i);
  const invMatch  = plain.match(/(?:Invoice|Order)\s+ID\s*[:\s]+([A-Z0-9\-\._]*\d[A-Z0-9\-\._]*)/i);
  const dateMatch = plain.match(/Transaction\s+[Dd]ate\s*[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);

  // Primary: terminators are known section keywords
  let sellerMatch = plain.match(/(?:Seller|Merchant|Vendor|Company|Payee|Store|Retailer|Business)\s*[:\s]+([A-Za-z0-9 &.,'\-]{3,60}?)\s*(?:Instructions|support|Transaction|Order|Invoice|\(|$)/i);
  // Fallback: seller name row ends with an email address (local-part@domain).
  // The char class stops at '@', so the regex above fails.  Here we use the
  // email's local part as the implicit terminator.
  if (!sellerMatch) {
    sellerMatch = plain.match(/(?:Seller|Merchant|Vendor|Company|Payee|Store|Retailer|Business)\s*[:\s]+([A-Za-z0-9 &.,'\-]{3,60}?)\s+[a-zA-Z0-9._%+\-]+@/i);
  }

  const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  // Visible email: what the recipient actually sees (plain text, handles split tags)
  const emailMatchVisible = plain.match(EMAIL_RE);
  // Href email: may differ from visible (e.g. abbreviated href vs full display address)
  const fullDecoded = _decodeEntities(html);
  const emailMatchHref = fullDecoded.match(EMAIL_RE);

  // Prefer the visible email as the primary value; store href separately for href replacement
  const emailValue = emailMatchVisible ? emailMatchVisible[0].trim()
                   : emailMatchHref    ? emailMatchHref[0].trim()
                   : null;
  const emailHref  = emailMatchHref && emailMatchHref[0].trim() !== emailValue
                   ? emailMatchHref[0].trim()
                   : null;

  return {
    txnValue:   txnMatch    ? txnMatch[1].trim()    : null,
    invValue:   invMatch    ? invMatch[1].trim()     : null,
    dateValue:  dateMatch   ? dateMatch[1].trim()    : null,
    sellerName: sellerMatch ? sellerMatch[1].trim()  : null,
    emailValue,
    emailHref,
  };
}

function _parseDateToIso(str) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cleaned = str.trim().replace(',', '');
  const parts = cleaned.split(/\s+/);
  if (parts.length !== 3) return _todayIso();
  const mon = MONTHS.findIndex(m => m.toLowerCase() === parts[0].toLowerCase().slice(0, 3));
  if (mon === -1) return _todayIso();
  return `${parts[2]}-${String(mon + 1).padStart(2, '0')}-${String(parseInt(parts[1])).padStart(2, '0')}`;
}

function _todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function renderIdDetectedBox(detected) {
  if (!detected) {
    idDetectedBoxEl.innerHTML = '<span class="hint">Upload an HTML version to auto-detect fields.</span>';
    return;
  }
  const rows = [
    ['Transaction ID', detected.txnValue],
    ['Invoice ID',     detected.invValue],
    ['Date',           detected.dateValue],
    ['Seller',         detected.sellerName],
    ['Support Email',  detected.emailValue],
  ];
  const found = rows.filter(([, v]) => v);
  if (!found.length) {
    idDetectedBoxEl.innerHTML = '<span class="hint" style="color:#e67e22">⚠ No Transaction ID or Invoice ID detected in this file.</span>';
    return;
  }
  idDetectedBoxEl.innerHTML = found.map(([label, val]) =>
    `<div class="id-detected-row"><span class="id-det-label">${label}</span><span class="id-det-val">${escHtml(val)}</span></div>`
  ).join('');
}

// ── Restore state from background (survives popup close) ─────────────────────

function replayLogs(logs) {
  // Logs are buffered oldest-first; addLog prepends, so replay in reverse
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = logs[i];
    if (m.type === 'log') addLog(m.text, m.level || 'info');
  }
}

chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
  if (chrome.runtime.lastError || !status) return;
  if (status.logs && status.logs.length) {
    progressCard.style.display = 'flex';
    replayLogs(status.logs);
  }
  if (status.inProgress) {
    isSending = true;
    setUI(true);
    progressCard.style.display = 'flex';
    if (status.total > 0) {
      progressBar.style.width = Math.round((status.sent / status.total) * 100) + '%';
      progressText.textContent = status.sent + ' / ' + status.total;
    }
  }
});

// ── Restore saved draft ───────────────────────────────────────────────────────

chrome.storage.local.get([
  'subjectList', 'body', 'isHtml', 'delay', 'emails',
  'batchSize', 'htmlVersions', 'randomizeHtml', 'entityEncode', 'entityRate',
  'idRandomize', 'idDetected', 'fixedDateIso',
  'chunkEnabled', 'chunkSize', 'chunkDelay'
], (data) => {
  if (data.subjectList)   subjectListEl.value  = data.subjectList;
  if (data.body)          bodyEl.value         = data.body;
  if (data.isHtml)        isHtmlEl.checked     = data.isHtml;
  if (data.delay)         delayEl.value        = data.delay;
  if (data.batchSize)     batchSizeEl.value    = data.batchSize;
  if (data.emails)        { emailListEl.value  = data.emails; updateCount(); }
  if (data.randomizeHtml) randomizeEl.checked  = data.randomizeHtml;
  if (data.entityEncode)  { entityEncodeEl.checked = data.entityEncode; toggleEntityRate(); }
  if (data.entityRate != null) {
    entityRateEl.value = data.entityRate;
    entityRateValEl.textContent = data.entityRate + '%';
  }
  if (data.idRandomize) { idRandomizeEl.checked = true; toggleIdPanel(); }
  if (data.idDetected)  { idDetected = data.idDetected; renderIdDetectedBox(idDetected); }
  if (data.fixedDateIso) idDateInputEl.value = data.fixedDateIso;
  if (data.chunkEnabled) { chunkEnabledEl.checked = true; toggleChunkPanel(); }
  if (data.chunkSize)  chunkSizeEl.value  = data.chunkSize;
  if (data.chunkDelay) chunkDelayEl.value = data.chunkDelay;
  if (data.htmlVersions && data.htmlVersions.length) {
    htmlVersions = data.htmlVersions;
    renderVersions();
  }
});

function saveDraft() {
  chrome.storage.local.set({
    subjectList:  subjectListEl.value,
    body:         bodyEl.value,
    isHtml:       isHtmlEl.checked,
    delay:        delayEl.value,
    emails:       emailListEl.value,
    batchSize:    batchSizeEl.value,
    htmlVersions,
    randomizeHtml: randomizeEl.checked,
    entityEncode:  entityEncodeEl.checked,
    entityRate:    Number(entityRateEl.value),
    idRandomize:   idRandomizeEl.checked,
    idDetected,
    fixedDateIso:  idDateInputEl.value || null,
    chunkEnabled:  chunkEnabledEl.checked,
    chunkSize:     Number(chunkSizeEl.value) || 10,
    chunkDelay:    Number(chunkDelayEl.value) || 5,
  });
}

[subjectListEl, bodyEl, emailListEl, delayEl, isHtmlEl, batchSizeEl].forEach(el =>
  el.addEventListener('change', saveDraft)
);
randomizeEl.addEventListener('change', saveDraft);
entityEncodeEl.addEventListener('change', () => { toggleEntityRate(); saveDraft(); });
entityRateEl.addEventListener('input', () => {
  entityRateValEl.textContent = entityRateEl.value + '%';
  saveDraft();
});
idRandomizeEl.addEventListener('change', () => { toggleIdPanel(); saveDraft(); });
idDateInputEl.addEventListener('change', saveDraft);
idDateTodayBtn.addEventListener('click', () => { idDateInputEl.value = _todayIso(); saveDraft(); });
chunkEnabledEl.addEventListener('change', () => { toggleChunkPanel(); saveDraft(); });
chunkSizeEl.addEventListener('input',  () => { updateChunkHint(); saveDraft(); });
chunkDelayEl.addEventListener('input', () => { updateChunkHint(); saveDraft(); });

// ── Toggle helpers ────────────────────────────────────────────────────────────

function toggleEntityRate() {
  const on = entityEncodeEl.checked;
  entityRateRowEl.style.display = on ? 'flex' : 'none';
  encodeHintEl.style.display = on ? '' : 'none';
}

function toggleIdPanel() {
  idRandomizePanelEl.style.display = idRandomizeEl.checked ? '' : 'none';
}

function toggleChunkPanel() {
  chunkPanelEl.style.display = chunkEnabledEl.checked ? 'flex' : 'none';
  if (chunkEnabledEl.checked) updateChunkHint();
}

function updateChunkHint() {
  const n = getEmails().length;
  const size  = Math.max(1, parseInt(chunkSizeEl.value, 10) || 10);
  const delay = Math.max(1, parseInt(chunkDelayEl.value, 10) || 5);
  const chunks = n > 0 ? Math.ceil(n / size) : '?';
  chunkHintEl.textContent = n > 0
    ? chunks + ' chunk' + (chunks !== 1 ? 's' : '') + ' of up to ' + size + ' emails — ' + delay + 's pause between chunks'
    : 'Enter emails above to see chunk preview';
}

// ── Email list helpers ────────────────────────────────────────────────────────

function getEmails() {
  return emailListEl.value.split(/[\n,;]+/).map(e => e.trim()).filter(e => e && e.includes('@'));
}
function updateCount() {
  const n = getEmails().length;
  emailCountEl.textContent = n + ' email' + (n !== 1 ? 's' : '');
  if (chunkEnabledEl.checked) updateChunkHint();
}
emailListEl.addEventListener('input', updateCount);

function getSubjects() {
  return subjectListEl.value.split(/\n/).map(s => s.trim()).filter(Boolean);
}

// ── File loaders ──────────────────────────────────────────────────────────────

fileInputEl.addEventListener('change', () => {
  const file = fileInputEl.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const emails = [...e.target.result.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)].map(m => m[0]);
    emailListEl.value = emails.join('\n');
    updateCount(); saveDraft();
  };
  reader.readAsText(file);
});

htmlFileInputEl.addEventListener('change', () => {
  const files = Array.from(htmlFileInputEl.files);
  if (!files.length) return;
  let loaded = 0;
  files.forEach((file, fileIndex) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let html = e.target.result;

      // Detect IDs from the first file uploaded (template reference)
      if (fileIndex === 0 && htmlVersions.length === 0) {
        idDetected = detectIds(html);
        renderIdDetectedBox(idDetected);
        // Pre-fill date picker from detected date
        if (idDetected.dateValue && !idDateInputEl.value) {
          idDateInputEl.value = _parseDateToIso(idDetected.dateValue);
        }
      }

      // Entity encoding is applied at send time (in background.js) so that
      // per-send substitutions ({EMAIL}, ID randomization, email randomization)
      // always run on clean HTML first.
      htmlVersions.push({ name: file.name, html });
      loaded++;
      if (loaded === files.length) { renderVersions(); saveDraft(); }
    };
    reader.readAsText(file);
  });
  htmlFileInputEl.value = '';
});

// ── Version list UI ───────────────────────────────────────────────────────────

function renderVersions() {
  versionListEl.innerHTML = '';
  if (!htmlVersions.length) {
    versionHintEl.style.display = '';
    return;
  }
  versionHintEl.style.display = 'none';
  htmlVersions.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'version-row row';
    row.innerHTML =
      '<span class="version-badge">v' + (i + 1) + '</span>' +
      '<span class="version-name">' + escHtml(v.name) + '</span>' +
      '<button class="version-remove" data-i="' + i + '">&#x2715;</button>';
    versionListEl.appendChild(row);
  });
  versionListEl.querySelectorAll('.version-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      htmlVersions.splice(Number(btn.dataset.i), 1);
      if (!htmlVersions.length) { idDetected = null; renderIdDetectedBox(null); }
      renderVersions(); saveDraft();
    });
  });
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Log ───────────────────────────────────────────────────────────────────────

function addLog(msg, type) {
  type = type || 'info';
  const el = document.createElement('div');
  el.className = 'log-entry log-' + type;
  el.textContent = msg;
  logEl.prepend(el);
}

// ── Send flow ─────────────────────────────────────────────────────────────────

let isSending = false;
startBtn.addEventListener('click', startSending);
stopBtn.addEventListener('click', () => {
  isSending = false;
  chrome.runtime.sendMessage({ action: 'stop' });
  addLog('Stopped by user.', 'info');
  setUI(false);
});

function setUI(sending) {
  startBtn.disabled = sending;
  stopBtn.disabled  = !sending;
  progressCard.style.display = (sending || logEl.children.length) ? 'flex' : 'none';
}

async function startSending() {
  const emails     = getEmails();
  const subjects   = getSubjects();
  const body       = bodyEl.value.trim();
  const isHtml     = isHtmlEl.checked;
  const delay      = Math.max(1, parseInt(delayEl.value, 10) || 5);
  const batchSize  = Math.max(1, parseInt(batchSizeEl.value, 10) || 10);
  const randomize    = randomizeEl.checked;
  const entityEncode = entityEncodeEl.checked;
  const entityRate   = Number(entityRateEl.value) / 100;
  const idRandomize  = idRandomizeEl.checked;
  const fixedDateIso = idDateInputEl.value || null;
  const chunkEnabled = chunkEnabledEl.checked;
  const chunkSize    = Math.max(1, parseInt(chunkSizeEl.value, 10) || 10);
  const chunkDelay   = Math.max(1, parseInt(chunkDelayEl.value, 10) || 5);

  if (!emails.length)   { alert('Please enter at least one email address.'); return; }
  if (!subjects.length) { alert('Please enter at least one subject line.'); return; }

  const bodies  = htmlVersions.length ? htmlVersions.map(v => v.html) : [body];
  const useHtml = htmlVersions.length > 0 ? true : isHtml;

  if (!bodies[0]) { alert('Please enter a message body or upload at least one HTML file.'); return; }

  // Block sending if ID randomize is on but no IDs were detected
  if (idRandomize) {
    if (!idDetected || (!idDetected.txnValue && !idDetected.invValue)) {
      alert('ID Randomizer is ON but no Transaction ID or Invoice ID was detected in your HTML. Please upload a template with detectable IDs, or turn off ID randomization.');
      return;
    }
  }

  isSending = true;
  logEl.innerHTML = '';
  progressCard.style.display = 'flex';
  setUI(true);

  chrome.runtime.sendMessage({
    action: 'startSending',
    emails, subjects, bodies,
    isHtml: useHtml, delay, batchSize,
    randomize, entityEncode, entityRate,
    idRandomize, idDetected, fixedDateIso,
    chunkEnabled, chunkSize, chunkDelay
  });
}

// ── Runtime messages ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    progressBar.style.width = Math.round((msg.sent / msg.total) * 100) + '%';
    progressText.textContent = msg.sent + ' / ' + msg.total;
  }
  if (msg.type === 'chunkCountdown') {
    const pct = Math.round(((msg.chunkDelay - msg.remaining) / msg.chunkDelay) * 100);
    progressBar.style.width = pct + '%';
    progressText.textContent = 'Chunk pause — ' + msg.remaining + 's remaining';
  }
  if (msg.type === 'log')   addLog(msg.text, msg.level || 'info');
  if (msg.type === 'done')  { isSending = false; setUI(false); addLog('Done! Sent ' + msg.sent + ' of ' + msg.total + ' emails.', 'ok'); }
  if (msg.type === 'error') addLog('Error: ' + msg.text, 'err');
});
