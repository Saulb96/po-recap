const test = require('node:test');
const assert = require('node:assert/strict');
const Recap = require('../recap.js');
const { marmaxxPO } = require('./fixtures.js');

const LINES = [
  { style: 'ZZ10001', desc: '2PK CREAM BLUSH STICK', cost: 3.5, units: 1440, catg: '1438' },
  { style: 'ZZ10002', desc: 'LIP BUTTER BALM VANIL', cost: 1.95, units: 480, catg: '1336' },
  { style: 'ZZ10003-F', desc: 'Setting Spray Stay All Day', cost: 2.75, units: 1632, catg: '1488' },
];
const po = (o = {}) => Object.assign({ po: '900101', ref: 'D000000001', banner: 'Marshalls', lines: LINES }, o);
const read = o => Recap.read('marmaxx', marmaxxPO(po(o)));

/* ---------------- the Marmaxx reader ---------------- */

test('reads a Marshalls PO: header, dates, buyer, lines', () => {
  const r = read({ buyer: 'PAT SAMPLE', order: '10/1/2026', start: '10/8/2026', cancel: '10/15/2026' });
  assert.equal(r.error, undefined);
  assert.deepEqual({ ...r.po, lines: undefined }, {
    po: '900101', banner: 'Marshalls', dept: '88', ref: 'D000000001', vendor: 'ZZ99', buyer: 'PAT SAMPLE',
    orderDate: '2026-10-01', startShip: '2026-10-08', cancel: '2026-10-15', fob: { city: '', state: 'NY' }, totalUnits: 3552, lines: undefined });
  assert.deepEqual(r.po.lines, [
    { ln: '1/1', catg: '1438', style: 'ZZ10001', desc: '2PK CREAM BLUSH STICK', code: '12', cost: 3.5, units: 1440, pack: 48 },
    { ln: '1/2', catg: '1336', style: 'ZZ10002', desc: 'LIP BUTTER BALM VANIL', code: '12', cost: 1.95, units: 480, pack: 48 },
    { ln: '1/3', catg: '1488', style: 'ZZ10003-F', desc: 'Setting Spray Stay All Day', code: '12', cost: 2.75, units: 1632, pack: 48 },
  ]);
});

test('reads the TJ Maxx layout (its logo, DEPT : 88, START SHIP / DATE)', () => {
  const r = read({ banner: 'TJ Maxx', po: '900102' });
  assert.equal(r.error, undefined);
  assert.equal(r.po.banner, 'TJ Maxx');
  assert.equal(r.po.po, '900102');
  assert.equal(r.po.startShip, '2026-10-08');
  assert.equal(r.po.lines.length, 3);
});

test('the banner is the logo, whatever else the PO says', () => {
  assert.equal(read({ logo: { w: 214, h: 51 } }).po.banner, 'TJ Maxx');
  assert.match(read({ logo: { w: 120, h: 40 } }).error, /logo on page 1 isn't Marshalls' or TJ Maxx's/);
  assert.match(read({ logo: { w: 120, h: 40 } }).error, /banner can't be told/);
});

test('a description printed as one piece ("12 CREAM BLUSH STICK TEDD") and units with commas', () => {
  const lines = [{ style: 'ZZ20001', desc: 'CREAM BLUSH STICK TEDD', cost: 2.25, units: 1152, oneItem: true },
                 { style: 'ZZ20002', desc: '6pc Lip Butter Balm in Bag 2', cost: 10, units: 12480 }];
  const r = read({ lines, commas: true });
  assert.equal(r.error, undefined);
  assert.equal(r.po.lines[0].desc, 'CREAM BLUSH STICK TEDD');
  assert.equal(r.po.lines[1].desc, '6pc Lip Butter Balm in Bag 2');
  assert.equal(r.po.lines[1].units, 12480);
  assert.equal(r.po.totalUnits, 13632);
});

test('lines that run onto a second page are all read', () => {
  const lines = Array.from({ length: 16 }, (_, i) => ({ style: 'ZZ3' + String(i).padStart(4, '0'), desc: 'ITEM ' + i, cost: 2, units: 48 * (i + 1) }));
  const r = read({ lines, perPage: 13 });
  assert.equal(r.error, undefined);
  assert.equal(r.po.lines.length, 16);
  assert.equal(r.po.lines[15].ln, '1/16');
});

test('refused: lines that do not add up to the PO total', () => {
  const r = read({ total: 3600 });
  assert.equal(r.error, 'The lines add up to 3,552 units, but the PO says 3,600.');
  assert.equal(r.poNo, '900101');
});

test('refused: the pack configuration disagrees with a line, or has a line the line pages lack', () => {
  assert.equal(read({ packUnits: { '1/2': 960 } }).error, 'Line 1/2 (ZZ10002) has 480 units on the line page but 960 in the pack configuration.');
  assert.equal(read({ packExtra: [{ ln: '1/4', style: 'ZZ10004', desc: 'LOST LINE', units: 96 }] }).error,
    'Line 1/4 is in the pack configuration but wasn\'t read on the line pages.');
});

test('a PO without a pack configuration page is still read, on its total alone', () => {
  const r = read({ noPack: true });
  assert.equal(r.error, undefined);
  assert.equal(r.po.lines.length, 3);
});

test('refused: pages for two different POs, a file that is not a TJX PO, an empty file', () => {
  assert.equal(read({ headPo: { 3: '900199' } }).error, 'Page 3 is for PO 900199 (reference D000000001), but page 2 is for PO 900101 (reference D000000001).');
  assert.match(Recap.read('marmaxx', [{ n: 1, items: [{ s: 'BURLINGTON STORES INC', x: 10, y: 500, w: 90 }], images: [] }]).error, /isn't a Marmaxx PO/);
  assert.equal(Recap.read('marmaxx', []).error, 'The file has no pages.');
  assert.match(Recap.read('burlington', marmaxxPO(po())).error, /no reader for Burlington yet/);
});

test('refused: a line whose units are missing names the line', () => {
  const pages = marmaxxPO(po());
  pages[1].items = pages[1].items.filter(i => !(i.s === '480' && i.x > 480));
  assert.equal(Recap.read('marmaxx', pages).error, "Line 1/2 couldn't be read: no units where the headings put them.");
});

/* ---------------- checks before saving ---------------- */

const ok = (file, o) => Object.assign({ file }, read(o));

test('checkBatch: accepted in PO order; refusals and repeats are named, nothing dropped silently', () => {
  const res = Recap.checkBatch([
    ok('b.pdf', { po: '900102', ref: 'D000000001', banner: 'TJ Maxx' }),
    ok('a.pdf', { po: '900101' }),
    ok('a copy.pdf', { po: '900101' }),
    { file: 'x.pdf', error: 'The lines add up to 1 units, but the PO says 2.', poNo: '900150' },
  ], [], []);
  assert.deepEqual(res.accepted.map(p => [p.po, p.file]), [['900101', 'a.pdf'], ['900102', 'b.pdf']]);
  assert.deepEqual(res.refused, [{ file: 'x.pdf', po: '900150', why: 'The lines add up to 1 units, but the PO says 2.' }]);
  assert.deepEqual(res.notes, ["PO 900101 was dropped 2 times (a.pdf and a copy.pdf). It's read once."]);
});

test('checkBatch: two different versions of one PO are both refused', () => {
  const res = Recap.checkBatch([ok('v1.pdf', { po: '900101' }), ok('v2.pdf', { po: '900101', total: undefined, lines: LINES.slice(0, 2) })], [], []);
  assert.equal(res.accepted.length, 0);
  assert.equal(res.refused.length, 2);
  assert.match(res.refused[0].why, /Two different versions of PO 900101 were dropped \(v1.pdf and v2.pdf\)/);
});

test('checkBatch: a PO already in this buy or in another buy is refused by name', () => {
  const res = Recap.checkBatch([ok('a.pdf', { po: '900101' }), ok('b.pdf', { po: '900102' })], ['900101'], [{ name: 'Marmaxx buy 10/23', pos: ['900102'] }]);
  assert.deepEqual(res.refused.map(r => r.why), ['PO 900101 is already in this buy.', 'PO 900102 is already in “Marmaxx buy 10/23”.']);
});

/* ---------------- flags ---------------- */

// POs for the flag, recap and sheet tests ship FOB Los Angeles, so only what each test is about gets flagged
const LA = { city: 'LOS ANGELES', state: 'CA' };
const P = (o, lines = LINES) => read({ fob: LA, ...o, lines }).po;

test('flags: a reference with one banner, a pair with the same banner, costs and descriptions that differ, a PO sent twice', () => {
  const pos = [
    P({ po: '900101', ref: 'D1' }), P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' }),
    P({ po: '900103', ref: 'D2' }),
    P({ po: '900104', ref: 'D3' }, [LINES[0], { ...LINES[1], cost: 2.1 }]), P({ po: '900105', ref: 'D3', start: '10/9/2026' }, [{ ...LINES[0], desc: '2PK BLUSH STICK' }, LINES[1]]),
  ];
  const f = Recap.flags('marmaxx', pos);
  assert.deepEqual(f.map(x => x.text), [
    'Reference D2 has only the Marshalls PO (900103). Its TJ Maxx PO is missing.',
    'Reference D3 has 2 POs (900104 and 900105) but not one for each banner: 900104 Marshalls and 900105 Marshalls.',
    'ZZ10001 is “2PK CREAM BLUSH STICK” on 900101, 900102, 900103, 900104; “2PK BLUSH STICK” on 900105.',
    'ZZ10002 is costed $1.95 on 900101, 900102, 900103, 900105; $2.10 on 900104.',
    'POs 900101 and 900103 have the same lines, units, banner and ship window. Was one sent twice?',
  ]);
});

test('flags: a clean pair has none', () => {
  assert.deepEqual(Recap.flags('marmaxx', [P({ po: '900101', ref: 'D1' }), P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' })]), []);
});

/* ---------------- the recap ---------------- */

function buy() {
  return {
    id: 'b1', name: 'Marmaxx buy 10/27', customer: 'marmaxx', notes: { ZZ10001: 'update qty' },
    pos: [
      P({ po: '900104', ref: 'D2', start: '10/12/2026', cancel: '10/19/2026' }, [LINES[0]]),
      P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' }, [LINES[1], LINES[0]]),
      P({ po: '900101', ref: 'D1' }, [LINES[0], { ...LINES[2], cost: 3 }]),
      P({ po: '900103', ref: 'D2', banner: 'TJ Maxx', start: '10/12/2026', cancel: '10/19/2026' }, [{ ...LINES[2], units: 96 }]),
    ],
  };
}

test('recap: ship windows in date order, Marshalls before TJ Maxx, POs in number order', () => {
  const R = Recap.recap(buy());
  assert.deepEqual(R.windows.map(w => [w.label, w.banners.map(b => [b.banner, b.pos.map(p => p.po)])]), [
    ['10/8–10/15', [['Marshalls', ['900101']], ['TJ Maxx', ['900102']]]],
    ['10/12–10/19', [['Marshalls', ['900104']], ['TJ Maxx', ['900103']]]],
  ]);
});

test('recap: one row per style by category then style, with units per PO, totals and exact extended cost', () => {
  const R = Recap.recap(buy());
  assert.deepEqual(R.rows.map(r => [r.catg, r.style, r.cost, r.units, r.total, r.ext]), [
    ['1336', 'ZZ10002', 1.95, { 900102: 480 }, 480, 936],
    ['1438', 'ZZ10001', 3.5, { 900104: 1440, 900102: 1440, 900101: 1440 }, 4320, 15120],
    ['1488', 'ZZ10003-F', null, { 900101: 1632, 900103: 96 }, 1728, 5160],
  ]);
  assert.deepEqual(R.rows[2].costs, [3, 2.75], 'in grid order: 900101 (10/8) before 900103 (10/12)');
  assert.deepEqual(R.total, { pos: 4, units: 6528, ext: 21216 });
  assert.deepEqual(R.byBanner.map(b => [b.banner, b.pos, b.units]), [['Marshalls', 2, 4512], ['TJ Maxx', 2, 2016]]);
  assert.deepEqual(R.byWindow.map(w => [w.label, w.units, w.ext]), [['10/8–10/15', 4992, 15912], ['10/12–10/19', 1536, 5304]]);
  assert.deepEqual(R.summary.buyers, ['PAT SAMPLE']);
});

test('recap: a description or cost that differs is never picked: the row lists each, and every cell keeps its own PO\'s', () => {
  const b = buy();
  b.pos = [P({ po: '900101', ref: 'D1' }, [{ ...LINES[0], desc: 'OLD NAME', cost: 3 }]), P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' }, [LINES[0]]),
           P({ po: '900103', ref: 'D2' }, [{ ...LINES[0], desc: '2pk  cream blush stick' }])];
  const row = Recap.recap(b).rows[0];
  // grid order is 900101, 900103 (Marshalls), 900102 (TJ Maxx): a description shows as the first PO there spells it
  assert.equal(row.desc, 'OLD NAME / 2pk cream blush stick', 'capitals and spacing alone are the same description');
  assert.deepEqual(row.varies, { cost: true, desc: true });
  assert.deepEqual(row.cells['900101'], { units: 1440, costs: [3], descs: ['OLD NAME'], parts: [{ units: 1440, cost: 3, desc: 'OLD NAME' }] });
  assert.deepEqual(row.cells['900102'], { units: 1440, costs: [3.5], descs: ['2pk cream blush stick'], parts: [{ units: 1440, cost: 3.5, desc: '2pk cream blush stick' }] });
  assert.equal(row.cost, null);
});

test('cell notes and hovers: each PO\'s own cost and description, for what varies', () => {
  const b = buy();
  b.pos = [P({ po: '900101', ref: 'D1' }, [{ ...LINES[0], desc: '2pk Lip Liners Raise & Steady', cost: 3 }, LINES[1]]),
           P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' }, [{ ...LINES[0], cost: 3 }, { ...LINES[1], desc: 'LIP BALM VANILLA' }]),
           P({ po: '900103', ref: 'D2' }, [LINES[0], LINES[1]])];
  const R = Recap.recap(b), both = R.rows.find(r => r.style === 'ZZ10001'), desc = R.rows.find(r => r.style === 'ZZ10002');
  assert.equal(Recap.cellText(both, '900101'), '1440-$3.00-2pk Lip Liners Raise & Steady');
  assert.equal(Recap.cellText(both, '900103'), '1440-$3.50-2PK CREAM BLUSH STICK');
  assert.equal(Recap.cellText(desc, '900102'), '480-LIP BALM VANILLA', 'only what varies: the cost is the same everywhere');
  assert.equal(Recap.cellText(desc, '900199'), '');
  assert.equal(Recap.cellTip(both, '900101'), [
    'PO 900101: 1,440 units',
    'Cost here: $3.00', 'Elsewhere: $3.00 on 900102; $3.50 on 900103',
    'Description here: “2pk Lip Liners Raise & Steady”', 'Elsewhere: “2PK CREAM BLUSH STICK” on 900102, 900103'].join('\n'));
  assert.equal(Recap.variantsTip(both, 'cost'), '$3.00 on 900101, 900102\n$3.50 on 900103');
  assert.equal(Recap.variantsTip(desc, 'desc'), '“LIP BUTTER BALM VANIL” on 900101, 900103\n“LIP BALM VANILLA” on 900102');
});

test('a PO with the style on two lines at different costs keeps the units at each, in the cell and the hover', () => {
  const b = buy();
  b.pos = [P({ po: '900101', ref: 'D1' }, [{ ...LINES[0], units: 96, cost: 3 }, { ...LINES[0], units: 48, cost: 2.6, desc: 'OTHER NAME' }]),
           P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' }, [{ ...LINES[0], units: 144, cost: 3 }])];
  const row = Recap.recap(b).rows[0];
  assert.equal(Recap.cellText(row, '900101'), '96-$3.00-2PK CREAM BLUSH STICK + 48-$2.60-OTHER NAME');
  assert.equal(Recap.cellText(row, '900102'), '144-$3.00-2PK CREAM BLUSH STICK');
  const tip = Recap.cellTip(row, '900101').split('\n');
  assert.deepEqual(tip.slice(0, 2), ['PO 900101: 144 units', 'Cost here: 96 at $3.00, 48 at $2.60']);
  assert.equal(tip[3], 'Description here: 96 “2PK CREAM BLUSH STICK”, 48 “OTHER NAME”');
  assert.equal(row.ext, 96 * 3 + 48 * 2.6 + 144 * 3);
});

test('a row\'s costs and descriptions are listed in the same order, so the first of each come from the same PO', () => {
  const b = buy();
  b.pos = [P({ po: '900105', ref: 'D1', start: '11/1/2026', cancel: '11/8/2026' }, [{ ...LINES[0], cost: 3, desc: 'LINERS' }]),
           P({ po: '900101', ref: 'D2', start: '11/5/2026', cancel: '11/12/2026' }, [{ ...LINES[0], cost: 2.6, desc: 'LIP KIT' }])];
  const row = Recap.recap(b).rows[0];
  assert.deepEqual(row.costs, [3, 2.6]);
  assert.equal(row.desc, 'LINERS / LIP KIT');
  assert.equal(Recap.variantsTip(row, 'cost'), '$3.00 on 900105\n$2.60 on 900101');
  const ws = Recap.worksheet(b);
  const h = +Object.keys(ws).find(k => k[0] !== '!' && ws[k].v === 'Check').slice(1);
  assert.deepEqual([ws['C' + (h + 3)].v, ws['D' + (h + 3)].v], ['LINERS / LIP KIT', '3.00 / 2.60']);
});

test('worksheet: a style that varies is red, its cells read units-cost-description, everything else stays a number', () => {
  const b = buy();
  b.pos = [P({ po: '900101', ref: 'D1' }, [{ ...LINES[0], desc: '2pk Lip Liners Raise & Steady', cost: 3 }, LINES[1]]),
           P({ po: '900102', ref: 'D1', banner: 'TJ Maxx' }, [LINES[0], LINES[1]])];
  const ws = Recap.worksheet(b);
  const h = +Object.keys(ws).find(k => k[0] !== '!' && ws[k].v === 'Check').slice(1);
  const at = (c, r) => ws[c + r];
  // rows: ZZ10002 (1336) at h+3, ZZ10001 (1438) at h+4; columns E = Pack, F = 900101, G = 900102
  assert.deepEqual(['C', 'D', 'F', 'G'].map(c => at(c, h + 4).v),
    ['2pk Lip Liners Raise & Steady / 2PK CREAM BLUSH STICK', '3.00 / 3.50', '1440-$3.00-2pk Lip Liners Raise & Steady', '1440-$3.50-2PK CREAM BLUSH STICK']);
  for (const c of ['C', 'D', 'F', 'G']) {
    assert.equal(at(c, h + 4).s.fill.fgColor.rgb, 'FFC7CE', c + ' is red');
    assert.equal(at(c, h + 4).s.font.color.rgb, '9C0006');
  }
  assert.equal(at('E', h + 4).v, 48, 'the pack is the same on both POs and nothing to check it against: a plain number');
  assert.equal(at('F', h + 3).v, 480); assert.equal(at('F', h + 3).t, 'n');
  assert.notEqual(at('F', h + 3).s.fill.fgColor.rgb, 'FFC7CE', 'a style that is the same everywhere keeps its window colour');
  assert.equal(at('H', h + 4).v, 2880, 'Total units still counts the red cells');
  assert.equal(at('F', h + 5).v, 1920, 'and so does the totals row');
});

/* ---------------- the Excel sheet ---------------- */

test('worksheet: title, summary, three heading rows, Check first and Notes last, totals, flags', () => {
  const ws = Recap.worksheet(buy());
  const v = a => ws[a] && ws[a].v;
  const find = s => Object.keys(ws).filter(k => k[0] !== '!' && ws[k].v === s);
  assert.equal(v('B1'), 'Marmaxx buy 10/27');
  assert.equal(ws.B1.s.fill.fgColor.rgb, 'D9EAF7');
  const [headAt] = find('Check');
  const h = +headAt.slice(1);
  assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(c => v(c + h)),
    ['Check', 'Style', 'Description', 'Cost', 'Pack', '10/8–10/15', '', '10/12–10/19', '', 'Total units', 'Ext cost', 'Notes']);
  assert.deepEqual(['F', 'G', 'H', 'I'].map(c => v(c + (h + 1))), ['Marshalls', 'TJ Maxx', 'Marshalls', 'TJ Maxx']);
  assert.deepEqual(['F', 'G', 'H', 'I'].map(c => v(c + (h + 2))), [900101, 900102, 900104, 900103]);
  assert.equal(ws['F' + (h + 2)].t, 'n', 'a PO # of digits is a number, as Excel takes it');
  assert.deepEqual(['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(c => v(c + (h + 4))), ['☐', 'ZZ10001', 3.5, 48, 1440, 1440, 1440, '', 4320, 15120, 'update qty']);
  assert.equal(v('D' + (h + 5)), '3.00 / 2.75');
  assert.deepEqual(['F', 'I'].map(c => v(c + (h + 5))), ['1632-$3.00', '96-$2.75'], 'only the cost varies, so only the cost is noted');
  assert.deepEqual(['B', 'F', 'G', 'H', 'I', 'J', 'K'].map(c => v(c + (h + 6))), ['Total', 3072, 1920, 1440, 96, 6528, 21216]);
  assert.equal(ws['K' + (h + 4)].z, '$#,##0.00');
  assert.ok(ws['!merges'].some(m => m.s.r === h - 1 && m.s.c === 5 && m.e.c === 6), 'the ship window spans its two POs');
  assert.ok(ws['!merges'].some(m => m.s.r === h - 1 && m.s.c === 0 && m.e.r === h + 1), 'Check spans the three heading rows');
  assert.equal(v('B' + (h + 9)), 'Flags');
  assert.match(v('B' + (h + 11)), /ZZ10003-F is costed/);
  assert.equal(v('A' + (h + 11)), '☐');
  assert.equal(v('B3'), 'Customer');
  assert.equal(v('C3'), 'Marmaxx');
  assert.equal(v('C4'), '4 (2 Marshalls, 2 TJ Maxx)');
  assert.equal(v('C5'), 6528);
  assert.equal(v('C6'), 21216);
  assert.equal(v('C7'), '10/1/2026');
});

test('ship windows each get a colour, in date order and round again after the sixth', () => {
  const b = buy();
  b.pos = Array.from({ length: 7 }, (_, i) => P({ po: '90020' + i, ref: 'D' + i, start: '10/' + (10 + i) + '/2026', cancel: '10/' + (17 + i) + '/2026' }, [LINES[0]]));
  const R = Recap.recap(b);
  assert.deepEqual(R.windows.map(w => w.tone), [0, 1, 2, 3, 4, 5, 0]);
  assert.equal(R.tones['900206'], 0);
  assert.deepEqual(R.byWindow.map(w => w.tone), [0, 1, 2, 3, 4, 5, 0]);
});

test('worksheet: each ship window keeps its colour from heading to totals, cells in the lighter shade', () => {
  const ws = Recap.worksheet(buy());
  const fill = a => ws[a] && ws[a].s && ws[a].s.fill && ws[a].s.fill.fgColor.rgb;
  const h = +Object.keys(ws).find(k => k[0] !== '!' && ws[k].v === 'Check').slice(1);
  const [w0, w1] = Recap.TONES;
  assert.deepEqual(['F', 'G', 'H', 'I'].map(c => fill(c + h)), [w0[0], w0[0], w1[0], w1[0]], 'ship window headings');
  assert.deepEqual(['F', 'G', 'H', 'I'].map(c => fill(c + (h + 1))), [w0[0], w0[0], w1[0], w1[0]], 'banner headings');
  assert.deepEqual(['F', 'G', 'H', 'I'].map(c => fill(c + (h + 2))), [w0[0], w0[0], w1[0], w1[0]], 'PO # headings');
  assert.deepEqual(['F', 'G', 'H', 'I'].map(c => fill(c + (h + 4))), [w0[1], w0[1], w1[1], w1[1]], 'units, blanks too');
  assert.deepEqual(['F', 'H'].map(c => fill(c + (h + 6))), [w0[0], w1[0]], 'totals');
  assert.equal(fill('J' + (h + 4)), undefined, 'Total units stays uncoloured');
  const windowRow = +Object.keys(ws).find(k => k[0] === 'B' && ws[k].v === '10/12–10/19').slice(1);
  assert.equal(fill('B' + windowRow), w1[0], 'the summary\'s ship window row');
});

test('sheet names: Excel-safe, 31 characters, never twice in one file', () => {
  const used = new Set();
  assert.equal(Recap.sheetName('Marmaxx buy 10/27', used), 'Marmaxx buy 10-27');
  assert.equal(Recap.sheetName('Marmaxx buy 10/27', used), 'Marmaxx buy 10-27 (2)');
  assert.equal(Recap.sheetName('A very long buy name that goes on past the limit', used), 'A very long buy name that goes', 'cut at 31, no trailing space');
  assert.equal(Recap.sheetName('Marmaxx buy 10/23 - 10/27 window', used, ' distro'), 'Marmaxx buy 10-23 - 10-2 distro', 'the suffix stays whole, within 31');
});

test('the default name is the customer and the day the POs are dropped in', () => {
  assert.equal(Recap.defaultName('Marmaxx', new Date(2026, 9, 27)), 'Marmaxx buy 10/27');
});
