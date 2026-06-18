const emailListEl  = document.getElementById('emailList');
const fileInputEl  = document.getElementById('fileInput');
const htmlFileInputEl = document.getElementById('htmlFileInput');
const versionListEl   = document.getElementById('versionList');
const versionHintEl   = document.getElementById('versionHint');
const emailCountEl = document.getElementById('emailCount');
const subjectEl    = document.getElementById('subject');
const bodyEl       = document.getElementById('body');
const isHtmlEl     = document.getElementById('isHtml');
const delayEl      = document.getElementById('delay');
const batchSizeEl  = document.getElementById('batchSize');
const startBtn     = document.getElementById('startBtn');
const stopBtn      = document.getElementById('stopBtn');
const progressCard = document.getElementById('progressCard');
const progressBar  = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logEl        = document.getElementById('log');

// In-memory list of { name, html } version objects
let htmlVersions = [];

// Restore saved draft
chrome.storage.local.get(['subject', 'body', 'isHtml', 'delay', 'emails', 'batchSize', 'htmlVersions'], (data) => {
  if (data.subject)      subjectEl.value      = data.subject;
  if (data.body)         bodyEl.value         = data.body;
  if (data.isHtml)       isHtmlEl.checked     = data.isHtml;
  if (data.delay)        delayEl.value        = data.delay;
  if (data.batchSize)    batchSizeEl.value    = data.batchSize;
  if (data.emails)       { emailListEl.value  = data.emails; updateCount(); }
  if (data.htmlVersions && data.htmlVersions.length) {
    htmlVersions = data.htmlVersions;
    renderVersions();
  }
});

function saveDraft() {
  chrome.storage.local.set({
    subject: subjectEl.value, body: bodyEl.value, isHtml: isHtmlEl.checked,
    delay: delayEl.value, emails: emailListEl.value, batchSize: batchSizeEl.value,
    htmlVersions
  });
}
[subjectEl, bodyEl, emailListEl, delayEl, isHtmlEl, batchSizeEl].forEach(el => el.addEventListener('change', saveDraft));

function getEmails() {
  return emailListEl.value.split(/[\n,;]+/).map(e => e.trim()).filter(e => e && e.includes('@'));
}
function updateCount() {
  const n = getEmails().length;
  emailCountEl.textContent = n + ' email' + (n !== 1 ? 's' : '');
}
emailListEl.addEventListener('input', updateCount);

// Load email list from CSV/TXT
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

// Add HTML version(s) — supports multi-file select
htmlFileInputEl.addEventListener('change', () => {
  const files = Array.from(htmlFileInputEl.files);
  if (!files.length) return;
  let loaded = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      htmlVersions.push({ name: file.name, html: e.target.result });
      loaded++;
      if (loaded === files.length) { renderVersions(); saveDraft(); }
    };
    reader.readAsText(file);
  });
  htmlFileInputEl.value = '';
});

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
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addLog(msg, type) {
  type = type || 'info';
  const el = document.createElement('div');
  el.className = 'log-entry log-' + type;
  el.textContent = msg;
  logEl.prepend(el);
}

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
  const subject   = subjectEl.value.trim();
  const body      = bodyEl.value.trim();
  const isHtml    = isHtmlEl.checked;
  const delay     = Math.max(1, parseInt(delayEl.value, 10) || 5);
  const batchSize = Math.max(1, parseInt(batchSizeEl.value, 10) || 10);

  if (!emails.length) { alert('Please enter at least one email address.'); return; }
  if (!subject)       { alert('Please enter a subject.'); return; }

  // Use uploaded versions if available, else fall back to textarea body
  const bodies = htmlVersions.length ? htmlVersions.map(v => v.html) : [body];
  const useHtml = htmlVersions.length > 0 ? true : isHtml;

  if (!bodies[0]) { alert('Please enter a message body or upload at least one HTML file.'); return; }

  isSending = true;
  logEl.innerHTML = '';
  progressCard.style.display = 'flex';
  setUI(true);
  chrome.runtime.sendMessage({ action: 'startSending', emails, subject, bodies, isHtml: useHtml, delay, batchSize });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    progressBar.style.width = Math.round((msg.sent / msg.total) * 100) + '%';
    progressText.textContent = msg.sent + ' / ' + msg.total;
  }
  if (msg.type === 'log')   addLog(msg.text, msg.level || 'info');
  if (msg.type === 'done')  { isSending = false; setUI(false); addLog('Done! Sent ' + msg.sent + ' of ' + msg.total + ' emails.', 'ok'); }
  if (msg.type === 'error') addLog('Error: ' + msg.text, 'err');
});
