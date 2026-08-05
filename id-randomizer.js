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
// Generates unique, readable support emails derived from the merchant name.
// Every address is composed only of real words (no digits, hyphens, or symbols)
// so it reads naturally, e.g. billing@evolvesolutions.com.
// Uniqueness per send run comes from:
//   1. Email prefix words (×22) — info, support, billing, orders, …
//   2. Domain word combinations from the merchant name (prefix × anchor × suffix)
//   3. Normal TLDs only — com, net, org
//   4. In-session deduplication Set — guaranteed no repeat per send run

const _EMAIL_PREFIXES = ['info','support','billing','hello','contact','sales','service','orders','noreply','admin','help','accounts','team','care','desk','office','reply','invoice','payments','notify','alerts','updates'];
// Normal, widely-recognised TLDs only — keeps generated emails readable and legitimate-looking.
const _EMAIL_TLDS     = ['com','net','org'];

// In-memory dedup sets — cleared at the start of each send run via resetEmailDedup()
const _usedEmails  = new Set();
const _usedDomains = new Set();

function resetEmailDedup() {
  _usedEmails.clear();
  _usedDomains.clear();
}

function _domainFromName(name) {
  return name
    .replace(/\b(LLC|Ltd|Inc|Corp|Co|Limited|PLC|GmbH)\b\.?/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
}

function _acronymFromName(name) {
  return name
    .replace(/\b(LLC|Ltd|Inc|Corp|Co|Limited|PLC|GmbH)\b\.?/gi, '')
    .trim()
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toLowerCase();
}

// Domain composition parts — all neutral, professional-sounding
const _DOM_PREFIXES = ['get','my','use','try','go','the','pay','one','top','pro','smart','fast','best','true','real','easy','now','new','just','next'];
const _DOM_SUFFIXES = ['pay','shop','store','hub','hq','group','team','co','desk','pro','app','direct','online','central','plus','global','works','world','systems','services','support','billing','portal','connect','point','link','base','zone','space','place'];

// Picks a merchant-related anchor. Returns array of 2–3 unique anchor strings,
// each at least 3 chars, so every domain is recognisably tied to the merchant.
function _anchors(name) {
  const full      = _domainFromName(name);
  const acronym   = _acronymFromName(name);
  const words     = name
    .replace(/\b(LLC|Ltd|Inc|Corp|Co|Limited|PLC|GmbH)\b\.?/gi, '')
    .trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const firstWord = words[0] || full;

  const candidates = [full, firstWord, acronym].filter(a => a && a.length >= 3);
  // Dedupe while preserving order
  return [...new Set(candidates)];
}

// Build one candidate domain string — always contains the merchant anchor.
// Parts are concatenated into a single readable word (no hyphens, no digits),
// e.g. "evolvesolutions", "getevolvesolutions", "evolvesolutionsgroup".
function _buildDomain(anchorList) {
  const anchor  = anchorList[Math.floor(Math.random() * anchorList.length)];
  const usePrefix  = Math.random() < 0.30;
  const useSuffix  = Math.random() < 0.50;
  const prefix  = usePrefix  ? _DOM_PREFIXES[Math.floor(Math.random() * _DOM_PREFIXES.length)] : '';
  const suffix  = useSuffix  ? _DOM_SUFFIXES[Math.floor(Math.random() * _DOM_SUFFIXES.length)] : '';

  // Assemble: [prefix]anchor[suffix] — one clean, pronounceable token.
  return prefix + anchor + suffix;
}

// Generate a domain that has never been used in this send run.
// Uniqueness comes from prefix/suffix/anchor word combinations, not digits,
// so every domain stays readable.
function _uniqueDomain(anchorList) {
  for (let i = 0; i < 200; i++) {
    const d = _buildDomain(anchorList);
    if (!_usedDomains.has(d)) {
      _usedDomains.add(d);
      return d;
    }
  }
  // Readable fallback: exhaustively combine anchor with each suffix word.
  const anchor = anchorList[0];
  for (const suffix of _DOM_SUFFIXES) {
    const d = anchor + suffix;
    if (!_usedDomains.has(d)) {
      _usedDomains.add(d);
      return d;
    }
  }
  // Last-resort fallback (extremely unlikely): prefix+anchor+suffix pairs.
  for (const prefix of _DOM_PREFIXES) {
    for (const suffix of _DOM_SUFFIXES) {
      const d = prefix + anchor + suffix;
      if (!_usedDomains.has(d)) {
        _usedDomains.add(d);
        return d;
      }
    }
  }
  _usedDomains.add(anchor);
  return anchor;
}

function generateEmail(sellerName) {
  const anchorList = _anchors(sellerName);
  const domain     = _uniqueDomain(anchorList);           // always unique per send
  const tld        = _EMAIL_TLDS[Math.floor(Math.random() * _EMAIL_TLDS.length)];
  const prefix     = _EMAIL_PREFIXES[Math.floor(Math.random() * _EMAIL_PREFIXES.length)];
  const anchor     = anchorList[0];

  // Readable styles only — no digits, no acronyms, no symbols.
  const styles = [
    `${prefix}@${domain}.${tld}`,
    `${anchor}.${prefix}@${domain}.${tld}`,
    `${prefix}@${domain}.${tld}`,                         // plain style repeated intentionally for weight
  ];
  return styles[Math.floor(Math.random() * styles.length)];
}

// Full dedup wrapper — domain is already unique (via _uniqueDomain inside generateEmail).
// This Set guards the complete email address as a final safety net.
function generateUniqueEmail(sellerName) {
  for (let i = 0; i < 100; i++) {
    const email = generateEmail(sellerName);
    if (!_usedEmails.has(email)) {
      _usedEmails.add(email);
      return email;
    }
  }
  // Readable fallback: pair every prefix with the seller anchor as the local part.
  const anchor = _anchors(sellerName)[0];
  const tld    = _EMAIL_TLDS[Math.floor(Math.random() * _EMAIL_TLDS.length)];
  for (const prefix of _EMAIL_PREFIXES) {
    const email = `${prefix}.${anchor}@${_uniqueDomain(_anchors(sellerName))}.${tld}`;
    if (!_usedEmails.has(email)) {
      _usedEmails.add(email);
      return email;
    }
  }
  // Final guard — still readable, just reuses the freshest unique domain.
  const fallback = `${anchor}@${_uniqueDomain(_anchors(sellerName))}.${tld}`;
  _usedEmails.add(fallback);
  return fallback;
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
    // Plain form with word boundaries.
    // Spaces in the value become \s+ so a date like "Jun 30, 2026" also matches
    // when the HTML source has a newline between "Jun" and "30," (common in
    // email templates where long lines are wrapped in the source).
    const escapedPattern = _escapeRegex(oldValue).replace(/ /g, '\\s+');
    const plainRe = new RegExp('(?<![\\w])' + escapedPattern + '(?![\\w])', 'g');
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
  return `${_MONTHS[m - 1]} ${d}, ${y}`;
}

// ── Split-tag email replacer ──────────────────────────────────────────────────
// Handles the case where an email address is split across multiple HTML tags,
// e.g. <a>support@</a><a>evolvesolutionsllc</a><a>.com</a>
// In this pattern the complete email never appears as a string in the source,
// so normal string/regex replacement misses it entirely.

function _replaceEmailSplitTags(html, oldEmail, newEmail) {
  const atIdx = oldEmail.indexOf('@');
  if (atIdx === -1) return html;

  const oldLocal     = oldEmail.slice(0, atIdx);        // "support"
  const oldDomainFull = oldEmail.slice(atIdx + 1);      // "evolvesolutionsllc.com"
  const newAtIdx     = newEmail.indexOf('@');
  const newLocal     = newEmail.slice(0, newAtIdx);     // "billing"
  const newDomainFull = newEmail.slice(newAtIdx + 1);   // "evolvesolutions.net"

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let out = html;

  // ── Pass 1: local part in its own text node (">support@<") ───────────────
  const localAtRe = new RegExp('>' + esc(oldLocal) + '@<', 'g');
  let localCount = 0;
  out = out.replace(localAtRe, () => { localCount++; return '>' + newLocal + '@<'; });

  if (localCount > 0) {
    // ── Pass 2: domain may be split further (">evolvesolutionsllc<" and ">.com<")
    //            or together (">evolvesolutionsllc.com<")

    // Try full domain as one text node first
    const fullDomRe = new RegExp('>' + esc(oldDomainFull) + '<', 'g');
    out = out.replace(fullDomRe, () => '>' + newDomainFull + '<');

    // Then try domain body and TLD as separate text nodes
    const dotIdx    = oldDomainFull.lastIndexOf('.');
    const oldDomain = oldDomainFull.slice(0, dotIdx);    // "evolvesolutionsllc"
    const oldTld    = oldDomainFull.slice(dotIdx);        // ".com"
    const newDotIdx = newDomainFull.lastIndexOf('.');
    const newDomain = newDomainFull.slice(0, newDotIdx);
    const newTld    = newDomainFull.slice(newDotIdx);

    if (oldDomain) {
      const domRe = new RegExp('>' + esc(oldDomain) + '<', 'g');
      out = out.replace(domRe, () => '>' + newDomain + '<');
    }
    if (oldTld) {
      const tldRe = new RegExp('>' + esc(oldTld) + '<', 'g');
      out = out.replace(tldRe, () => '>' + newTld + '<');
    }
  }

  // ── Pass 3: local+@ not isolated but email split as "support@evolvesolutionsllc" + ".com"
  if (localCount === 0) {
    const localDomRe = new RegExp('>' + esc(oldLocal + '@' + oldDomainFull.split('.')[0]) + '<', 'g');
    let ld = 0;
    out = out.replace(localDomRe, () => { ld++; return '>' + newLocal + '@' + newDomainFull.split('.')[0] + '<'; });
    if (ld > 0) {
      const dotIdx = oldDomainFull.lastIndexOf('.');
      const tldRe = new RegExp('>' + esc(oldDomainFull.slice(dotIdx)) + '<', 'g');
      out = out.replace(tldRe, () => '>' + newDomainFull.slice(newDomainFull.lastIndexOf('.')) + '<');
    }
  }

  return out;
}

// ── Main per-email randomizer ─────────────────────────────────────────────────
// Called once per email in the send loop.
// detected: { txnValue, invValue, dateValue, sellerName, emailValue, phoneValue }
// fixedDateIso: "2026-06-18" string set by user in popup
// newPhone: replacement phone string (null/empty = skip)

function randomizeIds(html, detected, fixedDateIso, newPhone) {
  let out = html;
  const log = [];

  const { txnValue, invValue, dateValue, sellerName, emailValue, emailHref, phoneValue } = detected;

  let newTxnId = null;
  let newInvId = null;

  // Transaction ID
  if (txnValue) {
    newTxnId = generateMatchingId(txnValue);
    const r = replaceValue(out, txnValue, newTxnId);
    out = r.out;
    log.push('TxnID: ' + txnValue + ' → ' + newTxnId + ' (' + r.count + ' replacements)');
  }

  // Invoice / Order ID
  if (invValue) {
    newInvId = generateMatchingId(invValue);
    const r = replaceValue(out, invValue, newInvId);
    out = r.out;
    log.push('InvID: ' + invValue + ' → ' + newInvId + ' (' + r.count + ' replacements)');
  }

  // Date (fixed, user-set)
  if (dateValue && fixedDateIso) {
    const newDateStr = formatDateLike(fixedDateIso);
    const r = replaceValue(out, dateValue, newDateStr);
    out = r.out;
    if (r.count > 0) log.push('Date: ' + dateValue + ' → ' + newDateStr);
  }

  // Support email (randomized per email from seller name)
  // Use emailHref as fallback when visible email is null (split-tag emails don't survive plain-text conversion)
  const primaryEmail = emailValue || emailHref;
  if (primaryEmail && sellerName) {
    const newEmail = generateUniqueEmail(sellerName);
    let emailReplaced = false;

    // Replace the visible email (may be complete string or split across tags)
    if (emailValue) {
      const r = replaceValue(out, emailValue, newEmail, true);
      out = r.out;
      if (r.count > 0) emailReplaced = true;
    }

    // Replace the href email (always attempt — covers href="" attributes)
    if (emailHref) {
      const rh = replaceValue(out, emailHref, newEmail, true);
      out = rh.out;
      if (rh.count > 0) emailReplaced = true;
    }

    // Split-tag pass: handles email fragmented across separate HTML tags
    // (e.g. <a>support@</a><a>domain</a><a>.com</a>) — normal string match misses these
    const beforeSplit = out;
    out = _replaceEmailSplitTags(out, primaryEmail, newEmail);
    if (out !== beforeSplit) emailReplaced = true;

    // Also run split-tag pass for href email if different from primary
    if (emailHref && emailHref !== primaryEmail) {
      const beforeSplitH = out;
      out = _replaceEmailSplitTags(out, emailHref, newEmail);
      if (out !== beforeSplitH) emailReplaced = true;
    }

    if (emailReplaced) log.push('Email: ' + primaryEmail + ' → ' + newEmail);
  }

  // Helpline phone (fixed replacement — only when user entered a new number)
  if (newPhone && phoneValue) {
    const r = replaceValue(out, phoneValue, newPhone);
    out = r.out;
    // Also replace the tel: href variant (digits only, with +1 country code)
    const oldDigits = phoneValue.replace(/[^\d]/g, '');
    const newDigits = newPhone.replace(/[^\d]/g, '');
    const telVariants = ['+1' + oldDigits, oldDigits];
    for (const tv of telVariants) {
      if (out.includes(tv)) {
        out = out.split(tv).join('+1' + newDigits);
      }
    }
    if (r.count > 0) log.push('Phone: ' + phoneValue + ' → ' + newPhone);
  }

  return { out, log, newTxnId, newInvId };
}
