const test = require('node:test');
const assert = require('node:assert/strict');
const Recap = require('../recap.js');
const { marmaxxPO, marmaxxDistro } = require('./fixtures.js');

const LINES = [
  { style: 'ZZ10001', desc: '2PK CREAM BLUSH STICK', cost: 3.5, units: 1440, catg: '1438' },
  { style: 'ZZ10002', desc: 'LIP BUTTER BALM VANIL', cost: 1.95, units: 480, catg: '1336' },
];
const LA = { city: 'LOS ANGELES', state: 'CA' };
const po = (o = {}) => Recap.read('marmaxx', marmaxxPO(Object.assign({ po: '900101', ref: 'D1', banner: 'Marshalls', lines: LINES, fob: LA }, o)));
// a distro that matches PO 900101: 1440 = 288 x 5 DCs, 480 = 96 x 5
const DLINES = [
  { style: 'ZZ10001', desc: '2PK CREAM BLUSH STICK', pack: 48, total: 1440, units: { 881: 288, 884: 288, 886: 288, 887: 288, 888: 288 } },
  { style: 'ZZ10002', desc: 'LIP BUTTER BALM VANIL', pack: 48, total: 480, units: { 881: 96, 884: 96, 886: 96, 887: 96, 888: 96 } },
];
const distro = (o = {}) => Recap.read('marmaxx', marmaxxDistro(Object.assign({ po: '900101', version: 1, start: '10/8/2026', cancel: '10/15/2026', order: '10/1/2026', lines: DLINES }, o)), 'x.pdf');

/* ---------------- FOB point ---------------- */

test('FOB point: read from the PO header row in both layouts, unknown when the labels are missing', () => {
  assert.deepEqual(po({ fob: { city: '', state: 'NY' } }).po.fob, { city: '', state: 'NY' });
  assert.deepEqual(po({ banner: 'TJ Maxx', fob: { city: 'LOS ANGELES', state: 'CA' } }).po.fob, { city: 'LOS ANGELES', state: 'CA' });
  assert.equal(po({ noFob: true }).po.fob, null);
});

test('FOB point: only LA passes; one flag per FOB point, naming its POs', () => {
  assert.ok(Recap.fobIsLA({ city: 'LOS ANGELES', state: 'CA' }));
  assert.ok(Recap.fobIsLA({ city: 'LA', state: '' }));
  assert.ok(!Recap.fobIsLA({ city: '', state: 'LA' }), 'LA in the state box is Louisiana');
  assert.ok(!Recap.fobIsLA({ city: '', state: 'NY' }));
  assert.ok(!Recap.fobIsLA({ city: 'NEW YORK', state: 'NY' }));
  assert.ok(Recap.fobIsLA(null), 'a PO whose FOB point was never read is not flagged');
  const pos = [po({ po: '900101', fob: { city: '', state: 'NY' } }).po, po({ po: '900102', banner: 'TJ Maxx', fob: { city: '', state: 'NY' } }).po,
               po({ po: '900103', ref: 'D2', fob: LA }).po, po({ po: '900104', ref: 'D2', banner: 'TJ Maxx', fob: { city: 'DALLAS', state: 'TX' } }).po];
  assert.deepEqual(Recap.flags('marmaxx', pos).filter(f => f.kind === 'fob').map(f => f.text),
    ['FOB point is DALLAS, TX, not LA, on 900104.', 'FOB point is NY, not LA, on 900101 and 900102.']);
  const all = ['900101', '900102', '900103'].map((n, i) => po({ po: n, ref: 'R' + i, fob: { city: '', state: 'NY' } }).po);
  assert.deepEqual(Recap.flags('marmaxx', all).filter(f => f.kind === 'fob').map(f => f.text), ['FOB point is NY, not LA, on every PO (3).']);
});

/* ---------------- the distribution readers ---------------- */

test('a distribution PDF: PO, version, dates, DCs, lines; Marshalls by its DC prefixes', () => {
  const r = distro();
  assert.equal(r.error, undefined);
  const d = r.distro;
  assert.deepEqual({ po: d.po, version: d.version, versionDate: d.versionDate, banner: d.banner, dept: d.dept, order: d.orderDate, start: d.startShip, cancel: d.cancel },
    { po: '900101', version: 1, versionDate: '2026-04-09', banner: 'Marshalls', dept: '88', order: '2026-10-01', start: '2026-10-08', cancel: '2026-10-15' });
  assert.deepEqual(d.dcs.map(x => x.prefix + '/' + x.code + '/' + x.dc), ['01/AZR/881', '04/ELP/884', '06/BRI/886', '07/ATL/887', '08/WOB/888']);
  assert.deepEqual(d.lines[0], { ln: '1-1', style: 'ZZ10001', tjxStyle: '482000', desc: '2PK CREAM BLUSH STICK', pack: 48, total: 1440, units: { 881: 288, 884: 288, 886: 288, 887: 288, 888: 288 } });
});

test('a distribution PDF to TJ Maxx DCs (prefixes 10-80) reads as TJ Maxx', () => {
  const dcs = [{ prefix: '10', code: 'WOR', name: 'TJM WORCESTER', dc: '871' }, { prefix: '20', code: 'LVG', name: 'TJM LAS VEGAS', dc: '872' }];
  const lines = [{ style: 'ZZ10001', desc: 'X', pack: 48, total: 96, units: { 871: 48, 872: 48 } }];
  assert.equal(distro({ dcs, lines }).distro.banner, 'TJ Maxx');
});

test('the TJ Maxx layout: split headings, DC# apart from its number, 1/1 lines, descriptions wrapped around their line', () => {
  const { marmaxxDistroTJ } = require('./fixtures.js');
  const lines = [{ style: 'ZZ47208', desc: 'FACIAL CLEANSING WIPES / ROSEWATER', pack: 16, total: 832, units: { 891: 80, 894: 176, 896: 128, 897: 400, 898: 48 } },
                 { style: 'ZZ47724', desc: '4PK FACIAL CLEANSING / WIPES', pack: 16, total: 832, units: { 891: 80, 894: 176, 896: 128, 897: 400, 898: 48 } }];
  const r = Recap.read('marmaxx', marmaxxDistroTJ({ po: '900102', version: 1, lines }), 'TJMAXX_DISTRIBUTION_INSTRUCTIONS_900102_V1.pdf');
  assert.equal(r.error, undefined);
  const d = r.distro;
  assert.deepEqual({ po: d.po, version: d.version, versionDate: d.versionDate, banner: d.banner, dept: d.dept, order: d.orderDate, start: d.startShip, cancel: d.cancel },
    { po: '900102', version: 1, versionDate: '2026-10-29', banner: 'TJ Maxx', dept: '88', order: '2026-10-28', start: '2026-11-08', cancel: '2026-11-15' });
  assert.deepEqual(d.dcs.map(x => x.prefix + '/' + x.code + '/' + x.dc + '/' + x.name),
    ['10/SAN/891/TJM SAN ANTONIO', '40/CHA/894/CHARLOTTE', '60/WOR/896/WORCESTER', '70/EVN/897/EVANSVILLE', '80/TLV/898/MAXX LAS VEGAS']);
  assert.deepEqual(d.lines.map(l => [l.ln, l.style, l.desc, l.pack, l.total, l.units[897]]),
    [['1/1', 'ZZ47208', 'FACIAL CLEANSING WIPES ROSEWATER', 16, 832, 400], ['1/2', 'ZZ47724', '4PK FACIAL CLEANSING WIPES', 16, 832, 400]]);
});

test('the table is found by its own "Total" heading, not other "Total" text; a page with no table is passed over', () => {
  const pages = marmaxxDistro({ po: '900101', version: 1, lines: DLINES });
  // a note above the table that says "Total", first on the page
  pages[0].items.unshift({ s: 'Total', x: 37, y: 465, w: 20 }, { s: 'cartons must match the PO', x: 60, y: 465, w: 120 });
  // a second page of notes only, with a "Total" of its own
  pages.push({ n: 2, items: [{ s: 'PO Number:', x: 133, y: 537, w: 50 }, { s: '900101', x: 186, y: 537, w: 30 },
    { s: 'Total', x: 37, y: 300, w: 20 }, { s: 'units are per DC', x: 60, y: 300, w: 80 }], images: [] });
  const r = Recap.read('marmaxx', pages, 'x.pdf');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.distro.lines.map(l => [l.style, l.total]), [['ZZ10001', 1440], ['ZZ10002', 480]]);
});

test('a PO is never taken for a distro, though every PO mentions "routing and distribution instructions"', () => {
  assert.ok(po().po);
  assert.equal(Recap.isDistroPages(marmaxxPO({ po: '900101', ref: 'D1', lines: LINES })), false);
});

test('a distribution PDF is refused when a line\'s DCs don\'t add up to its total, or a DC block is for another PO', () => {
  const bad = [{ ...DLINES[0], units: { 881: 288, 884: 288, 886: 288, 887: 288, 888: 240 } }];
  assert.equal(distro({ lines: bad }).error, 'Line 1-1 (ZZ10001): the DCs add up to 1,392 units, but its total says 1,440.');
  assert.match(distro({ blockPo: { '06': '900199' } }).error, /prefix 06 is for PO 900199, not 900101/);
});

const SHEET_HEAD = ['PG-LN', 'Vendor Style #', 'TJX Style #', 'Description', 'Vendor Pack Size', 'Store Ready Pack Size', 'Total Units',
  'AZR DC#881 Units', 'ELP DC#884 Units', 'BRI DC#886 Units', 'ATL DC#887 Units', 'WOB DC#888 Units'];

test('an Excel distribution sheet: the PO number and banner from its file name, the DCs from its headings', () => {
  const table = [SHEET_HEAD, ['1-1', 'ZZ10001', 335921, '12 2PK CREAM BLUSH STICK', 48, 0, 1440, 288, 288, 288, 288, 288], [], ['1-2', 'ZZ10002', 335926, '12 LIP BUTTER BALM VANIL', 48, 0, 480, 96, 96, 96, 96, 96]];
  const r = Recap.readSheet('marmaxx', table, 'MARSHALLS_DISTRIBUTION_INSTRUCTIONS_900101.xlsx');
  assert.equal(r.error, undefined);
  assert.equal(r.distro.po, '900101');
  assert.equal(r.distro.banner, 'Marshalls');
  assert.equal(r.distro.version, null);
  assert.deepEqual(r.distro.lines.map(l => [l.style, l.desc, l.total, l.units[881]]), [['ZZ10001', '2PK CREAM BLUSH STICK', 1440, 288], ['ZZ10002', 'LIP BUTTER BALM VANIL', 480, 96]]);
  assert.equal(Recap.readSheet('marmaxx', table, 'TJMAXX_DISTRIBUTION_900101_V2.xlsx').distro.version, 2);
  assert.match(Recap.readSheet('marmaxx', table, 'distro.xlsx').error, /doesn't carry a 6-digit PO number/);
  assert.deepEqual(Recap.readSheet('marmaxx', [['Style', 'Units'], ['A', 1]], 'other.xlsx'), { notDistro: true });
  const off = [SHEET_HEAD, ['1-1', 'ZZ10001', 1, 'X', 48, 0, 1440, 288, 288, 288, 288, 0]];
  assert.match(Recap.readSheet('marmaxx', off, 'M_900101.xlsx').error, /the DCs add up to 1,152 units, but its total says 1,440/);
});

/* ---------------- distros in the check before saving ---------------- */

const d = (o, file) => Object.assign({ file: file || 'distro.pdf' }, distro(o));
const p = (o, file) => Object.assign({ file: file || 'po.pdf' }, po(o));

test('a distro attaches to its PO, dropped with it or already in the buy; otherwise it is refused by name', () => {
  let c = Recap.checkBatch([p({}, 'po.pdf'), d({}, 'd.pdf')], [], [], {});
  assert.deepEqual(c.distros.map(x => [x.po, x.file]), [['900101', 'd.pdf']]);
  c = Recap.checkBatch([d({}, 'd.pdf')], ['900101'], [], {});
  assert.equal(c.distros.length, 1, 'the PO is already in this buy');
  c = Recap.checkBatch([d({ po: '900150' }, 'd.pdf')], [], [{ name: 'Marmaxx buy 10/23', pos: ['900150'] }], {});
  assert.equal(c.distros.length, 0);
  assert.equal(c.refused[0].why, 'This is the distro for PO 900150, which isn\'t among the POs dropped. PO 900150 is in “Marmaxx buy 10/23”: add the distro there.');
  c = Recap.checkBatch([d({ po: '900150' }, 'd.pdf')], ['900101'], [], {});
  assert.equal(c.refused[0].why, 'This is the distro for PO 900150, which isn\'t in this buy. Drop it together with its PO.');
});

test('distro versions: the newest of several is used, a newer one replaces, an older or a different same-version one is refused', () => {
  let c = Recap.checkBatch([p({}), d({ version: 1 }, 'v1.pdf'), d({ version: 2, lines: [DLINES[0]] }, 'v2.pdf')], [], [], {});
  assert.deepEqual(c.distros.map(x => [x.file, x.distro.version]), [['v2.pdf', 2]]);
  assert.deepEqual(c.notes, ['v1.pdf is version 1 of PO 900101\'s distro; version 2 (v2.pdf) is the one used.']);
  const had = distro({ version: 1 }).distro;
  c = Recap.checkBatch([d({ version: 2, lines: [DLINES[0]] }, 'v2.pdf')], ['900101'], [], { 900101: had });
  assert.deepEqual(c.distros.map(x => [x.file, x.replaces]), [['v2.pdf', 1]]);
  c = Recap.checkBatch([d({ version: 1 }, 'again.pdf')], ['900101'], [], { 900101: had });
  assert.deepEqual([c.distros.length, c.notes], [0, ['PO 900101 already has this distro.']]);
  c = Recap.checkBatch([d({ version: 1, lines: [DLINES[0]] }, 'other.pdf')], ['900101'], [], { 900101: had });
  assert.match(c.refused[0].why, /already has a different distro with the same version number \(1\)/);
  c = Recap.checkBatch([d({ version: 1, lines: [DLINES[0]] }, 'a.pdf'), d({ version: 1 }, 'b.pdf'), p({})], [], [], {});
  assert.equal(c.refused.length, 2);
  assert.match(c.refused[0].why, /Two different distros for PO 900101, both version 1/);
});

test('the PDF and the Excel of one distro are the same distro: a blank DC on one is a 0 on the other', () => {
  // one style sends nothing to WOB: blank on the PDF, 0 on the portal's sheet
  const lines = [{ ...DLINES[0], total: 1152, units: { 881: 288, 884: 288, 886: 288, 887: 288 } }, DLINES[1]];
  const pdf = distro({ lines });
  const table = [SHEET_HEAD, ['1-1', 'ZZ10001', 1, '12 2PK CREAM BLUSH STICK', 48, 0, 1152, 288, 288, 288, 288, 0], ['1-2', 'ZZ10002', 2, '12 LIP BUTTER BALM VANIL', 48, 0, 480, 96, 96, 96, 96, 96]];
  const xls = Recap.readSheet('marmaxx', table, 'MARSHALLS_DISTRIBUTION_INSTRUCTIONS_900101_V1.xlsx');
  assert.equal(Recap.distroSig(pdf.distro), Recap.distroSig(xls.distro));
  const po1 = po({ lines: [{ ...LINES[0], units: 1152 }, LINES[1]] });
  // dropped together: read once, from the PDF, which has the dates
  let c = Recap.checkBatch([Object.assign({ file: 'po.pdf' }, po1), Object.assign({ file: 'd.xlsx' }, xls), Object.assign({ file: 'd.pdf' }, pdf)], [], [], {});
  assert.deepEqual([c.refused, c.distros.map(x => x.file)], [[], ['d.pdf']]);
  assert.match(c.notes[0], /dropped 2 times .* It's read once, from d\.pdf/);
  // the Excel saved first, the PDF after: the PDF takes its place, bringing the dates
  c = Recap.checkBatch([Object.assign({ file: 'd.pdf' }, pdf)], ['900101'], [], { 900101: Object.assign({}, xls.distro, { version: 1 }) });
  assert.deepEqual(c.distros.map(x => [x.file, x.replaces]), [['d.pdf', 1]]);
  // the PDF saved first, the Excel after: nothing new
  c = Recap.checkBatch([Object.assign({ file: 'd.xlsx' }, xls)], ['900101'], [], { 900101: pdf.distro });
  assert.deepEqual([c.distros, c.refused, c.notes], [[], [], ['PO 900101 already has this distro.']]);
});

test('a newer version replaces the distro even when only its dates changed', () => {
  const had = distro({ version: 1, start: '10/9/2026', cancel: '10/16/2026' }).distro;
  const c = Recap.checkBatch([d({ version: 2 }, 'v2.pdf')], ['900101'], [], { 900101: had });
  assert.deepEqual(c.distros.map(x => [x.file, x.replaces]), [['v2.pdf', 1]]);
  // two version-1 copies with the same lines but different dates are two different distros
  const two = Recap.checkBatch([p({}), d({ version: 1 }, 'a.pdf'), d({ version: 1, start: '10/9/2026' }, 'b.pdf')], [], [], {});
  assert.equal(two.refused.length, 2);
});

test('when the newest versions disagree, the older ones dropped with them are refused too, not left out', () => {
  const c = Recap.checkBatch([p({}), d({ version: 1 }, 'v1.pdf'), d({ version: 2 }, 'v2a.pdf'), d({ version: 2, lines: [DLINES[0]] }, 'v2b.pdf')], [], [], {});
  assert.deepEqual(c.refused.map(r => r.file).sort(), ['v1.pdf', 'v2a.pdf', 'v2b.pdf']);
  assert.match(c.refused.find(r => r.file === 'v1.pdf').why, /isn't used: the newer versions dropped with it disagree/);
});

/* ---------------- a PO against its distro ---------------- */

test('a distro that matches its PO has nothing to say', () => {
  assert.deepEqual(Recap.distroIssues(Object.assign({}, po().po, { distro: distro().distro })), []);
});

test('distro against PO: banner, dates, units, pack, whole cartons, styles on one side only', () => {
  const lines = [
    { style: 'ZZ10001', desc: 'X', pack: 24, total: 1392, units: { 881: 288, 884: 288, 886: 288, 887: 288, 888: 240 } },
    { style: 'ZZ10009', desc: 'EXTRA', pack: 48, total: 100, units: { 881: 100 } },
  ];
  const dcs = [{ prefix: '10', code: 'WOR', name: 'W', dc: '881' }, { prefix: '20', code: 'LVG', name: 'L', dc: '884' }, { prefix: '30', code: 'C', name: 'C', dc: '886' },
               { prefix: '40', code: 'D', name: 'D', dc: '887' }, { prefix: '50', code: 'E', name: 'E', dc: '888' }];
  const x = Object.assign({}, po().po, { distro: distro({ lines, dcs, start: '10/9/2026' }).distro });
  assert.deepEqual(Recap.distroIssues(x).map(i => [i.style, i.dc, i.text]), [
    [null, null, 'PO 900101 is Marshalls, but its distro ships to TJ Maxx DCs.'],
    [null, null, 'PO 900101\'s distro says ship 10/9–10/15; the PO says 10/8–10/15.'],
    ['ZZ10001', null, 'ZZ10001: PO 900101 has 1,440 units; its distro sends 1,392.'],
    ['ZZ10001', null, 'ZZ10001: pack 48 on PO 900101, 24 on its distro.'],
    ['ZZ10002', null, 'ZZ10002 is on PO 900101 (480 units) but not on its distro.'],
    ['ZZ10009', null, 'ZZ10009 is on PO 900101\'s distro (100 units) but not on the PO.'],
    ['ZZ10009', '881', 'ZZ10009: 100 units to DC WOR 881 isn\'t whole cartons of 48.'],
  ]);
  assert.equal(Recap.flags('marmaxx', [x]).filter(f => f.kind === 'distro').length, 7, 'every finding is a flag on the buy');
});

test('whole cartons are checked line by line: two half cartons on two lines are still half cartons', () => {
  const two = [{ style: 'ZZ10001', desc: 'X', pack: 48, total: 960, units: { 881: 216, 884: 216, 886: 216, 887: 216, 888: 96 } },
               { style: 'ZZ10001', desc: 'X', pack: 48, total: 480, units: { 881: 72, 884: 72, 886: 72, 887: 72, 888: 192 } }, DLINES[1]];
  const x = Object.assign({}, po().po, { distro: distro({ lines: two }).distro });
  const texts = Recap.distroIssues(x).map(i => i.text);
  assert.equal(texts.length, 8, 'four DCs on each line');
  assert.ok(texts.includes('ZZ10001: 216 units to DC AZR 881 on line 1-1 isn\'t whole cartons of 48.'));
  assert.ok(texts.includes('ZZ10001: 72 units to DC AZR 881 on line 1-2 isn\'t whole cartons of 48.'));
});

/* ---------------- Master Sheet Live ---------------- */

const MASTER = [
  ['Category', 'Sub', 'Brand', 'Product name', 'Style Number', 'Barcode', 'Inner', 'Master', 'Price', 'Quantity', 'Old Style name', 'Po Number', 'Factory', 'Order Date'],
  ['', '', '', 'Old', 'ZZ10001', '', 12, 24, 1, 1, '', '101000', 'F', 46000],                // 12/9/2025
  ['', '', '', 'New', 'zz10001 ', '', 12, 48, 1, 1, '', '102000', 'F', 46200],               // 6/27/2026: the latest
  ['', '', '', 'Blank', 'ZZ10001', '', ' ', ' ', '', '', '', '102001', 'F', 46300],  // no pack: never the latest
  ['', '', '', 'A', 'ZZ10002', '', 12, 18, 1, 1, '', '', 'F', ''],
  ['', '', '', 'B', 'ZZ10002', '', 12, 24, 1, 1, '', '', 'F', ''],                           // no dates: the lowest row wins
  ['', '', '', 'C', 'ZZ10003', '', '', '', 1, 1, '', '', 'F', '10/1/2026'],
];

test('Master Sheet Live: each style\'s latest row with a pack (newest Order Date, else the lowest), other packs kept', () => {
  const m = Recap.parseMaster(MASTER);
  assert.equal(m.rows, 6);
  assert.deepEqual(Recap.masterPack(m, 'ZZ10001'), { pack: 48, row: 3, po: '102000', date: '2026-06-27', factory: 'F', field: 'master', others: [24] });
  assert.equal(Recap.masterPack(m, 'ZZ10002').pack, 24);
  assert.equal(Recap.masterPack(m, 'ZZ10002').row, 6);
  assert.deepEqual(Recap.masterPack(m, 'ZZ10003'), { pack: null, rows: 1, field: 'master' });
  assert.deepEqual([Recap.masterPack(m, 'ZZ10001', 'inner').pack, Recap.masterPack(m, 'ZZ10001', 'inner').row], [12, 3], 'the inner pack: the same latest row');
  assert.equal(Recap.masterPack(m, 'ZZ19999'), null);
  assert.equal(Recap.parseMaster([['Style', 'Pack']]), null);
  assert.equal(Recap.excelDate(46000), '2025-12-09');
  assert.equal(Recap.excelDate('6/27/2026'), '2026-06-27');
});

test('Master Sheet Live\'s PO blocks: the rows under a PO share its order date, and a Round row ends the block', () => {
  const H = MASTER[0];
  const row = (style, master, po, date, name) => ['', '', '', name || 'x', style, '', 12, master, 1, 1, '', po || '', po ? 'F' : '', date || ''];
  const m = Recap.parseMaster([H,
    row('ZZ20001', 48, '101860', 45771),          // an old order (4/24/2025)
    row('ZZ20002', 48),                           // under it
    row('ZZ20009', 12, '102430', 46178),          // a newer order (6/5/2026) ...
    row('ZZ20001', 24),                           // ... whose second row is the style again, with no date of its own
    ['', '', '', 'Round 2', '', '', '', '', '', '', '', '', '', ''],
    row('ZZ20001', 36),                           // after a Round: in no block, so no date
  ]);
  const p = Recap.masterPack(m, 'ZZ20001');
  assert.deepEqual([p.pack, p.row, p.po, p.date, p.others], [24, 5, '102430', '2026-06-05', [48, 36]]);
  assert.equal(Recap.masterPack(m, 'ZZ20002').po, '101860');
});

test('the saved copy of Master Sheet Live gives the same case packs, with no prices or factories in it', () => {
  const m = Recap.parseMaster(MASTER);
  const copy = JSON.parse(JSON.stringify(Recap.compactMaster(m)));
  assert.deepEqual(copy.styles.ZZ10001, [[2, 24, '101000', '2025-12-09', 12], [3, 48, '102000', '2026-06-27', 12]], 'the latest row for each pair of packs; the row with neither is dropped');
  assert.deepEqual(copy.styles.ZZ10003, [[7, null, '102001', '2026-10-05', null]], 'a style with no pack keeps one row');
  assert.ok(!JSON.stringify(copy).includes('"F"'), 'no factory names');
  const back = Recap.expandMaster(copy);
  assert.equal(copy.v, Recap.COPY_V);
  for (const field of ['master', 'inner']) for (const s of ['ZZ10001', 'ZZ10002', 'ZZ10003', 'ZZ19999']) {
    const a = Recap.masterPack(m, s, field), b = Recap.masterPack(back, s, field);
    assert.deepEqual(b && (b.pack == null ? null : [b.pack, b.row, b.po, b.date, b.others]), a && (a.pack == null ? null : [a.pack, a.row, a.po, a.date, a.others]), s + ' ' + field);
  }
});

test('a style missing from a copy that couldn\'t be updated says so, not that it isn\'t on Master Sheet Live', () => {
  const copy = Recap.expandMaster(Recap.compactMaster(Recap.parseMaster(MASTER)), true);
  const p = po({ lines: [{ ...LINES[0], style: 'ZZ19999' }] }).po;
  assert.match(Recap.packIssues([p], copy)[0].text, /^ZZ19999 isn't on the saved copy of Master Sheet Live yet, .* It's added when someone who keeps the copy up to date opens this buy\.$/);
  assert.match(Recap.packIssues([p], Recap.expandMaster(Recap.compactMaster(Recap.parseMaster(MASTER)), false))[0].text, /^ZZ19999 isn't on Master Sheet Live,/);
});

test('a style on the copy with no case pack is kept as having none, so the page knows to ask Master Sheet Live again', () => {
  const copy = Recap.compactMaster(Recap.parseMaster(MASTER));
  assert.ok(copy.styles.ZZ10003.every(r => r[1] == null));
  const p = po({ lines: [{ ...LINES[0], style: 'ZZ10003' }] }).po;
  assert.match(Recap.packIssues([p], Recap.expandMaster(copy, false))[0].text, /^ZZ10003 has no case pack/);
});

test('the sheet says whether the case packs were checked', () => {
  const b = { id: 'b', name: 'Buy', customer: 'marmaxx', notes: {}, pos: [po().po] };
  const not = Recap.worksheet(b, null, null, { packNote: 'NOT checked: Master Sheet Live couldn\'t be read (403)', packChecked: false });
  const row = +Object.keys(not).find(k => k[0] === 'B' && not[k].v === 'Case packs').slice(1);
  assert.match(not['C' + row].v, /NOT checked/);
  assert.equal(not['C' + row].s.fill.fgColor.rgb, 'FFC7CE');
  const ok = Recap.worksheet(b, null, Recap.parseMaster(MASTER), { packNote: 'checked against Master Sheet Live', packChecked: true });
  const r2 = +Object.keys(ok).find(k => k[0] === 'B' && ok[k].v === 'Case packs').slice(1);
  assert.equal(ok['C' + r2].s.fill, undefined);
});

test('case packs: the POs\' and distros\' packs against the master sheet, each finding naming where it came from', () => {
  const m = Recap.parseMaster(MASTER);
  const one = Object.assign({}, po().po, { distro: distro({ lines: [{ ...DLINES[0], pack: 24 }] }).distro });
  const issues = Recap.packIssues([one], m).map(i => i.text);
  assert.deepEqual(issues, [
    'ZZ10001: case pack 24 on 900101 distro, but Master Sheet Live says 48 (row 3, PO 102000, ordered 6/27/2026); other rows say 24.',
    'ZZ10002: case pack 48 on 900101, but Master Sheet Live says 24 (row 6, PO 102001, ordered 10/5/2026); other rows say 18.',   // under PO 102001's block
  ]);
  const extra = Object.assign({}, po({ lines: [{ ...LINES[0], style: 'ZZ10003' }, { ...LINES[1], style: 'ZZ19999' }] }).po);
  assert.deepEqual(Recap.packIssues([extra], m).map(i => i.text),
    ['ZZ10003 has no case pack (Master) on Master Sheet Live.', 'ZZ19999 isn\'t on Master Sheet Live, so its case pack can\'t be checked.']);
  assert.deepEqual(Recap.packIssues([one], null), [], 'nothing without the master sheet');
});

/* ---------------- the Excel sheets ---------------- */

test('worksheet with the master sheet: a pack it disagrees with is red and says what the master says', () => {
  const b = { id: 'b', name: 'Buy', customer: 'marmaxx', notes: {}, pos: [po().po] };
  const ws = Recap.worksheet(b, null, Recap.parseMaster(MASTER));
  const h = +Object.keys(ws).find(k => k[0] !== '!' && ws[k].v === 'Check').slice(1);
  assert.equal(ws['E' + h].v, 'Pack');
  // ZZ10002 (1336) at h+3, ZZ10001 (1438) at h+4
  assert.equal(ws['E' + (h + 3)].v, '48 (master 24)');
  assert.equal(ws['E' + (h + 3)].s.fill.fgColor.rgb, 'FFC7CE');
  assert.equal(ws['E' + (h + 4)].v, 48);
});

test('the Distro sheet: each PO by DC, what doesn\'t match red and saying why, the POs still without one', () => {
  const lines = [{ ...DLINES[0], total: 1392, units: { 881: 288, 884: 288, 886: 288, 887: 288, 888: 240 } }];
  const a = Object.assign({}, po().po, { distro: distro({ lines }).distro });
  const b2 = po({ po: '900102', banner: 'TJ Maxx' }).po;
  const ws = Recap.distroSheet({ id: 'b', name: 'Buy', customer: 'marmaxx', notes: {}, pos: [a, b2] }, null);
  const v = k => ws[k] && ws[k].v;
  assert.equal(v('B1'), 'Buy · Distro');
  assert.deepEqual([v('C3'), v('C4')], ['1 of 2 POs', '900102']);
  const head = +Object.keys(ws).find(k => k[0] === 'B' && ws[k].v === 'Style').slice(1);
  assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'K', 'L'].map(c => v(c + head)), ['Check', 'Style', 'Description', 'Pack', 'PO units', 'Distro units', 'AZR 881', 'WOB 888', 'Notes']);
  assert.deepEqual(['B', 'E', 'F', 'K'].map(c => v(c + (head + 1))), ['ZZ10001', 1440, '1392 (PO 1440)', 240]);
  assert.equal(ws['F' + (head + 1)].s.fill.fgColor.rgb, 'FFC7CE');
  assert.deepEqual(['B', 'E', 'F'].map(c => v(c + (head + 2))), ['ZZ10002', 480, 'not on distro']);
  assert.deepEqual(['B', 'E', 'F', 'G'].map(c => v(c + (head + 3))), ['Total', 1920, 1392, 288]);
  assert.equal(Recap.distroSheet({ id: 'b', name: 'B', customer: 'marmaxx', notes: {}, pos: [b2] }, null), null);
});
