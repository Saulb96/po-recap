// Saved emails (.eml) opened without a mail library: the subject and every attachment, including those of an email
// attached to the email. No page and no network, so node tests run it (tests/mail.test.js). index.html loads it as
// window.Mail; Outlook's .msg files go through @kenjiuno/msgreader there instead.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.Mail = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // bytes <-> a string of one character per byte, so base64 and quoted-printable bodies decode to the exact bytes
  function bytesToText(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }
  function textToBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(s) {
    const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let o = 0, buf = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
      buf = ((buf << 6) | B64.indexOf(clean[i])) & 0xffffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
    }
    return out.subarray(0, o);
  }
  function quotedPrintable(s) {
    return textToBytes(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  }
  function utf8(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return bytesToText(bytes); }
  }
  // =?UTF-8?B?...?= and =?UTF-8?Q?...?= words in a header (a subject, an attachment name)
  function words(s) {
    return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=\s*(?==\?)/g, '=?$1?$2?$3?=').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
      const bytes = /b/i.test(enc) ? base64(txt) : quotedPrintable(txt.replace(/_/g, ' '));
      return /utf-?8/i.test(cs) ? utf8(bytes) : bytesToText(bytes);
    });
  }
  // a part's headers: names in lower case, folded lines joined
  function headersOf(block) {
    const map = {};
    for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
      const m = /^([^:\s]+):\s*(.*)$/.exec(line);
      if (m) map[m[1].toLowerCase()] = m[2];
    }
    return map;
  }
  // a parameter of a header: name="x", name=x, name*=UTF-8''x, and name*0*= / name*1*= continuations
  function param(header, name) {
    const h = String(header || '');
    const pieces = [];
    const re = new RegExp('(?:^|;)\\s*' + name + '\\*(\\d+)(\\*?)\\s*=\\s*("([^"]*)"|[^;]*)', 'gi');
    let m;
    while ((m = re.exec(h))) pieces[+m[1]] = { star: !!m[2], v: m[4] != null ? m[4] : m[3].trim() };
    if (pieces.length) {
      const joined = pieces.filter(Boolean).map(p => p.v).join('');
      return pieces[0] && pieces[0].star ? ext(joined) : joined;
    }
    const star = new RegExp('(?:^|;)\\s*' + name + '\\*\\s*=\\s*("([^"]*)"|[^;]*)', 'i').exec(h);
    if (star) return ext(star[2] != null ? star[2] : star[1].trim());
    const plain = new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*("([^"]*)"|[^;]*)', 'i').exec(h);
    return plain ? words(plain[2] != null ? plain[2] : plain[1].trim()) : '';
  }
  // RFC 2231: charset'language'percent-encoded
  function ext(v) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(v);
    const raw = textToBytes((m ? m[2] : v).replace(/%([0-9A-Fa-f]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16))));
    return !m || /utf-?8/i.test(m[1]) ? utf8(raw) : bytesToText(raw);
  }

  function walk(text, out, depth) {
    const cut = /\r?\n\r?\n/.exec(text);
    const head = headersOf(cut ? text.slice(0, cut.index) : text);
    const body = cut ? text.slice(cut.index + cut[0].length) : '';
    const ct = head['content-type'] || 'text/plain';
    const type = ct.split(';')[0].trim().toLowerCase();
    if (type.startsWith('multipart/')) {
      const boundary = param(ct, 'boundary');
      if (!boundary || depth > 20) return;
      const parts = body.split(new RegExp('\\r?\\n?--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*\\r?\\n?'));
      for (const p of parts.slice(1)) if (p.trim()) walk(p, out, depth + 1);
      return;
    }
    if (type === 'message/rfc822' && depth <= 20) {
      // an attached email, sometimes itself encoded (forwarded as base64): decoded first, then read like any other
      const enc = (head['content-transfer-encoding'] || '').trim().toLowerCase();
      walk(enc === 'base64' ? bytesToText(base64(body)) : enc === 'quoted-printable' ? bytesToText(quotedPrintable(body)) : body, out, depth + 1);
      return;
    }
    const name = param(head['content-disposition'], 'filename') || param(ct, 'name');
    if (!name && !/^application\//.test(type)) return;   // the message's own text and inline pictures
    const enc = (head['content-transfer-encoding'] || '').trim().toLowerCase();
    const bytes = enc === 'base64' ? base64(body) : enc === 'quoted-printable' ? quotedPrintable(body) : textToBytes(body);
    out.push({ name: name || 'attachment', type, bytes });
  }

  // { subject, attachments: [{ name, type, bytes }] } for an .eml file's bytes
  function parseEml(bytes) {
    const text = bytesToText(bytes);
    const cut = /\r?\n\r?\n/.exec(text);
    const subject = words(headersOf(cut ? text.slice(0, cut.index) : text).subject || '');
    const attachments = [];
    walk(text, attachments, 0);
    return { subject, attachments };
  }

  return { parseEml, base64, words, param };
});
