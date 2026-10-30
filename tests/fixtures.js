// Made-up Marmaxx POs in the shape index.html makes from pdf.js ({ n, items: [{ s, x, y, w }], images }), laid out
// where the real TJX domestic PO prints each field, in its Marshalls and TJ Maxx layouts. No real PO is in this repo.
const it = (s, x, y) => ({ s: String(s), x, y, w: String(s).length * 3.9 });

const LAYOUT = {
  Marshalls: {
    logo: { w: 179, h: 38 },
    p1: { po: 191, ref: 285, buyer: [267.5, 534.1], order: [29.1, 510.1], start: [[102.4, 510.1, 'START SHIP DATE']], cancel: [192.4, 510.1],
          dates: [[35, 470], [116, 470], [181, 469]], total: [539.2, 300.2],
          fob: { labels: [[602, 'CITY:'], [695, 'STATE:']], city: 640, state: 744 } },
    head: y => [it('DEPT:', 120, y), it('88', 152, y), it('DOMESTIC PO NO:', 172, y), null, it('REFERENCE NO:', 273, y), null,
                it('CIR#:', 404, y), it('VENDOR NO:', 492, y), it('ZZ99', 548, y), it('VENDOR NAME:', 591, y)],
    poAt: [240, 350],
    lines: { y: 531.6, ln: 18.2, catg: 50.2, cost: 121.8, vendor: 181.4, desc: 358.5, units: 491.3, vp: 572.6,
             row: { ln: 22.3, catg: 50.8, cost: 131.2, style: 179.1, desc: 316.6, units: 492.5, pack: 572.9 } },
    pack: { y: 539.1, ln: 31.2, total: 402.5, row: { ln: 42.2, style: 94.8, desc: 193.3, units: 404.4 } },
  },
  'TJ Maxx': {
    logo: { w: 214, h: 51 },
    p1: { po: 181, ref: 268, buyer: [236.8, 535.8], order: [30.5, 510.3], start: [[106.4, 514.3, 'START SHIP'], [118, 506, 'DATE']], cancel: [183.1, 510.3],
          dates: [[36, 472], [110, 472], [178, 466]], total: [510.3, 301.7],
          fob: { labels: [[593, 'CITY'], [609, ':'], [701, 'STATE:']], city: 625, state: 748 } },
    head: y => [it('DEPT', 105, y), it(':', 124, y), it('88', 142, y), it('DOMESTIC PO NO:', 160, y), null, it('REFERENCE NO:', 274, y), null,
                it('CIR#:', 403, y), it('VENDOR NO:', 485, y), it('ZZ99', 544, y), it('VENDOR NAME:', 576, y)],
    poAt: [238, 347],
    lines: { y: 534.4, ln: 21, catg: 54.7, cost: 116.6, vendor: 169.4, desc: 357.7, units: 501.8, vp: 578.6,
             row: { ln: 25.2, catg: 55.2, cost: 125.9, style: 167.1, desc: 300.1, units: 503, pack: 578.9 } },
    pack: { y: 543.3, ln: 28.8, total: 400.3, row: { ln: 39.8, style: 91.1, desc: 189.3, units: 402.2 } },
  },
};

const fmtUnits = n => n.toLocaleString('en-US');

// o: { po, ref, banner, buyer, order, start, cancel (m/d/yyyy), lines: [{ style, desc, cost, units, catg }], total,
//      logo, perPage, packUnits: { '1/2': n }, packExtra, noPack, headPo: { 2: 'other PO' }, commas,
//      fob: { city, state } (default state NY, as the real POs print it), noFob (no FOB labels at all) }
function marmaxxPO(o) {
  const L = LAYOUT[o.banner || 'Marshalls'];
  const lines = o.lines.map((l, i) => Object.assign({ ln: '1/' + (i + 1), catg: '1438', pack: 48 }, l));
  const total = o.total != null ? o.total : lines.reduce((t, l) => t + l.units, 0);
  // the two gaps in a layout's header row are the PO number and the reference number, in that order
  const headRow = (page, y) => {
    let gap = 0;
    return L.head(y).map(h => h || (gap++ === 0 ? it((o.headPo && o.headPo[page]) || o.po, L.poAt[0], y) : it(o.ref, L.poAt[1], y)));
  };

  const p1 = [
    it('THIS ORDER IS SUBJECT TO THE ATTACHED TERMS AND CONDITIONS AND IMPORTANT VENDOR INSTRUCTIONS', 18, 595),
    it('IMPORTANT: DO NOT SHIP', 18, 587), it('OR', 97, 587),
    it('INVOICE WITHOUT ROUTING AND DISTRIBUTION INSTRUCTIONS. PLEASE CALL BUYER IF INSTRUCTIONS ARE NOT RECEIVED WITHIN 5 DAYS.', 108, 587),
    it('An Affiliate of The', 25, 544), it('TJX', 20, 534), it('Companies, Inc', 34, 534),
    it('DEPT', 106, 565), it('#', 127, 565), it('DOMESTIC PO', 175, 565), it('#', 226, 565), it('REFERENCE', 280, 565),
    it('88', 115, 550), it(o.po, L.p1.po, 550), it(o.ref, L.p1.ref, 550), it('ZZ99', 447, 550),
    ...(o.noFob ? [] : L.p1.fob.labels.map(([x, s]) => it(s, x, 550))),
    ...(o.noFob || !(o.fob || {}).city ? [] : [it(o.fob.city, L.p1.fob.city, 550)]),
    ...(o.noFob ? [] : [it(o.fob ? o.fob.state : 'NY', L.p1.fob.state, 550)].filter(i => i.s)),
    it('BUYER:', ...L.p1.buyer), it(o.buyer || 'PAT SAMPLE', L.p1.buyer[0], L.p1.buyer[1] - 8),
    it('ORDER DATE', ...L.p1.order), ...L.p1.start.map(([x, y, s]) => it(s, x, y)), it('CANCELLED IF NOT RECEIVED BY DATE', ...L.p1.cancel),
    it(o.order || '10/1/2026', ...L.p1.dates[0]), it(o.start || '10/8/2026', ...L.p1.dates[1]), it(o.cancel || '10/15/2026', ...L.p1.dates[2]),
    it('Inspection Required by (Date):', 539, 496),
    it('TOTAL PO UNITS', ...L.p1.total), it(o.commas ? fmtUnits(total) : total, 719, L.p1.total[1]),
    it('BUYER:', 18, 285), it('DATE:', 296, 285),
  ];
  const pages = [{ n: 1, items: p1, images: [o.logo || L.logo] }];

  const per = o.perPage || 13;
  for (let start = 0; start < lines.length; start += per) {
    const n = pages.length + 1, T = L.lines, items = [...headRow(n, 563)];
    items.push(it('PG/LN', T.ln, T.y), it('CATG', T.catg, T.y), it('MERCH', 84, T.y + 3.4), it('TYPE', 87, T.y - 3.6), it('UNIT COST', T.cost, T.y),
      it('VENDOR', T.vendor, T.y + 3.4), it('STYLE', T.vendor + 4, T.y - 3.6), it('COLOR', 240, T.y), it('DETAILED DESCRIPTION', T.desc, T.y),
      it('UNITS', T.units, T.y), it('PACK QTY', T.vp - 29, T.y + 4.6), it('SR', T.vp - 34, T.y - 6.5), it('VP', T.vp, T.y - 6.5));
    lines.slice(start, start + per).forEach((l, i) => {
      const y = T.y - 17.6 - 36 * i, R = T.row;
      items.push(it(l.ln, R.ln, y), it(l.catg, R.catg, y), it('2', 93, y), it(l.cost.toFixed(2), R.cost, y), it(l.style, R.style, y));
      if (l.oneItem) items.push(it('12 ' + l.desc, R.desc, y));
      else items.push(it('12', R.desc, y), it(l.desc, R.desc + 13.5, y));
      items.push(it(o.commas ? fmtUnits(l.units) : l.units, R.units, y), it(l.pack, R.pack, y), it('N', 702, y), it('N', 729, y), it('O', 758, y));
      items.push(it('SIZE RATIO:', 15, y - 12), it('TKT MSG 1:', 317, y - 12), it('HANG', 15, y - 24), it('COC DUE DATE:', 531, y - 24));
    });
    pages.push({ n, items, images: [] });
  }

  if (!o.noPack) {
    const n = pages.length + 1, P = L.pack, items = [...headRow(n, 563)];
    items.push(it('PAGE/LINE', P.ln, P.y), it('VENDOR', 97, P.y), it('DETAILED DESCRIPTION', 202, P.y), it('TOTAL', P.total, P.y),
      it('UNITS', P.total + 0.6, P.y - 6.9), it('PACK UNITS', 486, P.y), it('UNITS', 662, P.y - 6.9), it('VP', 486, P.y - 7.2));
    const packed = lines.concat(o.packExtra || []);
    packed.forEach((l, i) => {
      const y = P.y - 15.5 - 17 * i, R = P.row;
      const units = o.packUnits && o.packUnits[l.ln] != null ? o.packUnits[l.ln] : l.units;
      items.push(it(l.ln, R.ln, y), it(l.style, R.style, y), it('12', R.desc, y), it(l.desc.split(' ').slice(0, 2).join(' '), R.desc + 14, y),
        it(units, R.units, y), it(48, 486, y), it(1, 553, y + 1));
      if (l.desc.split(' ').length > 2) items.push(it(l.desc.split(' ').slice(2).join(' '), R.desc, y - 8));
    });
    pages.push({ n, items, images: [] });
  }

  pages.push({ n: pages.length + 1, items: [it('IMPORTANT VENDOR INSTRUCTIONS', 300, 560), it('SHIPPING AND ROUTING:', 18, 540)], images: [] });
  return pages;
}

// A made-up TJX distribution PDF, one page, laid out where the real one prints each field (positions read through the
// page viewport, y up from the bottom). o: { po, version, versionDate, order, start, cancel (m/d/yyyy),
// dcs: [{ prefix, code, name, dc }], lines: [{ style, tjx, desc, pack, total, units: { dc: n } }], blockPo: { prefix: 'other PO' } }
const MAR_DCS = [{ prefix: '01', code: 'AZR', name: 'MAR PHOENIX', dc: '881' }, { prefix: '04', code: 'ELP', name: 'MAR EL PASO', dc: '884' },
                 { prefix: '06', code: 'BRI', name: 'BRIDGEWATER', dc: '886' }, { prefix: '07', code: 'ATL', name: 'ATLANTA', dc: '887' },
                 { prefix: '08', code: 'WOB', name: 'WOBURN', dc: '888' }];
function marmaxxDistro(o) {
  const dcs = o.dcs || MAR_DCS, X = [35, 217, 366, 493, 619], DX = [541, 580, 622, 665, 708];
  const items = [
    it('Page', 706, 560), it('1', 727, 560), it('of', 734, 560), it('1', 743, 560),
    it('ROUTING AND DISTRIBUTION INSTRUCTIONS', 280, 549),
    it('PO Number:', 133, 537), it(o.po, 186, 537), it('PO Type: DOMESTIC', 288, 537),
    ...(o.version != null ? [it('Version:', 439, 537), it(o.version, 476, 537)] : []),
    it('Version Date:', 557, 537), it((o.versionDate || '04/09/2026') + ' 11:28 AM', 613, 537),
    it('Dept #', 133, 526), it('Order Date', 171, 526), it('Start Ship Date', 221, 526), it('Consolidator', 284, 526), it('G.O.H.', 347, 526), it('F.O.B.', 393, 526),
    it('Primary Vendor', 440, 526), it('Cancel Date', 284, 517),
    it('An Affiliate of The', 51, 509),
    it('88', 133, 505), it(o.order || '4/7/2026', 171, 505), it(o.start || '4/17/2026', 221, 505), it(o.cancel || '4/24/2026', 284, 505), it('N', 347, 505), it('C', 393, 505),
    it('METRO1 SOLUTIONS', 440, 505), it('TJX Companies, Inc.', 45, 500),
    it('Special Vendor Instructions', 37, 477),
    it('PG-LN', 37, 314), it('Vendor Style', 77, 314), it('TJX Style #', 133, 314), it('Description', 199, 314), it('Color', 345, 314), it('Vendor', 383, 314),
    it('Store', 422, 314), it('Nest', 469, 314), it('Total', 507, 314),
    it('#', 77, 305), it('Pack', 383, 305), it('Ready', 422, 305), it('Code', 469, 305), it('Units', 507, 305),
    it('Size', 383, 296), it('Pack Size', 422, 296),
  ];
  dcs.forEach((d, i) => {
    items.push(it('Distribution Center', X[i], 415), it(`PO # ${d.prefix} ${(o.blockPo && o.blockPo[d.prefix]) || o.po}`, X[i], 403), it('Ship Merchandise to:', X[i], 392),
      it(`${d.code}: ${d.name}`, X[i], 381), it(`DC #: ${d.dc}`, X[i], 370), it('1 MAIN STREET', X[i], 359));
    items.push(it(d.code, DX[i], 314), it(`DC# ${d.dc}`, DX[i], 305), it('Units', DX[i], 296));
  });
  o.lines.forEach((l, i) => {
    const y = 284 - 17 * i;
    items.push(it('1-' + (i + 1), 37, y), it(l.style, 77, y), it(l.tjx || String(482000 + i), 133, y), it('5 ' + l.desc, 199, y), it(l.pack, 383, y), it('0', 422, y), it(l.total, 507, y));
    dcs.forEach((d, j) => { if (l.units[d.dc] != null) items.push(it(l.units[d.dc], DX[j], y)); });
  });
  return [{ n: 1, items, images: [{ w: 308, h: 78 }] }];
}

// The TJ Maxx layout of the same instructions: "PG/" "L" over "N", "Vendor" over "Style #", "DC#" and its number apart,
// lines numbered 1/1, the description wrapped above and below its line, "PO #: 10 900101", "Order" over "Date".
const TJ_DCS = [{ prefix: '10', code: 'SAN', name: 'TJM SAN ANTONIO', dc: '891' }, { prefix: '40', code: 'CHA', name: 'CHARLOTTE', dc: '894' },
                { prefix: '60', code: 'WOR', name: 'WORCESTER', dc: '896' }, { prefix: '70', code: 'EVN', name: 'EVANSVILLE', dc: '897' },
                { prefix: '80', code: 'TLV', name: 'MAXX LAS VEGAS', dc: '898' }];
function marmaxxDistroTJ(o) {
  const dcs = o.dcs || TJ_DCS, X = [28, 178, 327, 477, 626], DX = [516, 568, 619, 671, 723];
  const items = [
    it('Page', 706, 557), it('1', 727, 557), it('of', 733, 557), it('1', 742, 557),
    it('ROUTING AND DISTRIBUTION INSTRUCTIONS', 280, 546),
    it('PO Number:', 129, 536), it(o.po, 180, 536), it('PO Type:', 293, 536), it('DOMESTIC', 332, 536),
    it('Version:', 449, 536), it(o.version, 486, 536), it('Version', 567, 536), it('Date:', 599, 536), it('10/29/2026 03:53 PM', 623, 536),
    it('Dept #', 129, 525), it('Order', 181, 525), it('Start Ship', 233, 525), it('Consolidato', 293, 525), it('r', 340, 525), it('G.O.H.', 355, 525), it('F.O.B', 399, 525),
    it('Date', 181, 515), it('Date', 233, 515), it('Cancel Date', 293, 515),
    it('88', 129, 507), it(o.order || '10/28/2026', 181, 507), it(o.start || '11/08/2026', 233, 507), it(o.cancel || '11/15/2026', 293, 507), it('N', 355, 507), it('F', 399, 507),
    it('TJX C', 36, 503), it('ompanies', 58, 503),
    it('PG/', 28, 317), it('L', 42, 317), it('Vendor', 60, 317), it('TJX', 115, 317), it('Description', 160, 317), it('Color', 284, 317), it('Vendor', 334, 317),
    it('Store', 382, 317), it('Nest', 428, 317), it('Total', 471, 317),
    it('N', 28, 308), it('Style #', 60, 308), it('Style #', 115, 308), it('Pack', 334, 308), it('Ready', 382, 308), it('Code', 428, 308), it('Units', 471, 308),
    it('Size', 334, 299), it('Pack', 382, 299),
  ];
  dcs.forEach((d, i) => {
    const [first, ...rest] = (d.code + ': ' + d.name).split(' ').reduce((a, w, j) => (j < 3 ? (a[0] = (a[0] ? a[0] + ' ' : '') + w) : a.push(w), a), ['']);
    items.push(it('Distribution Center', X[i], 409), it(`PO #: ${d.prefix} ${o.po}`, X[i], 400), it('Ship Merchandise to:', X[i], 392),
      it(first, X[i], 384), ...rest.map((w, j) => it(w, X[i] + 52 + 30 * j, 384)), it(`DC #: ${d.dc}`, X[i], 376));
    items.push(it(d.code, DX[i], 317), it('DC#', DX[i], 308), it(d.dc, DX[i] + 18, 308), it('Units', DX[i], 299));
  });
  o.lines.forEach((l, i) => {
    const y = 276 - 17 * i, [top, ...under] = l.desc.split(' / ');
    items.push(it('12 ' + top, 160, y + 4), it('1/' + (i + 1), 28, y), it(l.style, 60, y), it(l.tjx || String(257500 + i), 115, y), it(l.pack, 334, y), it(l.total, 471, y));
    if (under.length) items.push(it(under.join(' '), 160, y - 4));
    dcs.forEach((d, j) => { if (l.units[d.dc] != null) items.push(it(l.units[d.dc], DX[j], y)); });
  });
  return [{ n: 1, items, images: [] }];
}

// A made-up Burlington release, laid out where Burlington's portal prints each field (y up from the bottom of a 612 x 792
// page): the approval sheet, a terms page, the details sheet with the destination DC, the prepack blocks (two to a
// page, under each page's vendor heading), and the packing instructions. o: { pos: [{ po, lines: [{ style, desc, color,
// cost, per, qty, sizes: [{ size, qty }], prepack }] }], version, order, start, cancel (DD-MON-YY), dept, fob, dc,
// cover (the PO numbers page 1 lists, if not every PO's), relUnits, relCost (what page 1 says, if not the sum),
// versions: { page n: its own version }, noVersion, badSum (a block whose summing-up line is a cent out) }
const BDC = { name: 'ZZ Sample (SMP) DC', street: '1 SAMPLE WAY', city: 'SAMPLETOWN', state: 'CA', zip: '90000' };
const usd = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function burlingtonPO(o) {
  const dc = o.dc || BDC, dept = o.dept || 'Accsry', order = o.order || '27-OCT-26', start = o.start || '06-JAN-27', cancel = o.cancel || '12-JAN-27';
  const fob = o.fob || 'DESTINATION', vendor = '500000000';
  const blocks = o.pos.flatMap(p => p.lines.map(l => Object.assign({ po: p.po }, l)));
  const cents = b => Math.round(b.per * b.cost * 100);
  const units = o.relUnits != null ? o.relUnits : blocks.reduce((t, b) => t + b.qty * b.per, 0);
  const cost = o.relCost != null ? o.relCost : blocks.reduce((t, b) => t + b.qty * cents(b), 0) / 100;
  const cover = o.cover || o.pos.map(p => p.po);
  const pages = [];
  const page = items => { pages.push({ n: pages.length + 1, items, images: [] }); return items; };
  // page 1, the approval sheet
  page([
    it('Bill To', 91, 741), it('Vendor:', 289, 741), it(vendor, 334, 741), it('EDI', 500, 741),
    it('Burlington Merchandising Corp.', 25, 722), it('A-METRO1 SOLUTIONS LLC', 270, 722),
    it('1 SAMPLE ROAD', 25, 710), it('1 SAMPLE STREET', 270, 710),
    it('Order Date', 41, 657), it('Start Ship Date', 147, 657), it('Ship Cancel Date', 282, 657), it('Department', 461, 657),
    it(order, 34, 638), it(start, 154, 638), it(cancel, 280, 638), it(dept, 478, 638),
    it('THIS SHEET COVERS APPROVAL FOR THE FOLLOWING PURCHASE ORDER(s):', 22, 608),
    ...cover.map((n, i) => it(n, 30 + 73 * i, 585)),
    it('Release:', 64, 559), it('A', 113, 559),
    it('Total Rel Units:', 25, 537), it(units.toLocaleString('en-US'), 172, 537),
    it('Total Rel Cost:', 25, 519), it(usd(cost), 151, 519),
    it('Release Terms:', 24, 499), it('NET 10EOM +30 days', 26, 482), it('Freight Collect', 26, 469),
    it('F.O.B:', 27, 454), it(fob, 64, 454),
    it('This order is not valid unless signed by Purchasers Buyer. Total Rel Units are the units of the whole release.', 29, 432),
  ]);
  // a terms page: text that mentions purchase orders, prepacks and totals in sentences
  page([it('PURCHASE ORDER TERMS AND CONDITIONS', 22, 734), it('1. TERMS. All Purchase Order: terms apply to every release.', 22, 720),
        it('Prepack contents must match the order.', 23, 713)]);
  // the details sheet
  page([
    it('Bill To', 98, 732), it('Vendor: ' + vendor, 292, 732), it('EDI', 510, 732),
    it('Order Date', 42, 647), it('Department', 164, 647), it('Destination', 369, 643),
    it(order, 41, 626), it(dept, 174, 626), it(dc.name, 270, 626),
    it(dc.street, 268, 610),
    it('Start Ship Date', 31, 594), it('Ship Cancel Date', 153, 594), it(dc.city, 269, 594), it(dc.state, 410, 594), it(dc.zip, 459, 594),
    it(start, 37, 574), it(cancel, 157, 574),
    it('Ticketing Instructions:', 30, 542), it('must preticket', 148, 542),
    it('THIS SHEET COVERS DETAILS FOR THE FOLLOWING PURCHASE ORDER(s):', 27, 507),
    ...cover.map((n, i) => it(n, 31 + 73 * i, 490)),
    it('Terms', 237, 458), it('Payment:', 29, 435), it('NET 10EOM +30 days', 83, 435),
    it('Freight Terms:', 29, 396), it('Freight Collect', 120, 396), it('F.O.B:', 293, 396), it(fob, 329, 396),
    it('Total Rel Units:', 27, 297), it(units.toLocaleString('en-US'), 204, 297),
    it('Total Rel Cost:', 26, 277), it(usd(cost), 183, 277),
  ]);
  // the prepack blocks, two to a page
  const head = () => [it('Vendor #', 64, 731), it('Vendor Name', 223, 731), it('Order Date', 382, 731), it('Department', 474, 731),
                      it(vendor, 60, 712), it('A-METRO1 SOLUTIONS LLC', 177, 712), it(order, 377, 712), it(dept, 489, 712)];
  let items = null;
  blocks.forEach((b, i) => {
    if (i % 2 === 0) items = page(head());
    const y0 = i % 2 === 0 ? 664 : 396, sizes = b.sizes || [{ size: 'QTY', qty: b.per }], name = b.prepack || b.style + ' ' + b.color + ' 1' + (6 + i);
    const ext = cents(b) / 100, low = (sizes.length - 1) * 13;
    items.push(
      it('Purchase Order:', 26, y0), it(b.po.slice(0, -2), 131, y0), it(b.po.slice(-2), 181, y0),
      it('PREPACK:', 28, y0 - 14), it(name, 90, y0 - 14), it('Quantity:', 223, y0 - 14), it(b.qty, 273, y0 - 14), it('prepack(s)', 301, y0 - 14),
      it('Type:', 373, y0 - 14), it('INNERPACK', 405, y0 - 14),
      it('Ship Type:', 43, y0 - 31), it('Flat', 104, y0 - 31),
      it('Style:', 41, y0 - 54), it(b.style, 73, y0 - 54), it('Desc:', 122, y0 - 54), it(b.desc, 154, y0 - 54),
      it('Color:', 40, y0 - 67), it(b.color, 73, y0 - 67), it('Cost:', 441, y0 - 67), it(b.cost.toFixed(2), 472, y0 - 67),
      it('Size', 40, y0 - 85), it('Quantity', 139, y0 - 85),
      ...sizes.flatMap((z, k) => [it(z.size, 37, y0 - 98 - 13 * k), it(z.qty, 174, y0 - 98 - 13 * k)]),
      it('Units:', 39, y0 - 120 - low), it(b.per, 76, y0 - 120 - low), it('Ext cost:', 125, y0 - 120 - low), it(usd(ext), 177, y0 - 120 - low),
      it('Packing Instructions:', 30, y0 - 147 - low), it('Prepack - solid pre-pack', 176, y0 - 147 - low),
      it('Prepack', 30, y0 - 189 - low), it(name, 80, y0 - 189 - low), it('contains', 210, y0 - 189 - low), it(b.per, 261, y0 - 189 - low),
      it('units at total ext cost of', 277, y0 - 189 - low), it(usd(ext), 404, y0 - 189 - low),
      it(b.qty, 33, y0 - 203 - low), it('prepack(s), at cost of', 63, y0 - 203 - low), it(usd(ext), 189, y0 - 203 - low), it('=', 234, y0 - 203 - low),
      it(usd(o.badSum ? ext * b.qty + 0.01 : ext * b.qty), 255, y0 - 203 - low),
      it(b.qty, 31, y0 - 219 - low), it('prepack(s),', 66, y0 - 219 - low), it(b.per, 134, y0 - 219 - low), it('units per prepack =', 149, y0 - 219 - low),
      it(b.qty * b.per, 254, y0 - 219 - low), it('units', 289, y0 - 219 - low));
  });
  // the packing instructions
  page([...head(), it('Packing and Routing Instructions', 24, 683), it('(Pre-pack by Style -- to be shipped to Dist. Center)', 197, 683),
        it('1. Prepare one Invoice per Shipment.', 30, 570), it('A. List the Total Quantity for each Style, Color and Size.', 38, 559)]);
  for (const pg of pages) {
    pg.items.push(it('Page ' + pg.n, 488, 764), it('of ' + pages.length, 536, 764));
    const v = o.versions && o.versions[pg.n] != null ? o.versions[pg.n] : o.version;
    if (!o.noVersion) pg.items.push(it('po version:', 21, 33), it(v, 70, 33), it('v.', 535, 33), it('1.9', 550, 33));
  }
  return pages;
}

module.exports = { marmaxxPO, marmaxxDistro, marmaxxDistroTJ, burlingtonPO, MAR_DCS, TJ_DCS, LAYOUT, BDC };
