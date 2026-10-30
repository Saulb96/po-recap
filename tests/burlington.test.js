const test = require('node:test');
const assert = require('node:assert/strict');
const Recap = require('../recap.js');
const { burlingtonPO, marmaxxPO, BDC } = require('./fixtures.js');

const BRUSH = { style: 'ZZ47001', desc: '9PC BRUSH SET', color: 'NUDE', cost: 4.4, per: 12, qty: 108 };
const SET16 = { style: 'ZZ80001', desc: '16PC MAKEUP BRUSH SET', color: 'BLK/WHT', cost: 7.25, per: 2, qty: 840 };
const SET5 = { style: 'ZZ80002', desc: '5PC DUAL BRUSH SET', color: 'BLK/WHT', cost: 4.4, per: 2, qty: 840 };
const one = (o = {}) => Recap.read('burlington', burlingtonPO(Object.assign({ version: 2, pos: [{ po: '900201101', lines: [BRUSH] }] }, o)), 'PO 900201101.pdf');
const two = (o = {}) => Recap.read('burlington', burlingtonPO(Object.assign({ version: 3, start: '19-MAY-27', cancel: '25-MAY-27',
  pos: [{ po: '900202501', lines: [SET16] }, { po: '900202502', lines: [SET5] }] }, o)), 'REVISED PO 900202501 900202502.pdf');

/* ---------------- the Burlington reader ---------------- */

test('a Burlington release: its PO, version, dates, DC, FOB, and the prepack line in units', () => {
  const r = one();
  assert.equal(r.error, undefined);
  assert.equal(r.pos.length, 1);
  const p = r.pos[0];
  assert.deepEqual({ ...p, lines: undefined }, {
    po: '900201101', banner: 'ZZ Sample (SMP) DC', dc: BDC, dept: 'Accsry', ref: '', buyer: '', orderDate: '2026-10-27', startShip: '2027-01-06', cancel: '2027-01-12',
    fob: { term: 'DESTINATION', city: 'SAMPLETOWN', state: 'CA', to: 'ZZ Sample (SMP) DC' }, version: 2, release: 'A', totalUnits: 1296, lines: undefined });
  assert.deepEqual(p.lines, [{ ln: '1', catg: '', code: '', style: 'ZZ47001', desc: '9PC BRUSH SET', color: 'NUDE', cost: 4.4, units: 1296, pack: 12,
    prepacks: 108, prepack: 'ZZ47001 NUDE 16', packType: 'INNERPACK' }]);
  assert.equal(Recap.fobLabel(p.fob), 'Destination: ZZ Sample (SMP) DC, Sampletown CA');
});

test('one release covering two PO numbers gives two POs, each with its own lines; a PO number printed in two pieces is one', () => {
  const r = two();
  assert.equal(r.error, undefined);
  assert.deepEqual(r.pos.map(p => [p.po, p.version, p.startShip, p.lines.map(l => l.style + ' ' + l.prepacks + 'x' + l.pack + '=' + l.units)]),
    [['900202501', 3, '2027-05-19', ['ZZ80001 840x2=1680']], ['900202502', 3, '2027-05-19', ['ZZ80002 840x2=1680']]]);
  assert.deepEqual(Recap.posOf(r).map(p => p.totalUnits), [1680, 1680]);
});

test('a PO with several prepacks, one with several sizes, and a block that runs onto the next page', () => {
  const trio = { style: 'ZZ80003', desc: 'TRIO', color: 'RED', cost: 1.5, per: 6, qty: 10, sizes: [{ size: 'S', qty: 2 }, { size: 'M', qty: 4 }] };
  const pages = burlingtonPO({ version: 1, pos: [{ po: '900203001', lines: [BRUSH, trio] }] });
  // the second block's lower half moved onto a page of its own, under that page's own headings
  const blockPage = pages[3], moved = blockPage.items.filter(i => i.y < 300 && i.y > 40);
  blockPage.items = blockPage.items.filter(i => !moved.includes(i));
  const extra = { n: 5, images: [], items: [{ s: 'Page 5', x: 488, y: 764, w: 20 }, { s: 'Vendor #', x: 64, y: 731, w: 30 }, { s: 'Vendor Name', x: 223, y: 731, w: 40 },
    { s: '500000000', x: 60, y: 712, w: 35 }, { s: 'A-METRO1 SOLUTIONS LLC', x: 177, y: 712, w: 90 }, { s: '27-OCT-26', x: 377, y: 712, w: 35 }, { s: '7', x: 489, y: 712, w: 4 },
    ...moved.map(i => Object.assign({}, i, { y: i.y + 380 })), { s: 'po version:', x: 21, y: 33, w: 40 }, { s: '1', x: 70, y: 33, w: 4 }] };
  pages.splice(4, 0, extra);
  pages.forEach((p, i) => { p.n = i + 1; });
  const r = Recap.read('burlington', pages, 'x.pdf');
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.pos[0].lines.map(l => [l.ln, l.style, l.units, l.pack]), [['1', 'ZZ47001', 1296, 12], ['2', 'ZZ80003', 60, 6]]);
});

test('refused, saying why: not a Burlington PO, totals that disagree, a PO without lines, a line for an unlisted PO', () => {
  assert.match(Recap.read('burlington', marmaxxPO({ po: '900101', ref: 'D1', banner: 'Marshalls', lines: [{ style: 'ZZ1', desc: 'X', cost: 1, units: 48, catg: '1' }] })).error,
    /isn't a Burlington PO/);
  assert.equal(one({ relUnits: 1300 }).error, 'The lines add up to 1,296 units, but page 1 says 1,300.');
  assert.equal(one({ relCost: 5700 }).error, 'The lines add up to $5,702.40, but page 1 says $5,700.00.');
  assert.equal(two({ cover: ['900202501', '900202502', '900202503'] }).error, 'Page 1 lists PO 900202503, but the file has no lines for it.');
  assert.match(two({ cover: ['900202501'] }).error, /^PO 900202502 line 1 \(ZZ80002\) is for a PO page 1 doesn't list/);
  assert.equal(two({ cover: ['900202501', '900202501'] }).error, 'Page 1 lists a PO number twice.');
});

test('refused: a version that can\'t be read or differs between pages, and prepack sums that don\'t add up', () => {
  assert.match(one({ noVersion: true }).error, /PO version couldn't be read/);
  assert.match(one({ versions: { 4: 3 } }).error, /different PO versions \(2, 3\)/);
  assert.match(one({ badSum: true }).error, /^PO 900201101 line 1 \(ZZ47001\): the prepack's sums don't agree/);
  assert.match(Recap.read('burlington', burlingtonPO({ version: 1, pos: [{ po: '900203001', lines: [{ ...BRUSH, sizes: [{ size: 'QTY', qty: 10 }] }] }] })).error,
    /the sizes add up to 10 units, but a prepack has 12/);
  assert.equal(Recap.dmy('06-JAN-27'), '2027-01-06');
  assert.equal(Recap.dmy('6-Jan-2027'), '2027-01-06');
  assert.equal(Recap.dmy('32-JAN-27'), null);
});

/* ---------------- versions in the checks before saving ---------------- */

const res = (r, file) => Object.assign({ file }, r);

test('checkBatch: a file covering two POs gives both; the same file twice is read once', () => {
  const r = two();
  const c = Recap.checkBatch([res(r, 'a.pdf'), res(r, 'a copy.pdf')], [], [], {});
  assert.deepEqual(c.accepted.map(p => [p.po, p.file]), [['900202501', 'a.pdf'], ['900202502', 'a.pdf']]);
  assert.deepEqual(c.refused, []);
  assert.equal(c.notes.length, 2);
  assert.match(c.notes[0], /^PO 900202501 was dropped 2 times/);
  assert.deepEqual(Recap.checkBatch([{ file: 'e.pdf', pos: [] }], [], [], {}).refused, [{ file: 'e.pdf', po: '', why: 'No PO was found in this file.' }]);
});

test('checkBatch: a newer version replaces the PO in this buy; the same or an older one is refused; another buy\'s PO is refused', () => {
  const v3 = res(two(), 'v3.pdf');
  const c = Recap.checkBatch([v3], [{ po: '900202501', version: 2 }, { po: '900202502', version: 2 }], [], {});
  assert.deepEqual(c.accepted.map(p => [p.po, p.version, p.replaces]), [['900202501', 3, 2], ['900202502', 3, 2]]);
  assert.deepEqual(Recap.checkBatch([v3], [{ po: '900202501', version: 3 }], [], {}).refused[0].why, 'PO 900202501 is already in this buy (version 3).');
  assert.deepEqual(Recap.checkBatch([v3], [{ po: '900202501', version: 4 }], [], {}).refused[0].why, 'PO 900202501 is version 4 in this buy; this file is version 3.');
  const other = Recap.checkBatch([v3], [], [{ name: 'Burlington buy 10/27', pos: ['900202502'] }], {});
  assert.deepEqual(other.accepted.map(p => p.po), ['900202501']);
  assert.equal(other.refused[0].why, 'PO 900202502 is already in “Burlington buy 10/27”. Add this version to that buy to bring it up to date there.');
  // plain PO numbers (an unversioned PO) still work as before
  assert.equal(Recap.checkBatch([v3], ['900202501'], [], {}).accepted.find(p => p.po === '900202501').replaces, 0);
});

test('checkBatch: two versions dropped together, the newest is used and the older named; two different copies of one version are refused', () => {
  const v2 = res(two({ version: 2 }), 'v2.pdf'), v3 = res(two(), 'v3.pdf');
  const c = Recap.checkBatch([v2, v3], [], [], {});
  assert.deepEqual(c.accepted.map(p => [p.po, p.version, p.file]), [['900202501', 3, 'v3.pdf'], ['900202502', 3, 'v3.pdf']]);
  assert.deepEqual(c.notes, ['v2.pdf is version 2 of PO 900202501; version 3 (v3.pdf) is the one used.', 'v2.pdf is version 2 of PO 900202502; version 3 (v3.pdf) is the one used.']);
  const odd = res(two({ pos: [{ po: '900202501', lines: [{ ...SET16, qty: 841 }] }, { po: '900202502', lines: [SET5] }] }), 'odd.pdf');
  const d = Recap.checkBatch([v3, odd, v2], [], [], {});
  assert.deepEqual(d.accepted.map(p => p.po), ['900202502']);
  assert.deepEqual(d.refused.map(r => [r.file, r.why]), [
    ['odd.pdf', 'Two different copies of PO 900202501, both version 3, were dropped (v3.pdf and odd.pdf). Drop only the one you want.'],
    ['v2.pdf', "This version 2 of PO 900202501 isn't used: the version 3 copies dropped with it disagree."],
    ['v3.pdf', 'Two different copies of PO 900202501, both version 3, were dropped (v3.pdf and odd.pdf). Drop only the one you want.']]);
});

/* ---------------- on the buy: FOB, DCs, prepacks, the sheet ---------------- */

const buyOf = pos => ({ id: 'b', name: 'Burlington buy 10/27', customer: 'burlington', pos, notes: {} });

test('FOB: Destination isn\'t flagged for Burlington; another term is, saying what\'s expected', () => {
  const p = one().pos[0];
  assert.deepEqual(Recap.flags('burlington', [p]).filter(f => f.kind === 'fob'), []);
  const q = one({ fob: 'ORIGIN' }).pos[0];
  assert.equal(Recap.fobLabel(q.fob), 'Origin');
  assert.deepEqual(Recap.flags('burlington', [q]).filter(f => f.kind === 'fob').map(f => f.text), ['FOB point is Origin, not Destination or LA, on 900201101.']);
  // Marmaxx keeps its rule
  assert.equal(Recap.CUSTOMERS[0].fobOK({ city: 'LOS ANGELES', state: 'CA' }), true);
  assert.equal(Recap.CUSTOMERS[0].fobOK({ term: 'DESTINATION', city: '', state: '' }), false);
});

test('the recap groups each ship window by DC; two POs to different DCs with the same lines aren\'t "sent twice"', () => {
  const a = one().pos[0], b = Object.assign({}, a, { po: '900201102', banner: 'ZZ Other (OTH) DC' });
  const rc = Recap.recap(buyOf([a, b]));
  assert.deepEqual(rc.windows.map(w => w.banners.map(x => x.banner + ':' + x.pos.map(p => p.po).join(','))), [['ZZ Other (OTH) DC:900201102', 'ZZ Sample (SMP) DC:900201101']]);
  assert.deepEqual(Recap.flags('burlington', [a, b]).filter(f => f.kind === 'twice'), []);
  const c = Object.assign({}, a, { po: '900201103' });
  assert.equal(Recap.flags('burlington', [a, c]).find(f => f.kind === 'twice').text, 'POs 900201101 and 900201103 have the same lines, units, DC and ship window. Was one sent twice?');
});

const MASTER = [
  ['Category', 'Sub', 'Brand', 'Product name', 'Style Number', 'Barcode', 'Inner', 'Master', 'Price', 'Quantity', 'Old Style name', 'Po Number', 'Factory', 'Order Date'],
  ['', '', '', 'Brush', 'ZZ47001', '', 12, 48, 1, 1, '', '102000', 'F', 46200],
  ['', '', '', 'Set', 'ZZ80001', '', 4, 48, 1, 1, '', '102001', 'F', 46300],
  ['', '', '', 'Set', 'ZZ80002', '', '', 48, 1, 1, '', '102001', 'F', 46300],
];

test('prepacks are checked against Master Sheet Live\'s Inner, on the sheet and on the saved copy', () => {
  const m = Recap.parseMaster(MASTER), copy = Recap.expandMaster(JSON.parse(JSON.stringify(Recap.compactMaster(m))));
  const pos = [one().pos[0], ...two().pos];
  for (const master of [m, copy]) {
    assert.deepEqual(Recap.flags('burlington', pos, master).filter(f => f.kind === 'pack').map(f => f.text), [
      "ZZ80001: prepack 2 on 900202501, but Master Sheet Live's Inner says 4 (row 3, PO 102001, ordered 10/5/2026).",
      'ZZ80002 has no inner pack (Inner) on Master Sheet Live.']);
  }
  const rows = Recap.recap(buyOf(pos)).rows;
  assert.deepEqual(rows.map(r => [r.style, Recap.packCell(r, m, 'inner').value]), [['ZZ47001', 12], ['ZZ80001', '2 (inner 4)'], ['ZZ80002', '2 (no inner pack)']]);
  // the carton (Master) would have flagged the brush: 12 isn't 48
  assert.ok(Recap.packIssues([pos[0]], m).length);
});

test('the Burlington sheet: DCs, a Prepack column, the PO versions, and no empty Buyer row', () => {
  const ws = Recap.worksheet(buyOf(two().pos), null, null, { packNote: 'checked against Master Sheet Live', packChecked: true });
  const cells = Object.keys(ws).filter(k => k[0] !== '!').map(k => String(ws[k].v));
  assert.ok(cells.includes('DC'), 'the mini table is by DC');
  assert.ok(cells.includes('Prepack'), 'the pack column says Prepack');
  assert.ok(cells.includes('Prepacks'), 'the pack check row says Prepacks');
  assert.ok(cells.includes('PO version') && cells.includes('3'));
  assert.ok(!cells.includes('Buyer'));
  assert.ok(cells.includes('2 ZZ Sample (SMP) DC') || cells.some(c => /\(2 ZZ Sample \(SMP\) DC\)/.test(c)));
});

test('a style that comes through with a space or colon in it is refused, and an F.O.B label with nothing after it is flagged as blank', () => {
  const pages = burlingtonPO({ version: 1, pos: [{ po: '900201101', lines: [BRUSH] }] });
  const st = pages[3].items.find(i => i.s === 'ZZ47001');
  pages[3].items.push({ s: '001', x: st.x + 40, y: st.y, w: 12 });
  assert.match(Recap.read('burlington', pages).error, /^PO 900201101 line 1: the style couldn't be read \(it came out as “ZZ47001 001”\)\.$/);
  const blank = burlingtonPO({ version: 1, pos: [{ po: '900201101', lines: [BRUSH] }] });
  blank[0].items = blank[0].items.filter(i => !(i.s === 'DESTINATION' && i.y === 454));
  const p = Recap.read('burlington', blank).pos[0];
  assert.deepEqual(p.fob, { term: '', city: '', state: '' });
  assert.deepEqual(Recap.flags('burlington', [p]).filter(f => f.kind === 'fob').map(f => f.text), ['FOB point is blank, not Destination or LA, on 900201101.']);
});
