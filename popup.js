const emailListEl  = document.getElementById('emailList');
const fileInputEl  = document.getElementById('fileInput');
const htmlFileInputEl = document.getElementById('htmlFileInput');
const htmlFileNameEl  = document.getElementById('htmlFileName');
const emailCountEl = document.getElementById('emailCount');
const subjectEl    = document.getElementById('subject');
const bodyEl       = document.getElementById('body');
const isHtmlEl     = document.getElementById('isHtml');
const delayEl      = document.getElementById('delay');
const startBtn     = document.getElementById('startBtn');
const stopBtn      = document.getElementById('stopBtn');
const progressCard = document.getElementById('progressCard');
const progressBar  = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logEl        = document.getElementById('log');

// Restore saved draft
chrome.storage.local.get(['subject', 'body', 'isHtml', 'delay', 'emails'], (data) => {
  if (data.subject) subjectEl.value = data.subject;
  if (data.body)    bodyEl.value    = data.body;
  if (data.isHtml)  isHtmlEl.checked = data.isHtml;
  if (data.delay)   delayEl.value   = data.delay;
  if (data.emails)  { emailListEl.value = data.emails; updateCount(); }
});

function saveDraft() {
  chrome.storage.local.set({ subject: subjectEl.value, body: bodyEl.value, isHtml: isHtmlEl.checked, delay: delayEl.value, emails: emailListEl.value });
}
[subjectEl, bodyEl, emailListEl, delayEl, isHtmlEl].forEach(el => el.addEventListener('change', saveDraft));

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

// Load HTML newsletter file
htmlFileInputEl.addEventListener('change', () => {
  const file = htmlFileInputEl.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    bodyEl.value = e.target.result;
    isHtmlEl.checked = true;
    htmlFileNameEl.textContent = file.name;
    saveDraft();
  };
  reader.readAsText(file);
});

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
  const emails  = getEmails();
  const subject = subjectEl.value.trim();
  const body    = bodyEl.value.trim();
  const isHtml  = isHtmlEl.checked;
  const delay   = Math.max(1, parseInt(delayEl.value, 10) || 5);
  if (!emails.length) { alert('Please enter at least one email address.'); return; }
  if (!subject)       { alert('Please enter a subject.'); return; }
  if (!body)          { alert('Please enter a message body or upload an HTML file.'); return; }
  isSending = true;
  logEl.innerHTML = '';
  progressCard.style.display = 'flex';
  setUI(true);
  chrome.runtime.sendMessage({ action: 'startSending', emails, subject, body, isHtml, delay });
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
