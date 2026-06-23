// randomizer.js — HTML newsletter mutation engine
// Applies 8 mutations to make every email's HTML unique at the byte level
// while rendering identically to the reader.
// Extracted & ported from github.com/1ahmad12111/newsletterrandomizer

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function maybe(prob) {
  return Math.random() < prob;
}

// Apply fn only inside text nodes (between > and <), skip tag bodies
function mapTextNodes(html, fn) {
  return html.replace(/>([^<]+)</g, (match, text) => {
    if (!text.trim()) return match;
    return '>' + fn(text) + '<';
  });
}

// 1. Inject random HTML comments between closing tags
function addComments(html) {
  return html.replace(/(<\/(?:td|div|p|span|h[1-6]|li|table|tbody|tr)>)/gi, (m) => {
    if (!maybe(0.3)) return m;
    return m + `<!-- ${randomId()} -->`;
  });
}

// 2. Add unique data-* attributes to structural elements
function addDataAttrs(html) {
  const attrFns = [
    () => `data-v="${randomId()}"`,
    () => `data-id="${randomId()}"`,
    () => `data-ref="${randomId()}"`,
    () => `data-seq="${randInt(100, 9999)}"`,
    () => `data-t="${Date.now()}"`,
    () => `data-hash="${randomId()}"`,
    () => `data-key="${randInt(10000, 99999)}"`,
  ];
  return html.replace(/(<(?:table|tbody|tr|td|div|p|span|a)\s)/gi, (m) => {
    if (!maybe(0.5)) return m;
    return m + pick(attrFns)() + ' ';
  });
}

// 3. HTML entity encoding — applied at UPLOAD TIME (not send time) so the
// encoded string passes through insertHTML identically to a manually pre-encoded file.
// IMPORTANT: & is excluded from encoding to prevent double-encoding existing entities.
function toEntity(ch) {
  const code = ch.charCodeAt(0);
  return pick([`&#${code};`, `&#x${code.toString(16)};`, `&#x${code.toString(16).toUpperCase()};`]);
}

function encodeEntities(html, rate) {
  if (typeof rate !== 'number') rate = 0.4;
  // Never encode & (would break existing &amp; &lt; etc. into &#38;amp; etc.)
  return html.replace(/>([^<]+)</g, (match, text) => {
    if (!text.trim()) return match;
    const encoded = text.replace(/[a-zA-Z0-9!?,.\-_]/g, ch => maybe(rate) ? toEntity(ch) : ch);
    return '>' + encoded + '<';
  });
}

// 4. Inject invisible ghost spans (unique content, hidden from readers)
function addGhostSpans(html) {
  return html.replace(/(<\/(?:td|div|p|span|h[1-6]|li)>)(\s*)(?=<)/gi, (m, tag, ws) => {
    if (!maybe(0.25)) return m;
    const ghost = `<span style="display:none;font-size:0;color:transparent;max-height:0;overflow:hidden;mso-hide:all" aria-hidden="true">${randomId()}</span>`;
    return tag + ghost + ws;
  });
}

// 5. Expand CSS shorthand (padding/margin → long form)
function expandCss(html) {
  return html.replace(
    /\b(padding|margin):(\s*)([\d.]+(?:px|em|rem|%))((?:\s+[\d.]+(?:px|em|rem|%))*)/gi,
    (m, prop, sp, v1, rest) => {
      const parts = [v1, ...(rest.trim() ? rest.trim().split(/\s+/) : [])];
      const t = parts[0] || '0', r = parts[1] || t, b2 = parts[2] || t, l = parts[3] || r;
      const s = pick([' ', '  ']);
      return `${prop}-top:${s}${t};${s}${prop}-right:${s}${r};${s}${prop}-bottom:${s}${b2};${s}${prop}-left:${s}${l}`;
    }
  );
}

// 6. Shuffle attribute order on HTML tags
function shuffleAttrs(html) {
  return html.replace(/<(\w[\w-]*)(\s[^>]+?)>/g, (m, tag, attrStr) => {
    const attrs = [];
    const re = /(\s+[\w:@.\-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)/g;
    let match;
    while ((match = re.exec(attrStr)) !== null) attrs.push(match[1]);
    for (let i = attrs.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [attrs[i], attrs[j]] = [attrs[j], attrs[i]];
    }
    return '<' + tag + attrs.join('') + '>';
  });
}

// 7. Vary numeric attribute values (border, cellpadding)
function numericVariants(html) {
  return html
    .replace(/\bborder="?0"?/gi, () => pick(['border="0"', 'border=0']))
    .replace(/\bcellpadding="?0"?/gi, () => pick(['cellpadding="0"', 'cellpadding=0']));
}

// 8. Vary indentation/whitespace
function varyWhitespace(html) {
  const indent = pick(['  ', '    ', '\t']);
  return html.replace(/^([ \t]+)/gm, (m, ws) => {
    const unit = ws.includes('\t') ? 1 : 2;
    return indent.repeat(Math.max(1, Math.round(ws.length / unit)));
  });
}

// Main export — applies all 8 mutations in sequence
function randomizeHtml(html) {
  if (!html || !html.trim()) return html;
  let out = html;
  out = addComments(out);
  out = addDataAttrs(out);
  out = addGhostSpans(out);
  // entity encoding is NOT applied here — it runs at upload time in popup.js
  out = expandCss(out);
  out = shuffleAttrs(out);
  out = numericVariants(out);
  out = varyWhitespace(out);
  const id = `${Date.now()}-${randomId()}`;
  const header = pick([
    `<!-- build:${id} -->`,
    `<!-- generated:${id} -->`,
    `<!-- v${randInt(1,5)}.${randInt(0,9)}.${randInt(0,99)} id:${randomId()} -->`,
    `<!-- ref:${randomId()} ts:${Date.now()} -->`
  ]);
  return header + '\n' + out;
}

// ── Entity encoding ───────────────────────────────────────────────────────────
// Pure function — no DOM. Shared by popup.js and background.js.

function _toEntity(ch) {
  const code = ch.charCodeAt(0);
  const hex = code.toString(16);
  const forms = [`&#${code};`, `&#x${hex};`, `&#x${hex.toUpperCase()};`];
  return forms[Math.floor(Math.random() * forms.length)];
}

function applyEntityEncoding(html, rate) {
  return html.replace(/>([^<]+)</g, (match, text) => {
    if (!text.trim()) return match;
    const encoded = text.replace(/(&[a-zA-Z#][a-zA-Z0-9]*;)|([a-zA-Z0-9!?,.\-_])/g, (m, entity, ch) => {
      if (entity) return entity;
      return Math.random() < rate ? _toEntity(ch) : ch;
    });
    return '>' + encoded + '<';
  });
}
