// PO Recap's logic without the page: the customer PO readers, the checks before saving, the recap and the Excel sheet.
// It touches no page and no network, so node runs tests/recap.test.js against it. index.html loads it as window.Recap.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.Recap = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================== helpers ============================== */
  const int = s => { const t = String(s).replace(/,/g, ''); return /^\d+$/.test(t) ? Number(t) : null; };
  const num = s => { const t = String(s).replace(/[$,]/g, ''); return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
  const iso = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s)); return m ? m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : null; };
  const md = d => d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : '';
  const mdy = d => d ? md(d) + '/' + d.slice(0, 4) : '';
  const fmt = n => Math.round(n || 0).toLocaleString('en-US');
  const money = n => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const words = a => a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const center = it => it.x + (it.w || 0) / 2;
  const byNo = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  // Extended cost in cents, so 25 POs of $2.25 lines add up exactly.
  const cents = (units, cost) => Math.round(units * cost * 100);

  // A page's text as rows: items whose baselines are within 2.5 pt of each other, left to right.
  // A page is { n, items: [{ s, x, y, w }], images: [{ w, h }] }, as index.html makes it from pdf.js.
  function rows(page) {
    const items = page.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const out = [];
    for (const it of items) {
      const r = out[out.length - 1];
      if (r && Math.abs(r.y - it.y) <= 2.5) r.items.push(it);
      else out.push({ y: it.y, items: [it] });
    }
    for (const r of out) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map(i => i.s).join(' '); }
    return out;
  }

  // The item whose centre is nearest x, within max points, that passes ok.
  function nearest(items, x, max, ok) {
    let best = null, gap = max;
    for (const it of items) {
      const d = Math.abs(center(it) - x);
      if (d <= gap && (!ok || ok(it))) { best = it; gap = d; }
    }
    return best;
  }

  // The headings a page's table starts with: their row, and the items in its band (two-line headings like MERCH / TYPE).
  function headings(page, rs, first) {
    const row = rs.find(r => r.items.some(i => i.s === first));
    if (!row) return null;
    const band = page.items.filter(i => i.y >= row.y - 9 && i.y <= row.y + 6);
    const get = s => band.find(i => i.s === s) || null;
    return { y: row.y - 9, get };
  }

  /* ============================== Marmaxx ============================== */
  // A TJX domestic PO (Marshalls or TJ Maxx): page 1 has the dates, buyer and total units; the line pages (PG/LN) the
  // lines; the pack configuration pages (PAGE/LINE) each line's total units again. Every line and pack page repeats
  // DEPT, DOMESTIC PO NO, REFERENCE NO and VENDOR NO. The banner is the logo on page 1.
  const LOGOS = { '179x38': 'Marshalls', '214x51': 'TJ Maxx' };
  const STYLE = /^[A-Z0-9][A-Z0-9-]*$/i;

  function readMarmaxx(pages) {
    const fail = (why, po) => ({ error: why, poNo: po || '' });
    if (!pages.length) return fail('The file has no pages.');
    const p1 = pages[0], first = rows(p1), firstText = first.map(r => r.text).join('\n');
    if (!/DOMESTIC PO/.test(firstText) || !/\bTJX\b/.test(firstText)) return fail("This isn't a Marmaxx PO: it doesn't have the TJX domestic PO header.");

    let head = null;
    const lines = [], pack = new Map();
    for (const page of pages) {
      const rs = rows(page);
      for (const r of rs) {
        // the TJ Maxx layout sets some colons apart ("DEPT : 88")
        const m = /DEPT\s*:\s*(\S+)\s+DOMESTIC PO NO\s*:\s*(\d+)\s+REFERENCE NO\s*:\s*(\S+)\s+CIR#\s*:.*?VENDOR NO\s*:\s*(\S+)/.exec(r.text);
        if (!m) continue;
        if (!head) head = { dept: m[1], po: m[2], ref: m[3], vendor: m[4], page: page.n };
        else if (m[2] !== head.po || m[3] !== head.ref) return fail(`Page ${page.n} is for PO ${m[2]} (reference ${m[3]}), but page ${head.page} is for PO ${head.po} (reference ${head.ref}).`, head.po);
      }

      const lh = headings(page, rs, 'PG/LN');
      if (lh) {
        const col = { ln: lh.get('PG/LN'), catg: lh.get('CATG'), cost: lh.get('UNIT COST'), style: lh.get('VENDOR'), units: lh.get('UNITS'), vp: lh.get('VP') };
        const missing = Object.keys(col).filter(k => !col[k]);
        if (missing.length) return fail(`Page ${page.n}'s line headings aren't the ones this reader knows.`, head && head.po);
        for (const r of rs) {
          const lnItem = r.items[0];
          if (r.y >= lh.y || !/^\d+\/\d+$/.test(lnItem.s) || lnItem.x > col.ln.x + 30) continue;
          const ln = lnItem.s, rest = r.items.slice(1);
          const style = nearest(rest, center(col.style), 35, i => STYLE.test(i.s));
          const cost = nearest(rest, center(col.cost), 30, i => num(i.s) != null);
          const units = nearest(rest, center(col.units), 25, i => int(i.s) != null);
          const packed = nearest(rest, center(col.vp), 20, i => int(i.s) != null);
          const catg = nearest(rest, center(col.catg), 20, i => /^\d+$/.test(i.s));
          const gone = [!style && 'vendor style', !cost && 'unit cost', !units && 'units'].filter(Boolean);
          if (gone.length) return fail(`Line ${ln} couldn't be read: no ${words(gone)} where the headings put them.`, head && head.po);
          if (lines.some(l => l.ln === ln)) return fail(`Line ${ln} appears twice.`, head && head.po);
          let desc = rest.filter(i => i.x > style.x && i.x < units.x && i !== style && i !== cost && i !== catg).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
          let code = '';
          const c = /^(\d{1,3})\s+(.+)$/.exec(desc);
          if (c) { code = c[1]; desc = c[2]; }
          lines.push({ ln, catg: catg ? catg.s : '', style: style.s.toUpperCase(), desc, code, cost: num(cost.s), units: int(units.s), pack: packed ? int(packed.s) : null });
        }
      }

      const ph = headings(page, rs, 'PAGE/LINE');
      if (ph) {
        const lnCol = ph.get('PAGE/LINE'), total = ph.get('TOTAL');
        if (!total) return fail(`Page ${page.n}'s pack configuration headings aren't the ones this reader knows.`, head && head.po);
        for (const r of rs) {
          const lnItem = r.items[0];
          if (r.y >= ph.y || !/^\d+\/\d+$/.test(lnItem.s) || lnItem.x > lnCol.x + 30) continue;
          const units = nearest(r.items.slice(1), center(total), 25, i => int(i.s) != null);
          if (!units) return fail(`Line ${lnItem.s}'s total units couldn't be read on the pack configuration page.`, head && head.po);
          pack.set(lnItem.s, int(units.s));
        }
      }
    }
    if (!head) return fail("The PO number couldn't be found (no DOMESTIC PO NO on the line pages).");
    const po = head.po;
    if (!first.some(r => r.items.some(i => i.s === po))) return fail(`Page 1 doesn't show PO ${po}, which the line pages are for.`, po);

    // page 1: each date sits under its label (TJ Maxx wraps START SHIP / DATE); the buyer under BUYER:; the total
    // beside TOTAL PO UNITS
    const items1 = p1.items;
    const label = { order: items1.find(i => i.s === 'ORDER DATE'), start: items1.find(i => /^START SHIP( DATE)?$/.test(i.s)),
                    cancel: items1.find(i => /^CANCELLED IF NOT RECEIVED/.test(i.s)) };
    const NAMES = { order: 'order', start: 'start ship', cancel: 'cancel' };
    const got = { order: [], start: [], cancel: [] };
    for (const d of items1.filter(i => iso(i.s))) {
      let best = null, gap = 30;
      for (const k of Object.keys(label)) {
        const l = label[k];
        if (!l || d.y >= l.y || d.y < l.y - 60) continue;
        const g = Math.abs(d.x - l.x);
        if (g <= gap) { best = k; gap = g; }
      }
      if (best) got[best].push(iso(d.s));
    }
    for (const k of Object.keys(got)) {
      if (got[k].length !== 1) return fail(`The ${NAMES[k]} date couldn't be read on page 1.`, po);
    }
    const buyerLabel = items1.filter(i => i.s === 'BUYER:').sort((a, b) => b.y - a.y)[0];
    const buyer = buyerLabel && items1.find(i => i.y < buyerLabel.y - 2 && i.y >= buyerLabel.y - 14 && Math.abs(i.x - buyerLabel.x) <= 12);
    const totalRow = first.find(r => r.items.some(i => i.s === 'TOTAL PO UNITS'));
    const totalAt = totalRow && totalRow.items.findIndex(i => i.s === 'TOTAL PO UNITS');
    const totalItem = totalRow && totalRow.items.slice(totalAt + 1).find(i => int(i.s) != null);
    if (!totalItem) return fail("The PO's total units couldn't be found on page 1.", po);
    const totalUnits = int(totalItem.s);

    const logo = (p1.images || []).map(i => LOGOS[i.w + 'x' + i.h]).find(Boolean);
    if (!logo) return fail("The logo on page 1 isn't Marshalls' or TJ Maxx's, so the banner can't be told.", po);

    if (!lines.length) return fail('No PO lines were found.', po);
    for (const [ln, units] of pack) {
      const l = lines.find(x => x.ln === ln);
      if (!l) return fail(`Line ${ln} is in the pack configuration but wasn't read on the line pages.`, po);
      if (l.units !== units) return fail(`Line ${ln} (${l.style}) has ${fmt(l.units)} units on the line page but ${fmt(units)} in the pack configuration.`, po);
    }
    if (pack.size) {
      const unpacked = lines.filter(l => !pack.has(l.ln)).map(l => l.ln);
      if (unpacked.length) return fail(`Line${unpacked.length > 1 ? 's' : ''} ${words(unpacked)} ${unpacked.length > 1 ? "aren't" : "isn't"} in the pack configuration.`, po);
    }
    const sum = lines.reduce((t, l) => t + l.units, 0);
    if (sum !== totalUnits) return fail(`The lines add up to ${fmt(sum)} units, but the PO says ${fmt(totalUnits)}.`, po);

    return { po: { po, banner: logo, dept: head.dept, ref: head.ref, vendor: head.vendor, buyer: buyer ? buyer.s : '',
                   orderDate: got.order[0], startShip: got.start[0], cancel: got.cancel[0], totalUnits, lines } };
  }

  /* ============================== customers ============================== */
  // The dropdown's list, in its order. A customer without a reader shows but can't be picked yet.
  const CUSTOMERS = [
    { key: 'marmaxx', name: 'Marmaxx', read: readMarmaxx, banners: ['Marshalls', 'TJ Maxx'], pairs: true },
    { key: 'burlington', name: 'Burlington', read: null, soon: 'needs sample POs', banners: [], pairs: false },
  ];
  const customer = key => CUSTOMERS.find(c => c.key === key) || null;

  function read(key, pages) {
    const c = customer(key);
    if (!c || !c.read) return { error: 'There is no reader for ' + (c ? c.name : key) + ' yet.' };
    return c.read(pages);
  }

  const defaultName = (name, d) => name + ' buy ' + (d.getMonth() + 1) + '/' + d.getDate();

  /* ============================== checks before saving ============================== */
  // results: [{ file, po } | { file, error, poNo }] from the reader. here: the PO numbers already in this buy (when POs
  // are added to it). others: [{ name, pos: [PO numbers] }], every other buy. Nothing is dropped silently: each file
  // ends up accepted, refused with its reason, or named in a note (the same PO dropped twice).
  function checkBatch(results, here, others) {
    const refused = [], notes = [], groups = new Map();
    for (const r of results) {
      if (r.error) { refused.push({ file: r.file, po: r.poNo || '', why: r.error }); continue; }
      const g = groups.get(r.po.po) || [];
      g.push(r); groups.set(r.po.po, g);
    }
    const accepted = [];
    for (const [no, g] of groups) {
      const same = g.every(r => JSON.stringify(r.po) === JSON.stringify(g[0].po));
      if (!same) {
        for (const r of g) refused.push({ file: r.file, po: no, why: `Two different versions of PO ${no} were dropped (${words(g.map(x => x.file))}). Drop only the one you want.` });
        continue;
      }
      if (g.length > 1) notes.push(`PO ${no} was dropped ${g.length} times (${words(g.map(x => x.file))}). It's read once.`);
      const r = g[0];
      if ((here || []).includes(no)) { refused.push({ file: r.file, po: no, why: `PO ${no} is already in this buy.` }); continue; }
      const other = (others || []).find(b => (b.pos || []).includes(no));
      if (other) { refused.push({ file: r.file, po: no, why: `PO ${no} is already in “${other.name}”.` }); continue; }
      accepted.push(Object.assign({ file: r.file }, r.po));
    }
    accepted.sort((a, b) => byNo(a.po, b.po));
    refused.sort((a, b) => byNo(a.po, b.po) || String(a.file).localeCompare(String(b.file)));
    return { accepted, refused, notes };
  }

  /* ============================== flags ============================== */
  // What needs a look on a saved buy. Worked out from its POs every time, never stored, so they can't go stale.
  function flags(key, pos) {
    const c = customer(key) || {}, out = [];
    const nos = a => words(a.map(p => p.po).sort(byNo));
    if (c.pairs) {
      const refs = new Map();
      for (const p of pos) { const g = refs.get(p.ref) || []; g.push(p); refs.set(p.ref, g); }
      for (const [ref, g] of [...refs].sort((a, b) => byNo(a[0], b[0]))) {
        const have = [...new Set(g.map(p => p.banner))];
        if (g.length === 1) {
          const lack = c.banners.filter(b => b !== g[0].banner);
          out.push({ kind: 'pair', pos: [g[0].po], text: `Reference ${ref} has only the ${g[0].banner} PO (${g[0].po}). Its ${words(lack)} PO is missing.` });
        } else if (have.length < g.length) {
          out.push({ kind: 'pair', pos: g.map(p => p.po), text: `Reference ${ref} has ${g.length} POs (${nos(g)}) but not one for each banner: ${words(g.map(p => p.po + ' ' + p.banner))}.` });
        }
      }
    }
    const styles = new Map();
    for (const p of pos) for (const l of p.lines) {
      const s = styles.get(l.style) || []; s.push({ p, l }); styles.set(l.style, s);
    }
    for (const [style, uses] of [...styles].sort((a, b) => byNo(a[0], b[0]))) {
      const costs = new Map(), descs = new Map();
      for (const u of uses) {
        (costs.get(u.l.cost) || costs.set(u.l.cost, new Set()).get(u.l.cost)).add(u.p.po);
        const k = u.l.desc.replace(/\s+/g, ' ').trim().toUpperCase();
        (descs.get(k) || descs.set(k, { text: u.l.desc, pos: new Set() }).get(k)).pos.add(u.p.po);
      }
      const on = set => 'on ' + [...set].sort(byNo).join(', ');
      if (costs.size > 1) {
        const parts = [...costs].sort((a, b) => b[1].size - a[1].size || a[0] - b[0]).map(([cost, set]) => `${money(cost)} ${on(set)}`);
        out.push({ kind: 'cost', style, pos: [...new Set(uses.map(u => u.p.po))], text: `${style} is costed ${parts.join('; ')}.` });
      }
      if (descs.size > 1) {
        const parts = [...descs.values()].sort((a, b) => b.pos.size - a.pos.size).map(d => `“${d.text}” ${on(d.pos)}`);
        out.push({ kind: 'desc', style, pos: [...new Set(uses.map(u => u.p.po))], text: `${style} is ${parts.join('; ')}.` });
      }
    }
    const sig = p => [p.banner, p.startShip, p.cancel, p.lines.map(l => l.style + ':' + l.units).sort().join(',')].join('|');
    const seen = new Map();
    for (const p of pos.slice().sort((a, b) => byNo(a.po, b.po))) {
      const k = sig(p);
      if (seen.has(k)) seen.get(k).push(p); else seen.set(k, [p]);
    }
    for (const g of seen.values()) if (g.length > 1) {
      out.push({ kind: 'twice', pos: g.map(p => p.po), text: `POs ${nos(g)} have the same lines, units, banner and ship window. Was one sent twice?` });
    }
    return out;
  }

  /* ============================== the recap ============================== */
  // POs grouped by ship window (start to cancel), then banner, then PO; one row per style.
  function recap(buy) {
    const c = customer(buy.customer) || { banners: [] };
    const bannerAt = b => { const i = c.banners.indexOf(b); return i < 0 ? 99 : i; };
    const pos = buy.pos.slice().sort((a, b) => (a.startShip || '').localeCompare(b.startShip || '') || (a.cancel || '').localeCompare(b.cancel || '')
      || bannerAt(a.banner) - bannerAt(b.banner) || String(a.banner).localeCompare(String(b.banner)) || byNo(a.po, b.po));
    const windows = [];
    for (const p of pos) {
      const key = p.startShip + '|' + p.cancel;
      let w = windows[windows.length - 1];
      if (!w || w.key !== key) windows.push(w = { key, label: md(p.startShip) + '–' + md(p.cancel), start: p.startShip, cancel: p.cancel, banners: [] });
      let b = w.banners[w.banners.length - 1];
      if (!b || b.banner !== p.banner) w.banners.push(b = { banner: p.banner, pos: [] });
      b.pos.push(p);
    }
    const byStyle = new Map();
    for (const p of pos) for (const l of p.lines) {
      let r = byStyle.get(l.style);
      if (!r) byStyle.set(l.style, r = { style: l.style, catg: l.catg, descs: new Map(), costs: new Set(), units: {}, total: 0, ext: 0 });
      // the description most POs give; a tie goes to the highest PO number, the latest one written
      const d = r.descs.get(l.desc) || { n: 0, po: '' };
      r.descs.set(l.desc, { n: d.n + 1, po: byNo(p.po, d.po) > 0 ? p.po : d.po });
      r.costs.add(l.cost);
      r.units[p.po] = (r.units[p.po] || 0) + l.units;
      r.total += l.units;
      r.ext += cents(l.units, l.cost);
    }
    const rows = [...byStyle.values()].map(r => {
      const desc = [...r.descs].sort((a, b) => b[1].n - a[1].n || byNo(b[1].po, a[1].po))[0][0];
      const costs = [...r.costs].sort((a, b) => a - b);
      return { style: r.style, catg: r.catg, desc, costs, cost: costs.length === 1 ? costs[0] : null, units: r.units, total: r.total, ext: r.ext / 100 };
    }).sort((a, b) => byNo(a.catg, b.catg) || byNo(a.style, b.style));

    const poUnits = {}, poExt = {};
    for (const p of pos) {
      poUnits[p.po] = p.lines.reduce((t, l) => t + l.units, 0);
      poExt[p.po] = p.lines.reduce((t, l) => t + cents(l.units, l.cost), 0) / 100;
    }
    const sumOf = list => ({ pos: list.length, units: list.reduce((t, p) => t + poUnits[p.po], 0), ext: Math.round(list.reduce((t, p) => t + poExt[p.po] * 100, 0)) / 100 });
    const all = sumOf(pos);
    const byWindow = windows.map(w => Object.assign({ label: w.label }, sumOf(w.banners.flatMap(b => b.pos))));
    const banners = [...new Set(pos.map(p => p.banner))].sort((a, b) => bannerAt(a) - bannerAt(b) || a.localeCompare(b));
    const byBanner = banners.map(b => Object.assign({ banner: b }, sumOf(pos.filter(p => p.banner === b))));
    const uniq = f => [...new Set(pos.map(f).filter(Boolean))].sort();
    const orders = uniq(p => p.orderDate);
    return {
      windows, pos, rows, poUnits, poExt, byWindow, byBanner,
      total: all,
      summary: { customer: c.name || buy.customer, pos: all.pos, units: all.units, ext: all.ext, buyers: uniq(p => p.buyer), depts: uniq(p => p.dept),
                 orderFrom: orders[0] || '', orderTo: orders[orders.length - 1] || '', windows: windows.length },
    };
  }

  /* ============================== the Excel sheet ============================== */
  // The recap as a SheetJS worksheet object, styled for xlsx-js-style (the page writes it; node tests read it as is).
  // Check first, Notes last, dates m/d/yyyy: a summary on top, then the recap with ship window / banner / PO # headings,
  // a totals row, and the flags with their own Check column.
  const BORDER = { style: 'thin', color: { rgb: 'BFBFBF' } };
  const BOX = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
  const TITLE_FILL = 'D9EAF7';
  const STYLES = {
    title: { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: TITLE_FILL } } },
    label: { font: { bold: true } },
    value: { alignment: { horizontal: 'left' } },
    section: { font: { bold: true, sz: 12 } },
    head: { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, fill: { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } }, border: BOX },
    window: { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: TITLE_FILL } }, border: BOX },
    check: { alignment: { horizontal: 'center', vertical: 'top' }, border: BOX },
    text: { alignment: { vertical: 'top' }, border: BOX },
    wrap: { alignment: { vertical: 'top', wrapText: true }, border: BOX },
    units: { numFmt: '#,##0', alignment: { vertical: 'top' }, border: BOX },
    money: { numFmt: '$#,##0.00', alignment: { vertical: 'top' }, border: BOX },
    totalLabel: { font: { bold: true }, border: { top: { style: 'medium' }, bottom: BORDER, left: BORDER, right: BORDER } },
    totalUnits: { font: { bold: true }, numFmt: '#,##0', border: { top: { style: 'medium' }, bottom: BORDER, left: BORDER, right: BORDER } },
    totalMoney: { font: { bold: true }, numFmt: '$#,##0.00', border: { top: { style: 'medium' }, bottom: BORDER, left: BORDER, right: BORDER } },
    plainUnits: { numFmt: '#,##0' },
    plainMoney: { numFmt: '$#,##0.00' },
  };

  function colName(c) { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

  function worksheet(buy, fl) {
    // a copy for each sheet: xlsx-js-style rewrites the style objects it writes (colours gain an FF alpha)
    const ST = JSON.parse(JSON.stringify(STYLES));
    const R = recap(buy), ws = {}, merges = [], notes = buy.notes || {};
    fl = fl || flags(buy.customer, buy.pos);
    let maxR = 0, maxC = 0;
    const put = (r, c, v, s) => {
      if (v === null || v === undefined || v === '') { if (s) ws[colName(c) + (r + 1)] = { t: 's', v: '', s }; }
      else {
        const cell = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) };
        if (s) { cell.s = s; if (s.numFmt) cell.z = s.numFmt; }
        ws[colName(c) + (r + 1)] = cell;
      }
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
    };
    const merge = (r1, c1, r2, c2) => { if (r2 > r1 || c2 > c1) merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }); };

    const cols = R.windows.flatMap(w => w.banners.flatMap(b => b.pos.map(p => p.po)));
    const C = { check: 0, style: 1, desc: 2, cost: 3, po0: 4 };
    C.total = C.po0 + cols.length; C.ext = C.total + 1; C.notes = C.ext + 1;

    // title and summary
    put(0, C.style, buy.name, ST.title);
    for (let c = C.style + 1; c <= C.notes; c++) put(0, c, '', ST.title);
    merge(0, C.style, 0, C.notes);
    const S = R.summary;
    const facts = [
      ['Customer', S.customer],
      ['POs', S.pos + ' (' + R.byBanner.map(b => b.pos + ' ' + b.banner).join(', ') + ')'],
      ['Units', S.units, ST.plainUnits],
      ['Cost', S.ext, ST.plainMoney],
      ['Ordered', S.orderFrom === S.orderTo ? mdy(S.orderFrom) : mdy(S.orderFrom) + ' – ' + mdy(S.orderTo)],
      ['Buyer', S.buyers.join(', ')],
      ['Dept', S.depts.join(', ')],
    ];
    let r = 2;
    for (const [k, v, s] of facts) { put(r, C.style, k, ST.label); put(r, C.desc, v, s || ST.value); r++; }
    r++;
    const mini = (title, list, name) => {
      put(r, C.style, title, ST.head); put(r, C.desc, 'POs', ST.head); put(r, C.cost, 'Units', ST.head); put(r, C.po0, 'Cost', ST.head); r++;
      for (const x of list) { put(r, C.style, x[name], ST.text); put(r, C.desc, x.pos, ST.units); put(r, C.cost, x.units, ST.units); put(r, C.po0, x.ext, ST.money); r++; }
      r++;
    };
    mini('Ship window', R.byWindow, 'label');
    mini('Banner', R.byBanner, 'banner');
    r++;

    // the recap: three heading rows (ship window, banner, PO #)
    const h0 = r;
    for (const [c, t] of [[C.check, 'Check'], [C.style, 'Style'], [C.desc, 'Description'], [C.cost, 'Cost'], [C.total, 'Total units'], [C.ext, 'Ext cost'], [C.notes, 'Notes']]) {
      put(h0, c, t, ST.head); put(h0 + 1, c, '', ST.head); put(h0 + 2, c, '', ST.head); merge(h0, c, h0 + 2, c);
    }
    let c = C.po0;
    for (const w of R.windows) {
      const n = w.banners.reduce((t, b) => t + b.pos.length, 0);
      for (let i = 0; i < n; i++) put(h0, c + i, i ? '' : w.label, ST.window);
      merge(h0, c, h0, c + n - 1);
      for (const b of w.banners) {
        for (let i = 0; i < b.pos.length; i++) put(h0 + 1, c + i, i ? '' : b.banner, ST.head);
        merge(h0 + 1, c, h0 + 1, c + b.pos.length - 1);
        for (const p of b.pos) put(h0 + 2, c++, /^[1-9]\d{0,14}$/.test(p.po) ? Number(p.po) : p.po, ST.head);
      }
    }
    r = h0 + 3;
    for (const row of R.rows) {
      put(r, C.check, '☐', ST.check);
      put(r, C.style, row.style, ST.text);
      put(r, C.desc, row.desc, ST.wrap);
      put(r, C.cost, row.cost != null ? row.cost : row.costs.map(x => x.toFixed(2)).join(' / '), row.cost != null ? ST.money : ST.text);
      cols.forEach((po, i) => put(r, C.po0 + i, row.units[po] != null ? row.units[po] : '', ST.units));
      put(r, C.total, row.total, ST.units);
      put(r, C.ext, row.ext, ST.money);
      put(r, C.notes, notes[row.style] || '', ST.wrap);
      r++;
    }
    put(r, C.check, '', ST.totalLabel); put(r, C.style, 'Total', ST.totalLabel); put(r, C.desc, '', ST.totalLabel); put(r, C.cost, '', ST.totalLabel);
    cols.forEach((po, i) => put(r, C.po0 + i, R.poUnits[po], ST.totalUnits));
    put(r, C.total, R.total.units, ST.totalUnits); put(r, C.ext, R.total.ext, ST.totalMoney); put(r, C.notes, '', ST.totalLabel);
    r += 3;

    // flags
    put(r, C.style, fl.length ? 'Flags' : 'Flags: none', ST.section); r++;
    if (fl.length) {
      put(r, C.check, 'Check', ST.head); put(r, C.style, 'Flag', ST.head);
      for (let x = C.style + 1; x <= C.notes; x++) put(r, x, '', ST.head);
      merge(r, C.style, r, C.notes); r++;
      for (const f of fl) {
        put(r, C.check, '☐', ST.check); put(r, C.style, f.text, ST.wrap);
        for (let x = C.style + 1; x <= C.notes; x++) put(r, x, '', ST.wrap);
        merge(r, C.style, r, C.notes); r++;
      }
    }

    ws['!ref'] = 'A1:' + colName(maxC) + (maxR + 1);
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 7 }, { wch: 13 }, { wch: 34 }, { wch: 10 }, ...cols.map(() => ({ wch: 10 })), { wch: 11 }, { wch: 13 }, { wch: 30 }];
    ws['!rows'] = [{ hpt: 24 }];
    return ws;
  }

  // Excel sheet names: 31 characters, none of : \ / ? * [ ]
  function sheetName(name, used) {
    const base = (String(name).replace(/[:\\/?*[\]]/g, '-').trim() || 'Buy').slice(0, 31);
    let s = base, n = 2;
    while (used && used.has(s.toLowerCase())) { const tail = ' (' + n++ + ')'; s = base.slice(0, 31 - tail.length) + tail; }
    if (used) used.add(s.toLowerCase());
    return s;
  }

  return { CUSTOMERS, customer, read, readMarmaxx, rows, checkBatch, flags, recap, worksheet, sheetName, defaultName,
           int, num, iso, md, mdy, fmt, money, words, colName };
});
