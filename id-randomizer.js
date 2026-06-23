// id-randomizer.js — Transaction ID, Invoice ID, date and email randomizer
// Ported from github.com/1ahmad12111/newsletterrandomizer (ID Randomizer tool)
// All functions are pure string manipulation — no DOM, works in service worker.

// ── Utilities ─────────────────────────────────────────────────────────────────

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _encodeAsEntities(str) {
  return str.split('').map(c => '&#' + c.charCodeAt(0) + ';').join('');
}

// Builds a regex that matches a value whose characters may be partially
// entity-encoded (e.g. "Order" might appear as "&#79;rder" or "Or&#100;er").
// Each character matches either literally or as any numeric entity form.
function _buildEntityFlexRegex(value) {
  const parts = value.split('').map(ch => {
    const code = ch.charCodeAt(0);
    const hex  = code.toString(16);
    const lit  = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `(?:${lit}|&#${code};|&#x${hex};|&#x${hex.toUpperCase()};)`;
  });
  return new RegExp(parts.join(''), 'g');
}

// ── ID Generator ──────────────────────────────────────────────────────────────
// Generates a new ID matching the exact character pattern of the original.
// Digits → random digits, letters → random letters, separators preserved.
// If original ends with "US", the new one also ends with "US".

const _ID_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateMatchingId(original) {
  const hasUS = original.toUpperCase().endsWith('US');
  const core  = hasUS ? original.slice(0, -2) : original;
  // Only randomize digit runs — preserve letter segments so structural
  // keywords like "Order", "PaymentMethod", "Amount" stay intact in
  // compound IDs (e.g. Order_3000013216360905-PaymentMethod_-567388754)
  const isCompound = /[_]/.test(core);
  let result  = '';
  for (let i = 0; i < core.length; i++) {
    const c = core[i];
    if (/[0-9]/.test(c)) {
      // Keep leading digit of each numeric run non-zero
      const prevIsDigit = i > 0 && /[0-9]/.test(core[i - 1]);
      result += prevIsDigit
        ? String(Math.floor(Math.random() * 10))
        : String(Math.floor(Math.random() * 9) + 1);
    } else if (!isCompound && /[A-Za-z]/.test(c)) {
      // For simple alphanumeric IDs (no underscores), randomize letters too
      const pool = /[a-z]/.test(c) ? _ID_LETTERS.toLowerCase() : _ID_LETTERS;
      result += pool[Math.floor(Math.random() * pool.length)];
    } else {
      result += c;
    }
  }
  return result + (hasUS ? 'US' : '');
}

// ── Email Generator ───────────────────────────────────────────────────────────
// Derives a randomized realistic support email from the seller/merchant name.

const _EMAIL_PREFIXES = ['info','support','billing','hello','contact','sales','service','orders','noreply','admin','help','accounts'];
const _EMAIL_TLDS     = ['com','net','org','io','co'];

function _domainFromName(name) {
  return name
    .replace(/(LLC|Ltd|Inc|Corp|Co|Limited|PLC|GmbH)\.?/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
}

function _acronymFromName(name) {
  return name
    .replace(/(LLC|Ltd|Inc|Corp|Co|Limited|PLC|GmbH)\.?/gi, '')
    .trim()
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toLowerCase();
}

function generateEmail(sellerName) {
  const domain  = _domainFromName(sellerName);
  const acronym = _acronymFromName(sellerName);
  const tld     = _EMAIL_TLDS[Math.floor(Math.random() * _EMAIL_TLDS.length)];
  const prefix  = _EMAIL_PREFIXES[Math.floor(Math.random() * _EMAIL_PREFIXES.length)];
  const styles  = [
    `${prefix}@${domain}.${tld}`,
    `${prefix}.${acronym}@${domain}.${tld}`,
    `${acronym}.${prefix}@${domain}.${tld}`,
    `${prefix}@${acronym}.${tld}`,
  ];
  return styles[Math.floor(Math.random() * styles.length)];
}

// ── Value Replacer ────────────────────────────────────────────────────────────
// Replaces all occurrences of oldValue with newValue in HTML source,
// handling both plain text form and entity-encoded form (&#NN; sequences).

function replaceValue(html, oldValue, newValue, isEmail) {
  let count = 0;
  let out = html;

  if (isEmail) {
    // Emails have @ and . — use split/join, not RegExp
    if (out.includes(oldValue)) {
      count += out.split(oldValue).length - 1;
      out = out.split(oldValue).join(newValue);
    }
    const encOld = _encodeAsEntities(oldValue);
    const encNew = _encodeAsEntities(newValue);
    if (out.includes(encOld)) {
      count += out.split(encOld).length - 1;
      out = out.split(encOld).join(encNew);
    }
    // Partially entity-encoded form
    if (!count) {
      const flexRe = _buildEntityFlexRegex(oldValue);
      out = out.replace(flexRe, () => { count++; return newValue; });
    }
    // Also walk-and-replace by @ position (handles partial entity encoding)
    const atPos = out.indexOf('@');
    if (!count && atPos !== -1) {
      let s = atPos - 1;
      while (s >= 0 && /[a-zA-Z0-9.\-_+]/.test(out[s])) s--;
      s++;
      let e = atPos + 1;
      while (e < out.length && /[a-zA-Z0-9.\-]/.test(out[e])) e++;
      const found = out.slice(s, e);
      if (found.includes('@') && found.includes('.')) {
        out = out.slice(0, s) + newValue + out.slice(e);
        count++;
      }
    }
  } else {
    // Plain form with word boundaries
    const plainRe = new RegExp('(?<![\\w])' + _escapeRegex(oldValue) + '(?![\\w])', 'g');
    out = out.replace(plainRe, () => { count++; return newValue; });
    // Fully entity-encoded form
    const encOld = _encodeAsEntities(oldValue);
    const encNew = _encodeAsEntities(newValue);
    if (encOld !== oldValue && out.includes(encOld)) {
      count += out.split(encOld).length - 1;
      out = out.split(encOld).join(encNew);
    }
    // Partially entity-encoded form (handles upload-time encoding that only encoded some chars)
    if (!count) {
      const flexRe = _buildEntityFlexRegex(oldValue);
      out = out.replace(flexRe, () => { count++; return newValue; });
    }
  }

  return { out, count };
}

// ── Date Formatter ────────────────────────────────────────────────────────────
// Converts "2026-06-18" (ISO from storage) → "Jun 18 2026" (display format)

const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateLike(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${_MONTHS[m - 1]} ${d} ${y}`;
}

// ── Main per-email randomizer ─────────────────────────────────────────────────
// Called once per email in the send loop.
// detected: { txnValue, invValue, dateValue, sellerName, emailValue }
// fixedDateIso: "2026-06-18" string set by user in popup

function randomizeIds(html, detected, fixedDateIso) {
  let out = html;
  const log = [];

  const { txnValue, invValue, dateValue, sellerName, emailValue } = detected;

  // Transaction ID
  if (txnValue) {
    const newTxn = generateMatchingId(txnValue);
    const r = replaceValue(out, txnValue, newTxn);
    out = r.out;
    log.push('TxnID: ' + txnValue + ' → ' + newTxn + ' (' + r.count + ' replacements)');
  }

  // Invoice / Order ID
  if (invValue) {
    const newInv = generateMatchingId(invValue);
    const r = replaceValue(out, invValue, newInv);
    out = r.out;
    log.push('InvID: ' + invValue + ' → ' + newInv + ' (' + r.count + ' replacements)');
  }

  // Date (fixed, user-set)
  if (dateValue && fixedDateIso) {
    const newDateStr = formatDateLike(fixedDateIso);
    const r = replaceValue(out, dateValue, newDateStr);
    out = r.out;
    if (r.count > 0) log.push('Date: ' + dateValue + ' → ' + newDateStr);
  }

  // Support email (randomized per email from seller name)
  if (emailValue && sellerName) {
    const newEmail = generateEmail(sellerName);
    const r = replaceValue(out, emailValue, newEmail, true);
    out = r.out;
    if (r.count > 0) log.push('Email: ' + emailValue + ' → ' + newEmail);
  }

  return { out, log };
}
