const emailListEl    = document.getElementById('emailList');
const fileInputEl    = document.getElementById('fileInput');
const htmlFileInputEl = document.getElementById('htmlFileInput');
const versionListEl  = document.getElementById('versionList');
const versionHintEl  = document.getElementById('versionHint');
const emailCountEl   = document.getElementById('emailCount');
const subjectListEl  = document.getElementById('subjectList');
const bodyEl         = document.getElementById('body');
const isHtmlEl       = document.getElementById('isHtml');
const delayEl        = document.getElementById('delay');
const batchSizeEl    = document.getElementById('batchSize');
const randomizeEl    = document.getElementById('randomizeHtml');
const entityEncodeEl = document.getElementById('entityEncode');
const entityRateEl   = document.getElementById('entityRate');
const entityRateValEl = document.getElementById('entityRateVal');
const entityRateRowEl = document.getElementById('entityRateRow');
const startBtn       = document.getElementById('startBtn');
const stopBtn        = document.getElementById('stopBtn');
const progressCard   = document.getElementById('progressCard');
const progressBar    = document.getElementById('progressBar');
const progressText   = document.getElementById('progressText');
const logEl          = document.getElementById('log');

let htmlVersions = [];

// ── Entity encoding (applied once at upload time) ─────────────────────────────
// Mirrors manual pre-encoding: encodes alphanumeric text chars to &#NNN; / &#xNN;
// & is excluded to avoid double-encoding existing &amp; &lt; etc.
function _toEntity(ch) {
  const code = ch.charCodeAt(0);
  const hex = code.toString(16);
  const forms = [`&#${code};`, `&#x${hex};`, `&#x${hex.toUpperCase()};`];
  return forms[Math.floor(Math.random() * forms.length)];
}
function applyEntityEncoding(html, rate) {
  return html.replace(/>([^<]+)</g, (match, text) => {
    if (!text.trim()) return match;
    // Match existing &entities; first (pass through untouched), then encode lone chars
    const encoded = text.replace(/(&[a-zA-Z#][a-zA-Z0-9]*;)|([a-zA-Z0-9!?,.\-_])/g, (m, entity, ch) => {
      if (entity) return entity; // preserve &nbsp; &amp; &#160; etc. intact
      return Math.random() < rate ? _toEntity(ch) : ch;
    });
    return '>' + encoded + '<';
  });
}

// ── Restore saved draft ───────────────────────────────────────────────────────

chrome.storage.local.get([
  'subjectList', 'body', 'isHtml', 'delay', 'emails',
  'batchSize', 'htmlVersions', 'randomizeHtml', 'entityEncode', 'entityRate'
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
  if (data.htmlVersions && data.htmlVersions.length) {
    htmlVersions = data.htmlVersions;
    renderVersions();
  }
});

function saveDraft() {
  chrome.storage.local.set({
    subjectList: subjectListEl.value,
    body: bodyEl.value,
    isHtml: isHtmlEl.checked,
    delay: delayEl.value,
    emails: emailListEl.value,
    batchSize: batchSizeEl.value,
    htmlVersions,
    randomizeHtml: randomizeEl.checked,
    entityEncode: entityEncodeEl.checked,
    entityRate: Number(entityRateEl.value)
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

const encodeHintEl = document.getElementById('encodeHint');
function toggleEntityRate() {
  const on = entityEncodeEl.checked;
  entityRateRowEl.style.display = on ? 'flex' : 'none';
  encodeHintEl.style.display = on ? '' : 'none';
}

// ── Email list helpers ────────────────────────────────────────────────────────

function getEmails() {
  return emailListEl.value.split(/[\n,;]+/).map(e => e.trim()).filter(e => e && e.includes('@'));
}
function updateCount() {
  const n = getEmails().length;
  emailCountEl.textContent = n + ' email' + (n !== 1 ? 's' : '');
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
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let html = e.target.result;
      if (entityEncodeEl.checked) {
        const rate = Number(entityRateEl.value) / 100;
        html = applyEntityEncoding(html, rate);
      }
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
  const emails    = getEmails();
  const subjects  = getSubjects();
  const body      = bodyEl.value.trim();
  const isHtml    = isHtmlEl.checked;
  const delay     = Math.max(1, parseInt(delayEl.value, 10) || 5);
  const batchSize = Math.max(1, parseInt(batchSizeEl.value, 10) || 10);
  const randomize = randomizeEl.checked;

  if (!emails.length)   { alert('Please enter at least one email address.'); return; }
  if (!subjects.length) { alert('Please enter at least one subject line.'); return; }

  const bodies = htmlVersions.length ? htmlVersions.map(v => v.html) : [body];
  const useHtml = htmlVersions.length > 0 ? true : isHtml;

  if (!bodies[0]) { alert('Please enter a message body or upload at least one HTML file.'); return; }

  isSending = true;
  logEl.innerHTML = '';
  progressCard.style.display = 'flex';
  setUI(true);

  chrome.runtime.sendMessage({
    action: 'startSending',
    emails, subjects, bodies,
    isHtml: useHtml, delay, batchSize, randomize
  });
}

// ── Runtime messages ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    progressBar.style.width = Math.round((msg.sent / msg.total) * 100) + '%';
    progressText.textContent = msg.sent + ' / ' + msg.total;
  }
  if (msg.type === 'log')   addLog(msg.text, msg.level || 'info');
  if (msg.type === 'done')  { isSending = false; setUI(false); addLog('Done! Sent ' + msg.sent + ' of ' + msg.total + ' emails.', 'ok'); }
  if (msg.type === 'error') addLog('Error: ' + msg.text, 'err');
});
