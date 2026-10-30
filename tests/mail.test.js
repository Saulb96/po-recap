const test = require('node:test');
const assert = require('node:assert/strict');
const Mail = require('../mail.js');

const enc = s => Buffer.from(s, 'latin1');
const b64 = bytes => Buffer.from(bytes).toString('base64').replace(/(.{76})/g, '$1\r\n');
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x80, 0x9f, 0x0d, 0x0a]);   // "%PDF-1.7" and awkward bytes

function email(parts, { subject = 'POs', boundary = 'b1' } = {}) {
  return [`Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', 'This is a multi-part message.',
    ...parts.flatMap(p => [`--${boundary}`, p]), `--${boundary}--`, ''].join('\r\n');
}
const textPart = 'Content-Type: text/plain; charset=utf-8\r\n\r\nHi, the POs are attached.';
const pdfPart = (name, bytes = PDF) => `Content-Type: application/pdf; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(bytes)}`;

test('an attached PDF comes out byte for byte, the message text does not', () => {
  const m = Mail.parseEml(enc(email([textPart, pdfPart('DomesticVendor_0900101.pdf')])));
  assert.equal(m.subject, 'POs');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].name, 'DomesticVendor_0900101.pdf');
  assert.deepEqual([...m.attachments[0].bytes], [...PDF]);
});

test('several attachments, a subject and file names in encoded words, and RFC 2231 names', () => {
  const parts = [
    textPart,
    pdfPart('=?UTF-8?B?' + Buffer.from('PO 900101 – Marshalls.pdf').toString('base64') + '?='),
    "Content-Type: application/pdf\r\nContent-Disposition: attachment; filename*=UTF-8''PO%20900102%20%E2%80%93%20TJ.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64(PDF),
    "Content-Type: application/pdf\r\nContent-Disposition: attachment;\r\n filename*0*=UTF-8''Distro%20;\r\n filename*1=\"900101.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64(PDF),
  ];
  const m = Mail.parseEml(enc(email(parts, { subject: '=?UTF-8?Q?Marmaxx_buy_=E2=80=93_10/27?=' })));
  assert.equal(m.subject, 'Marmaxx buy – 10/27');
  assert.deepEqual(m.attachments.map(a => a.name), ['PO 900101 – Marshalls.pdf', 'PO 900102 – TJ.pdf', 'Distro 900101.pdf']);
});

test('an email attached to the email gives up its attachments too', () => {
  const inner = email([textPart, pdfPart('inner.pdf')], { subject: 'FW: distro', boundary: 'b2' });
  const outer = email([textPart, 'Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename="fw.eml"\r\n\r\n' + inner, pdfPart('outer.pdf')]);
  const m = Mail.parseEml(enc(outer));
  assert.deepEqual(m.attachments.map(a => a.name), ['inner.pdf', 'outer.pdf']);
  assert.deepEqual([...m.attachments[0].bytes], [...PDF]);
});

test('a forwarded email attached in base64 is decoded and gives up its attachments', () => {
  const inner = email([textPart, pdfPart('DomesticVendor_503154.pdf')], { subject: 'TJX PO', boundary: 'in' });
  const fw = 'Content-Type: message/rfc822\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="po.eml"\r\n\r\n' + b64(Buffer.from(inner, 'latin1'));
  const m = Mail.parseEml(enc(email([textPart, pdfPart('DomesticVendor_503155.pdf'), fw])));
  assert.deepEqual(m.attachments.map(a => a.name), ['DomesticVendor_503155.pdf', 'DomesticVendor_503154.pdf']);
  assert.deepEqual([...m.attachments[1].bytes], [...PDF]);
});

test('alternative text and html bodies are skipped; quoted-printable and unencoded attachments decode', () => {
  const alt = 'Content-Type: multipart/alternative; boundary="alt"\r\n\r\n--alt\r\nContent-Type: text/plain\r\n\r\nplain\r\n--alt\r\nContent-Type: text/html\r\n\r\n<p>html</p>\r\n--alt--';
  const qp = 'Content-Type: application/octet-stream; name="note.txt"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nline one=\r\n still one =C3=A9';
  const plain = 'Content-Type: application/pdf\r\nContent-Disposition: attachment; filename=plain.pdf\r\n\r\n%PDF-1.4 body';
  const m = Mail.parseEml(enc(email([alt, qp, plain])));
  assert.deepEqual(m.attachments.map(a => a.name), ['note.txt', 'plain.pdf']);
  assert.equal(Buffer.from(m.attachments[0].bytes).toString('utf8'), 'line one still one é');
  assert.equal(Buffer.from(m.attachments[1].bytes).toString('latin1'), '%PDF-1.4 body');
});

test('base64 decodes every byte value', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual([...Mail.base64(Buffer.from(all).toString('base64'))], [...all]);
});
