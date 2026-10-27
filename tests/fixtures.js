// Made-up Marmaxx POs in the shape index.html makes from pdf.js ({ n, items: [{ s, x, y, w }], images }), laid out
// where the real TJX domestic PO prints each field, in its Marshalls and TJ Maxx layouts. No real PO is in this repo.
const it = (s, x, y) => ({ s: String(s), x, y, w: String(s).length * 3.9 });

const LAYOUT = {
  Marshalls: {
    logo: { w: 179, h: 38 },
    p1: { po: 191, ref: 285, buyer: [267.5, 534.1], order: [29.1, 510.1], start: [[102.4, 510.1, 'START SHIP DATE']], cancel: [192.4, 510.1],
          dates: [[35, 470], [116, 470], [181, 469]], total: [539.2, 300.2] },
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
          dates: [[36, 472], [110, 472], [178, 466]], total: [510.3, 301.7] },
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
//      logo, perPage, packUnits: { '1/2': n }, packExtra, noPack, headPo: { 2: 'other PO' }, commas }
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
    it('An Affiliate of The', 25, 544), it('TJX', 20, 534), it('Companies, Inc', 34, 534),
    it('DEPT', 106, 565), it('#', 127, 565), it('DOMESTIC PO', 175, 565), it('#', 226, 565), it('REFERENCE', 280, 565),
    it('88', 115, 550), it(o.po, L.p1.po, 550), it(o.ref, L.p1.ref, 550), it('ZZ99', 447, 550),
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

module.exports = { marmaxxPO, LAYOUT };
