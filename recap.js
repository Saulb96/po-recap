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
  // two descriptions are the same when they differ only in capitals and spacing
  const descKey = d => String(d).replace(/\s+/g, ' ').trim().toUpperCase();
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
                   orderDate: got.order[0], startShip: got.start[0], cancel: got.cancel[0], fob: readFob(first, po), totalUnits, lines } };
  }

  // The FOB point: on page 1's header row (the one with the PO number), after CITY: and STATE: under FOB POINT. The TJ
  // Maxx layout sets the colon apart ("CITY :"). Null when the labels aren't there, so it reads as unknown, not blank.
  function readFob(first, po) {
    const row = first.find(r => r.items.some(i => i.s === po) && r.items.some(i => /^CITY\s*:?$/.test(i.s)));
    if (!row) return null;
    const at = re => row.items.findIndex(i => re.test(i.s));
    const c = at(/^CITY\s*:?$/), s = at(/^STATE\s*:?$/);
    if (c < 0 || s < c) return null;
    const words = list => list.map(i => i.s).filter(t => t !== ':').join(' ').trim();
    return { city: words(row.items.slice(c + 1, s)), state: words(row.items.slice(s + 1)) };
  }
  const fobLabel = f => !f ? '' : f.city && f.state ? f.city + ', ' + f.state : (f.city || f.state || 'blank');
  // LA is Los Angeles: city LOS ANGELES, or LA written in the city box. LA in the state box is Louisiana, so it's flagged.
  function fobIsLA(f) {
    if (!f) return true;   // not read (a buy saved before FOB was read): nothing to flag
    const city = f.city.toUpperCase();
    return /\bLOS ANGELES\b/.test(city) || city === 'LA';
  }

  /* ============================== Marmaxx distribution instructions ============================== */
  // TJX's "Routing and Distribution Instructions" for one PO, as a PDF: the PO number and version on top, the order /
  // start ship / cancel dates under their labels, one block per distribution center (PO # 01 900101, DC #: 881), then
  // one line per style with its vendor pack size, total units and the units for each DC. Marshalls DCs carry PO prefixes
  // 01-08, TJ Maxx 10-80 (the PO's own terms page says so), which tells the banner.
  const bannerOfPrefixes = prefixes => {
    if (!prefixes.length) return null;
    if (prefixes.every(p => /^0[1-8]$/.test(p))) return 'Marshalls';
    if (prefixes.every(p => /^[1-8]0$/.test(p))) return 'TJ Maxx';
    return null;
  };
  // the title on its own (every PO also says "...WITHOUT ROUTING AND DISTRIBUTION INSTRUCTIONS" in a sentence), with
  // the "PO Number:" line a distro carries and a PO doesn't
  const isDistroPages = pages => pages.some(p => p.items.some(i => /^ROUTING AND DISTRIBUTION INSTRUCTIONS$/i.test(i.s)) && p.items.some(i => /^PO Number:/.test(i.s)));

  function readMarmaxxDistro(pages, fileName) {
    const fail = (why, po) => ({ error: why, poNo: po || '', distroFile: true });
    let po = null, version = null, versionDate = '', dates = null, dept = '';
    const dcs = new Map(), lines = [];
    for (const page of pages) {
      const rs = rows(page);
      for (const r of rs) {
        const m = /PO Number:\s*(\d+)/.exec(r.text);
        if (m) {
          if (po && m[1] !== po) return fail(`Page ${page.n} is for PO ${m[1]}, but the distro started with PO ${po}.`, po);
          po = m[1];
          const v = /Version:\s*(\d+)/.exec(r.text); if (v) version = +v[1];
          const vd = /Version Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(r.text); if (vd) versionDate = iso(vd[1]);
        }
      }
      // the dates: the first row under the "Order Date" labels with three dates, read left to right
      const labels = rs.find(r => r.items.some(i => i.s === 'Order Date') && r.items.some(i => /^Start Ship/.test(i.s)));
      if (labels && !dates) {
        const vals = rs.find(r => r.y < labels.y && r.items.filter(i => iso(i.s)).length >= 3);
        if (vals) {
          const ds = vals.items.filter(i => iso(i.s));
          dates = { order: iso(ds[0].s), start: iso(ds[1].s), cancel: iso(ds[2].s) };
          const d = labels.items.find(i => /^Dept/.test(i.s));
          const dv = d && vals.items.find(i => Math.abs(i.x - d.x) < 12 && /^\d+$/.test(i.s));
          if (dv) dept = dv.s;
        }
      }
      // the DC blocks: "PO # 01 900101", with "AZR: MAR PHOENIX" and "DC #: 881" under each
      for (const it of page.items) {
        const b = /^PO # (\d{2}) (\d+)$/.exec(it.s);
        if (!b) continue;
        if (po && b[2] !== po) return fail(`The DC block for prefix ${b[1]} is for PO ${b[2]}, not ${po}.`, po);
        const col = page.items.filter(i => Math.abs(i.x - it.x) < 6 && i.y < it.y && i.y > it.y - 50);
        const dcNo = col.map(i => /^DC #:\s*(\d+)$/.exec(i.s)).find(Boolean);
        const name = col.map(i => /^([A-Z]{3}):\s*(.+)$/.exec(i.s)).find(Boolean);
        if (!dcNo) return fail(`The DC number for prefix ${b[1]} couldn't be read.`, po);
        dcs.set(dcNo[1], { dc: dcNo[1], prefix: b[1], code: name ? name[1] : '', name: name ? name[2] : '' });
      }
      // the line table: headings in a band, the DC columns named by "DC# 881" under each code
      const head = headings(page, rs, 'PG-LN');
      if (head) {
        const get = s => page.items.find(i => i.s === s && i.y >= head.y - 2 && i.y <= head.y + 20) || null;
        const col = { style: get('Vendor Style'), tjx: get('TJX Style #'), desc: get('Description'), pack: get('Vendor'), total: get('Total') };
        if (!col.style || !col.pack || !col.total) return fail(`Page ${page.n}'s distribution headings aren't the ones this reader knows.`, po);
        const dcCols = page.items.filter(i => /^DC# \d+$/.test(i.s) && i.y >= head.y - 2 && i.y <= head.y + 20)
          .map(i => ({ dc: i.s.replace('DC# ', ''), x: center(i) }));
        if (!dcCols.length) return fail(`Page ${page.n}'s DC columns couldn't be read.`, po);
        for (const r of rs) {
          const lnItem = r.items[0];
          if (r.y >= head.y || !/^\d+-\d+$/.test(lnItem.s)) continue;
          const rest = r.items.slice(1);
          const style = nearest(rest, center(col.style), 30, i => STYLE.test(i.s));
          const tjx = col.tjx && nearest(rest, center(col.tjx), 25, i => /^\d+$/.test(i.s));
          const pack = nearest(rest, center(col.pack), 18, i => int(i.s) != null);
          const total = nearest(rest, center(col.total), 18, i => int(i.s) != null);
          const gone = [!style && 'vendor style', !pack && 'vendor pack', !total && 'total units'].filter(Boolean);
          if (gone.length) return fail(`Line ${lnItem.s} couldn't be read: no ${words(gone)} where the headings put them.`, po);
          const units = {};
          for (const c of dcCols) {
            const u = nearest(rest, c.x, 16, i => int(i.s) != null && i !== total && i !== pack);
            if (u) units[c.dc] = int(u.s);
          }
          let desc = rest.filter(i => i.x > (tjx || style).x && i.x < pack.x && i !== tjx).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
          const c = /^(\d{1,3})\s+(.+)$/.exec(desc);
          if (c) desc = c[2];
          lines.push({ ln: lnItem.s, style: style.s.toUpperCase(), tjxStyle: tjx ? tjx.s : '', desc, pack: int(pack.s), total: int(total.s), units });
        }
      }
    }
    return finishDistro({ po, version, versionDate, dates, dept, dcs: [...dcs.values()], lines, fileName }, fail);
  }

  // A distribution sheet from TJX's portal, as Excel: one line per style under PG-LN / Vendor Style # / ... / Total
  // Units, with a column per DC headed "AZR DC#881 Units". The PO number and version are only in the file name
  // (MARSHALLS_DISTRIBUTION_INSTRUCTIONS_900101.xlsx), so a sheet whose name doesn't carry one is refused.
  function readDistroSheet(table, fileName) {
    const fail = (why, po) => ({ error: why, poNo: po || '', distroFile: true });
    const name = String(fileName || '');
    const nums = name.replace(/\.[^.]+$/, '').match(/(?:^|[^\d])(\d{6})(?=[^\d]|$)/g) || [];
    const po = nums.length ? nums[nums.length - 1].replace(/^\D/, '') : null;
    const cell = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const at = table.findIndex(r => (r || []).some(v => /^PG-LN$/i.test(cell(v))) && (r || []).some(v => /^Vendor Style/i.test(cell(v))));
    if (at < 0) return { notDistro: true };
    if (!po) return fail(`${name} looks like a distribution sheet, but its file name doesn't carry a 6-digit PO number.`);
    const head = table[at].map(cell);
    const find = re => head.findIndex(h => re.test(h));
    const col = { ln: find(/^PG-LN$/i), style: find(/^Vendor Style/i), tjx: find(/^TJX Style/i), desc: find(/^Description$/i),
                  pack: find(/^Vendor Pack/i), store: find(/^Store Ready/i), total: find(/^Total Units$/i) };
    if (col.style < 0 || col.pack < 0 || col.total < 0) return fail(`${name}'s headings aren't the ones this reader knows.`, po);
    const dcCols = head.map((h, i) => { const m = /^([A-Z]{3})\s*DC#\s*(\d+)\s*Units$/i.exec(h); return m ? { i, code: m[1].toUpperCase(), dc: m[2] } : null; }).filter(Boolean);
    if (!dcCols.length) return fail(`${name} has no DC columns ("AZR DC#881 Units").`, po);
    const lines = [];
    for (let r = at + 1; r < table.length; r++) {
      const row = (table[r] || []).map(cell);
      if (!row.some(Boolean)) continue;
      if (!/^\d+-\d+$/.test(row[col.ln] || '')) continue;
      const style = (row[col.style] || '').toUpperCase(), pack = int(row[col.pack]), total = int(row[col.total]);
      const gone = [!style && 'vendor style', pack == null && 'vendor pack', total == null && 'total units'].filter(Boolean);
      if (gone.length) return fail(`Row ${r + 1} (${row[col.ln]}) couldn't be read: no ${words(gone)}.`, po);
      // a DC with nothing (blank or 0) has no entry, as on the PDF, so the two copies of one distro read the same
      const units = {};
      for (const c of dcCols) { const u = int(row[c.i] || '0'); if (u == null) return fail(`Row ${r + 1}: the ${c.code} units aren't a number.`, po); if (u) units[c.dc] = u; }
      let desc = row[col.desc] || '';
      const c = /^(\d{1,3})\s+(.+)$/.exec(desc);
      if (c) desc = c[2];
      lines.push({ ln: row[col.ln], style, tjxStyle: col.tjx >= 0 ? row[col.tjx] : '', desc, pack, total, units });
    }
    const v = /_V(\d+)(?=[^\d]|$)/i.exec(name);
    return finishDistro({ po, version: v ? +v[1] : null, versionDate: '', dates: null, dept: '',
      dcs: dcCols.map(c => ({ dc: c.dc, prefix: '', code: c.code, name: '' })), lines, fileName: name, bannerHint: /MARSHALL/i.test(name) ? 'Marshalls' : /TJ ?MAXX/i.test(name) ? 'TJ Maxx' : null }, fail);
  }

  // Shared by both: every line's DC units add up to its total, or the file is refused (a misread, not something to save)
  function finishDistro(d, fail) {
    if (!d.po) return fail("The PO number couldn't be found on the distribution instructions.");
    if (!d.lines.length) return fail('No distribution lines were found.', d.po);
    if (d.lines.some(l => d.lines.filter(x => x.ln === l.ln).length > 1)) return fail('A line number appears twice.', d.po);
    for (const l of d.lines) {
      const sum = Object.values(l.units).reduce((t, u) => t + u, 0);
      if (sum !== l.total) return fail(`Line ${l.ln} (${l.style}): the DCs add up to ${fmt(sum)} units, but its total says ${fmt(l.total)}.`, d.po);
    }
    const banner = bannerOfPrefixes(d.dcs.map(x => x.prefix).filter(Boolean)) || d.bannerHint || null;
    return { distro: { po: d.po, version: d.version, versionDate: d.versionDate, banner, dept: d.dept,
      orderDate: d.dates ? d.dates.order : '', startShip: d.dates ? d.dates.start : '', cancel: d.dates ? d.dates.cancel : '',
      dcs: d.dcs.sort((a, b) => byNo(a.dc, b.dc)), lines: d.lines } };
  }

  /* ============================== customers ============================== */
  // The dropdown's list, in its order. A customer without a reader shows but can't be picked yet.
  // fobLA: the customer's POs should ship FOB Los Angeles; any other FOB point is flagged.
  const CUSTOMERS = [
    { key: 'marmaxx', name: 'Marmaxx', read: readMarmaxx, readDistro: readMarmaxxDistro, readDistroSheet, banners: ['Marshalls', 'TJ Maxx'], pairs: true, fobLA: true },
    { key: 'burlington', name: 'Burlington', read: null, soon: 'needs sample POs', banners: [], pairs: false },
  ];
  const customer = key => CUSTOMERS.find(c => c.key === key) || null;

  // A PDF is a PO or the customer's distribution instructions for one: { po }, { distro } or { error }.
  function read(key, pages, fileName) {
    const c = customer(key);
    if (!c || !c.read) return { error: 'There is no reader for ' + (c ? c.name : key) + ' yet.' };
    if (c.readDistro && isDistroPages(pages)) return c.readDistro(pages, fileName);
    return c.read(pages);
  }
  // A spreadsheet can only be a distribution sheet: { distro }, { error } or { notDistro } when it isn't one.
  function readSheet(key, table, fileName) {
    const c = customer(key);
    if (!c || !c.readDistroSheet) return { notDistro: true };
    return c.readDistroSheet(table, fileName);
  }

  const defaultName = (name, d) => name + ' buy ' + (d.getMonth() + 1) + '/' + d.getDate();

  /* ============================== checks before saving ============================== */
  // results: [{ file, po } | { file, distro } | { file, error, poNo }] from the readers. here: the PO numbers already in
  // this buy (when files are added to it). others: [{ name, pos: [PO numbers] }], every other buy. hasDistro: { PO: the
  // distro it already has }. Nothing is dropped silently: each file ends up accepted, refused with its reason, or named
  // in a note (the same PO dropped twice, an older distro version).
  function checkBatch(results, here, others, hasDistro) {
    const refused = [], notes = [], groups = new Map();
    for (const r of results) {
      if (r.error) { refused.push({ file: r.file, po: r.poNo || '', why: r.error }); continue; }
      if (r.distro) continue;
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

    // distribution instructions: each attaches to its PO, already in this buy or among the POs being saved with it. Of
    // several versions the newest is used; a distro the PO already has is replaced only by a newer version.
    const poHere = new Set((here || []).concat(accepted.map(p => p.po)));
    const dgroups = new Map();
    for (const r of results) if (r.distro) { const g = dgroups.get(r.distro.po) || []; g.push(r); dgroups.set(r.distro.po, g); }
    const vOf = d => d.version || 0, vName = d => vOf(d) ? 'version ' + vOf(d) : 'unnumbered';
    const distros = [];
    for (const [no, g] of dgroups) {
      g.sort((a, b) => vOf(b.distro) - vOf(a.distro));
      const topV = vOf(g[0].distro), tops = g.filter(r => vOf(r.distro) === topV), older = g.filter(r => vOf(r.distro) < topV);
      // copies at the newest version that say the same (the PDF and the Excel of one distro) are read once, keeping the
      // one that says the most; copies that disagree are all refused, and so are the older versions behind them
      if (tops.some(r => !sameDistro(r.distro, tops[0].distro))) {
        for (const r of tops) refused.push({ file: r.file, po: no, why: `Two different distros for PO ${no}${topV ? ', both version ' + topV : ''}, were dropped (${words(tops.map(x => x.file))}). Drop only the one you want.` });
        for (const r of older) refused.push({ file: r.file, po: no, why: `This ${vName(r.distro)} distro for PO ${no} isn't used: the newer versions dropped with it disagree.` });
        continue;
      }
      const top = tops.reduce((a, b) => richer(b.distro, a.distro) ? b : a);
      if (tops.length > 1) notes.push(`The distro for PO ${no} was dropped ${tops.length} times (${words(tops.map(x => x.file))}). It's read once, from ${top.file}.`);
      for (const r of older) notes.push(`${r.file} is ${vName(r.distro)} of PO ${no}'s distro; ${vName(top.distro)} (${top.file}) is the one used.`);
      if (!poHere.has(no)) {
        const other = (others || []).find(b => (b.pos || []).includes(no));
        refused.push({ file: top.file, po: no, why: `This is the distro for PO ${no}, which isn't ${(here || []).length ? 'in this buy' : 'among the POs dropped'}.` +
          (other ? ` PO ${no} is in “${other.name}”: add the distro there.` : ' Drop it together with its PO.') });
        continue;
      }
      // against the one the PO has: a newer version replaces it whatever it says; the same version only when it's the
      // same distro with the dates it lacked (the PDF after the Excel); anything else is refused, saying why
      const had = hasDistro && hasDistro[no];
      if (had) {
        const tv = vOf(top.distro), hv = vOf(had);
        if (tv < hv) { refused.push({ file: top.file, po: no, why: `PO ${no} already has version ${hv} of its distro; this is ${vName(top.distro)}.` }); continue; }
        if (tv === hv) {
          if (!sameDistro(had, top.distro))
            refused.push({ file: top.file, po: no, why: `PO ${no} already has a different distro${hv ? ' with the same version number (' + hv + ')' : ''}. A re-sent distro should carry a higher version.` });
          else if (richer(top.distro, had)) distros.push({ file: top.file, po: no, distro: top.distro, replaces: hv || 'unnumbered' });
          else notes.push(`PO ${no} already has this distro.`);
          continue;
        }
        distros.push({ file: top.file, po: no, distro: top.distro, replaces: hv || 'unnumbered' });
      } else distros.push({ file: top.file, po: no, distro: top.distro });
    }
    distros.sort((a, b) => byNo(a.po, b.po));
    refused.sort((a, b) => byNo(a.po, b.po) || String(a.file).localeCompare(String(b.file)));
    return { accepted, refused, notes, distros };
  }
  // what a distro's lines say, for telling two copies apart: every line's style, pack, total and DC units (a DC with 0
  // is the same as a blank one)
  const distroSig = d => d.lines.map(l => [l.style, l.pack, l.total, Object.keys(l.units).filter(k => l.units[k]).sort().map(k => k + ':' + l.units[k]).join(',')].join('|')).sort().join(';');
  // the same distro: the same lines, and the same dates and banner where both copies have them (the Excel has neither)
  const sameDistro = (a, b) => distroSig(a) === distroSig(b) &&
    (!a.startShip || !b.startShip || (a.startShip === b.startShip && a.cancel === b.cancel)) && (!a.banner || !b.banner || a.banner === b.banner);
  // a copy that says more: it has the ship dates the other lacks
  const richer = (a, b) => !!a.startShip && !b.startShip;

  /* ============================== distro checks ============================== */
  // A PO against its distro: the banner its DCs belong to, the ship dates, each style's units and pack, styles on one
  // and not the other, and whether each DC gets whole cartons. Each finding names the PO, and the style and DC when it
  // has one, so the page and the export can mark that cell.
  function distroIssues(p) {
    const d = p.distro;
    if (!d) return [];
    const out = [], say = (text, style, dc) => out.push({ kind: 'distro', po: p.po, style: style || null, dc: dc || null, text });
    if (d.banner && d.banner !== p.banner) say(`PO ${p.po} is ${p.banner}, but its distro ships to ${d.banner} DCs.`);
    if (d.startShip && (d.startShip !== p.startShip || d.cancel !== p.cancel))
      say(`PO ${p.po}'s distro says ship ${md(d.startShip)}–${md(d.cancel)}; the PO says ${md(p.startShip)}–${md(p.cancel)}.`);
    const poBy = new Map(), dBy = new Map();
    for (const l of p.lines) { const s = poBy.get(l.style) || { units: 0, packs: new Set() }; s.units += l.units; s.packs.add(l.pack); poBy.set(l.style, s); }
    for (const l of d.lines) {
      const s = dBy.get(l.style) || { total: 0, packs: new Set(), units: {} };
      s.total += l.total; s.packs.add(l.pack);
      for (const [dc, u] of Object.entries(l.units)) s.units[dc] = (s.units[dc] || 0) + u;
      dBy.set(l.style, s);
    }
    const code = dc => { const x = d.dcs.find(y => y.dc === dc); return x && x.code ? x.code + ' ' + dc : dc; };
    for (const style of [...new Set([...poBy.keys(), ...dBy.keys()])]) {
      const a = poBy.get(style), b = dBy.get(style);
      if (!b) { say(`${style} is on PO ${p.po} (${fmt(a.units)} units) but not on its distro.`, style); continue; }
      if (!a) say(`${style} is on PO ${p.po}'s distro (${fmt(b.total)} units) but not on the PO.`, style);
      else {
        if (a.units !== b.total) say(`${style}: PO ${p.po} has ${fmt(a.units)} units; its distro sends ${fmt(b.total)}.`, style);
        const pa = [...a.packs].join(' / '), pb = [...b.packs].join(' / ');
        if (pa !== pb) say(`${style}: pack ${pa} on PO ${p.po}, ${pb} on its distro.`, style);
      }
      // whole cartons to every DC, line by line with each line's own pack (two half cartons don't make a whole one), and
      // whether or not the PO has the style
      const lines = d.lines.filter(l => l.style === style);
      for (const l of lines) for (const [dc, u] of Object.entries(l.units))
        if (l.pack && u % l.pack) say(`${style}: ${fmt(u)} units to DC ${code(dc)}${lines.length > 1 ? ' on line ' + l.ln : ''} isn't whole cartons of ${l.pack}.`, style, dc);
    }
    return out;
  }

  /* ============================== Master Sheet Live: case packs ============================== */
  // Read only. Its "Master Sheet Live" tab runs in factory PO blocks: the Po Number, Factory and Order Date are on a
  // block's first row only, and the rows under it belong to that PO until the next one ("Round" rows end a block), as
  // the PO Book reads it. Each style row carries the carton pack in "Master". A style can have rows with different
  // packs; the latest row (newest order, else the lowest on the sheet) is the one a PO is checked against, and the others
  // show in the hover. table: the tab as rows of cells (SheetJS header: 1, raw).
  function parseMaster(table) {
    const cell = v => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const at = table.findIndex(r => r && r.some(v => cell(v) === 'Style Number') && r.some(v => cell(v) === 'Master'));
    if (at < 0) return null;
    const head = table[at].map(cell), col = n => head.indexOf(n);
    const c = { style: col('Style Number'), master: col('Master'), inner: col('Inner'), po: col('Po Number'), date: col('Order Date'),
                factory: col('Factory'), name: col('Product name') };
    const styles = new Map();
    let n = 0, block = null;
    for (let r = at + 1; r < table.length; r++) {
      const row = table[r] || [];
      if (c.name >= 0 && /^Round/i.test(cell(row[c.name]))) { block = null; continue; }
      const po = c.po >= 0 ? cell(row[c.po]) : '';
      if (po) block = { po, date: c.date >= 0 ? excelDate(row[c.date]) : '', factory: c.factory >= 0 ? cell(row[c.factory]) : '' };
      const style = cell(row[c.style]).toUpperCase();
      if (!style) continue;
      n++;
      const list = styles.get(style) || [];
      list.push({ row: r + 1, master: int(cell(row[c.master])), inner: c.inner >= 0 ? int(cell(row[c.inner])) : null,
                  po: block ? block.po : '', date: block ? block.date : '', factory: block ? block.factory : '' });
      styles.set(style, list);
    }
    return { styles, rows: n };
  }
  // an Excel date: a serial number (days since 12/30/1899, read in UTC so no time zone moves it), or m/d/yyyy text
  function excelDate(v) {
    if (typeof v === 'number' && v > 0) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    return iso(String(v == null ? '' : v).trim().split(' ')[0]) || '';
  }
  function masterPack(master, style) {
    const list = master && master.styles.get(String(style).toUpperCase());
    if (!list || !list.length) return null;
    const packed = list.filter(x => x.master != null);
    if (!packed.length) return { pack: null, rows: list.length };
    const latest = packed.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.row > a.row)) ? b : a);
    return { pack: latest.master, row: latest.row, po: latest.po, date: latest.date, factory: latest.factory,
             others: [...new Set(packed.map(x => x.master))].filter(v => v !== latest.master) };
  }
  const masterSays = m => 'Master Sheet Live says ' + m.pack + ' (row ' + m.row + (m.po ? ', PO ' + m.po : '') + (m.date ? ', ordered ' + mdy(m.date) : '') + ')' +
    (m.others.length ? '; other rows say ' + m.others.join(' / ') : '');
  // Each style's pack on the POs and distros against the master sheet's latest row
  function packIssues(pos, master) {
    if (!master) return [];
    const by = new Map();
    const add = (style, pack, where) => { const s = by.get(style) || new Map(); const l = s.get(pack) || []; if (!l.includes(where)) l.push(where); s.set(pack, l); by.set(style, s); };
    for (const p of pos) {
      for (const l of p.lines) add(l.style, l.pack, p.po);
      if (p.distro) for (const l of p.distro.lines) add(l.style, l.pack, p.po + ' distro');
    }
    const out = [];
    for (const [style, packs] of [...by].sort((a, b) => byNo(a[0], b[0]))) {
      const m = masterPack(master, style);
      if (!m) { out.push({ kind: 'pack', style, text: `${style} isn't on Master Sheet Live, so its case pack can't be checked.` }); continue; }
      if (m.pack == null) { out.push({ kind: 'pack', style, text: `${style} has no case pack (Master) on Master Sheet Live.` }); continue; }
      const off = [...packs].filter(([pack]) => pack !== m.pack);
      if (off.length) out.push({ kind: 'pack', style, master: m.pack,
        text: `${style}: case pack ${off.map(([pack, where]) => pack + ' on ' + where.sort(byNo).join(', ')).join('; ')}, but ${masterSays(m)}.` });
    }
    return out;
  }

  /* ============================== flags ============================== */
  // What needs a look on a saved buy. Worked out from its POs every time, never stored, so they can't go stale. The case
  // pack checks need Master Sheet Live, so they're there only when master is given.
  function flags(key, pos, master) {
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
        const k = descKey(u.l.desc);
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
    if (c.fobLA) {
      const off = new Map();
      for (const p of pos) if (!fobIsLA(p.fob)) { const k = fobLabel(p.fob); off.set(k, (off.get(k) || []).concat(p)); }
      for (const [label, g] of [...off].sort((a, b) => a[0].localeCompare(b[0])))
        out.push({ kind: 'fob', pos: g.map(p => p.po), text: `FOB point is ${label}, not LA, on ${g.length === pos.length && g.length > 2 ? 'every PO (' + g.length + ')' : g.length > 6 ? g.length + ' POs: ' + g.map(p => p.po).sort(byNo).join(', ') : nos(g)}.` });
    }
    for (const p of pos.slice().sort((a, b) => byNo(a.po, b.po))) out.push(...distroIssues(p));
    out.push(...packIssues(pos, master));
    return out;
  }

  /* ============================== the recap ============================== */
  // Each ship window's colour, in date order and round again after the sixth: [headings, cells]. The page and the
  // Excel sheet use the same ones, so a window looks the same on screen and on paper.
  const TONES = [['D9EAF7', 'EEF5FB'], ['E2EFDA', 'F3F8EF'], ['FCE4D6', 'FEF4EE'], ['E4DFEC', 'F3F0F7'], ['FFF2CC', 'FFFAE8'], ['DAEEF3', 'EEF7FA']];

  // A cell of a style whose cost or description varies, as the export writes it: the units, then this PO's cost and
  // description for what varies (1632-$3.00-2pk Lip Liners). A PO with the style on two lines at different costs or
  // descriptions gives each its own units (100-$3.00 + 50-$2.60).
  function cellText(row, po) {
    const c = row.cells[po];
    if (!c) return '';
    const say = p => {
      const bits = [p.units];
      if (row.varies.cost) bits.push(money(p.cost));
      if (row.varies.desc) bits.push(p.desc);
      return bits.join('-');
    };
    return c.parts.map(say).join(' + ');
  }
  // The hover on such a cell: this PO's cost and description (with the units at each, when it has more than one),
  // then what every other PO with the style says.
  function cellTip(row, po) {
    const c = row.cells[po];
    if (!c) return '';
    const lines = ['PO ' + po + ': ' + fmt(c.units) + ' units'];
    const others = Object.keys(row.cells).filter(x => x !== po).sort(byNo);
    const here = (field, show, join) => {
      const vals = [...new Set(c.parts.map(p => p[field]))];
      if (vals.length < 2) return show(vals[0]);
      return vals.map(v => fmt(c.parts.filter(p => p[field] === v).reduce((t, p) => t + p.units, 0)) + join + show(v)).join(', ');
    };
    const elsewhere = (pick, show) => {
      const g = new Map();
      for (const o of others) for (const v of pick(row.cells[o])) { if (!g.has(v)) g.set(v, []); g.get(v).push(o); }
      return [...g].map(([v, list]) => show(v) + ' on ' + list.join(', ')).join('; ');
    };
    const quote = d => '“' + d + '”';
    if (row.varies.cost) {
      lines.push('Cost here: ' + here('cost', money, ' at '));
      if (others.length) lines.push('Elsewhere: ' + elsewhere(x => x.costs, money));
    }
    if (row.varies.desc) {
      lines.push('Description here: ' + here('desc', quote, ' '));
      if (others.length) lines.push('Elsewhere: ' + elsewhere(x => x.descs, quote));
    }
    return lines.join('\n');
  }
  // The hover on the Cost or Description cell of such a row: each value and the POs that give it, in grid order, the
  // same order as the cell lists them.
  function variantsTip(row, field) {
    const g = new Map();
    for (const po of row.order) for (const v of row.cells[po][field === 'cost' ? 'costs' : 'descs']) { if (!g.has(v)) g.set(v, []); g.get(v).push(po); }
    return [...g].map(([v, list]) => (field === 'cost' ? money(v) : '“' + v + '”') + ' on ' + list.join(', ')).join('\n');
  }

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
    const tones = {};
    windows.forEach((w, i) => { w.tone = i % TONES.length; for (const b of w.banners) for (const p of b.pos) tones[p.po] = w.tone; });
    // Each style's cells keep what their own PO says (units, costs, descriptions, and the units at each cost and
    // description when one PO has the style on two lines), so a style whose cost or description isn't the same on every
    // PO can show each PO's own value. Nothing picks which one is right. The row's costs and descriptions are listed in
    // grid order (the order their POs appear), so the first cost and the first description come from the same PO.
    const byStyle = new Map();
    const addTo = (list, v) => { if (!list.includes(v)) list.push(v); };
    for (const p of pos) for (const l of p.lines) {
      let r = byStyle.get(l.style);
      if (!r) byStyle.set(l.style, r = { style: l.style, catg: l.catg, descs: new Map(), costs: [], packs: [], order: [], cells: {}, total: 0, ext: 0 });
      if (l.pack != null) addTo(r.packs, l.pack);
      const k = descKey(l.desc);
      if (!r.descs.has(k)) r.descs.set(k, l.desc);
      const desc = r.descs.get(k);
      addTo(r.costs, l.cost);
      let cell = r.cells[p.po];
      if (!cell) { cell = r.cells[p.po] = { units: 0, costs: [], descs: [], parts: [] }; r.order.push(p.po); }
      cell.units += l.units;
      addTo(cell.costs, l.cost);
      addTo(cell.descs, desc);
      const part = cell.parts.find(x => x.cost === l.cost && x.desc === desc);
      if (part) part.units += l.units; else cell.parts.push({ units: l.units, cost: l.cost, desc });
      r.total += l.units;
      r.ext += cents(l.units, l.cost);
    }
    const rows = [...byStyle.values()].map(r => {
      const descs = [...r.descs.values()], costs = r.costs;
      const units = {};
      for (const po of r.order) units[po] = r.cells[po].units;
      return { style: r.style, catg: r.catg, desc: descs.join(' / '), descs, costs, cost: costs.length === 1 ? costs[0] : null, packs: r.packs,
               varies: { cost: costs.length > 1, desc: descs.length > 1 }, cells: r.cells, order: r.order, units, total: r.total, ext: r.ext / 100 };
    }).sort((a, b) => byNo(a.catg, b.catg) || byNo(a.style, b.style));

    const poUnits = {}, poExt = {};
    for (const p of pos) {
      poUnits[p.po] = p.lines.reduce((t, l) => t + l.units, 0);
      poExt[p.po] = p.lines.reduce((t, l) => t + cents(l.units, l.cost), 0) / 100;
    }
    const sumOf = list => ({ pos: list.length, units: list.reduce((t, p) => t + poUnits[p.po], 0), ext: Math.round(list.reduce((t, p) => t + poExt[p.po] * 100, 0)) / 100 });
    const all = sumOf(pos);
    const byWindow = windows.map(w => Object.assign({ label: w.label, tone: w.tone }, sumOf(w.banners.flatMap(b => b.pos))));
    const banners = [...new Set(pos.map(p => p.banner))].sort((a, b) => bannerAt(a) - bannerAt(b) || a.localeCompare(b));
    const byBanner = banners.map(b => Object.assign({ banner: b }, sumOf(pos.filter(p => p.banner === b))));
    const uniq = f => [...new Set(pos.map(f).filter(Boolean))].sort();
    const orders = uniq(p => p.orderDate);
    return {
      windows, pos, rows, poUnits, poExt, byWindow, byBanner, tones,
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
    // Excel's own "light red fill with dark red text"
    flagged: { font: { color: { rgb: '9C0006' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FFC7CE' } }, alignment: { vertical: 'top', wrapText: true }, border: BOX },
  };

  function colName(c) { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

  // A sheet's cells, merges and extent, written through put() (blank cells keep their style, so borders and fills run on)
  function sheetWriter() {
    const ws = {}, merges = [];
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
    const finish = cols => { ws['!ref'] = 'A1:' + colName(maxC) + (maxR + 1); ws['!merges'] = merges; ws['!cols'] = cols; ws['!rows'] = [{ hpt: 24 }]; return ws; };
    return { ws, put, merge, finish };
  }

  // A style's pack on the POs, and whether it needs a look: packs that differ between POs, or (with Master Sheet Live
  // read) a pack the master sheet doesn't give. text is what the export cell says.
  function packCell(row, master) {
    const m = master ? masterPack(master, row.style) : null;
    const off = !!master && (!m || m.pack == null || row.packs.some(p => p !== m.pack));
    const bad = row.packs.length > 1 || off;
    let text = row.packs.join(' / ');
    if (master && !m) text += ' (not on master)';
    else if (master && m.pack == null) text += ' (no master pack)';
    else if (off) text += ' (master ' + m.pack + ')';
    return { bad, value: !bad && row.packs.length === 1 ? row.packs[0] : text, master: m };
  }

  // opts.packNote: whether the case packs were checked against Master Sheet Live (opts.packChecked), said on the sheet
  function worksheet(buy, fl, master, opts) {
    opts = opts || {};
    // a copy for each sheet: xlsx-js-style rewrites the style objects it writes (colours gain an FF alpha)
    const ST = JSON.parse(JSON.stringify(STYLES));
    const R = recap(buy), notes = buy.notes || {};
    fl = fl || flags(buy.customer, buy.pos, master);
    const { put, merge, finish } = sheetWriter();

    const cols = R.windows.flatMap(w => w.banners.flatMap(b => b.pos.map(p => p.po)));
    // a style in its ship window's colour: the stronger shade for headings, the lighter one for the cells below
    const tint = (s, tone, cells) => Object.assign({}, s, { fill: { patternType: 'solid', fgColor: { rgb: TONES[tone][cells ? 1 : 0] } } });
    const C = { check: 0, style: 1, desc: 2, cost: 3, pack: 4, po0: 5 };
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
    if (opts.packNote) facts.push(['Case packs', opts.packNote, opts.packChecked ? ST.value : ST.flagged]);
    let r = 2;
    for (const [k, v, s] of facts) { put(r, C.style, k, ST.label); put(r, C.desc, v, s || ST.value); r++; }
    r++;
    const mini = (title, list, name) => {
      put(r, C.style, title, ST.head); put(r, C.desc, 'POs', ST.head); put(r, C.cost, 'Units', ST.head); put(r, C.pack, 'Cost', ST.head); r++;
      for (const x of list) {
        put(r, C.style, x[name], x.tone != null ? tint(ST.text, x.tone) : ST.text);
        put(r, C.desc, x.pos, ST.units); put(r, C.cost, x.units, ST.units); put(r, C.pack, x.ext, ST.money); r++;
      }
      r++;
    };
    mini('Ship window', R.byWindow, 'label');
    mini('Banner', R.byBanner, 'banner');
    r++;

    // the recap: three heading rows (ship window, banner, PO #)
    const h0 = r;
    for (const [c, t] of [[C.check, 'Check'], [C.style, 'Style'], [C.desc, 'Description'], [C.cost, 'Cost'], [C.pack, 'Pack'], [C.total, 'Total units'], [C.ext, 'Ext cost'], [C.notes, 'Notes']]) {
      put(h0, c, t, ST.head); put(h0 + 1, c, '', ST.head); put(h0 + 2, c, '', ST.head); merge(h0, c, h0 + 2, c);
    }
    let c = C.po0;
    for (const w of R.windows) {
      const n = w.banners.reduce((t, b) => t + b.pos.length, 0);
      for (let i = 0; i < n; i++) put(h0, c + i, i ? '' : w.label, tint(ST.window, w.tone));
      merge(h0, c, h0, c + n - 1);
      for (const b of w.banners) {
        for (let i = 0; i < b.pos.length; i++) put(h0 + 1, c + i, i ? '' : b.banner, tint(ST.head, w.tone));
        merge(h0 + 1, c, h0 + 1, c + b.pos.length - 1);
        for (const p of b.pos) put(h0 + 2, c++, /^[1-9]\d{0,14}$/.test(p.po) ? Number(p.po) : p.po, tint(ST.head, w.tone));
      }
    }
    r = h0 + 3;
    for (const row of R.rows) {
      put(r, C.check, '☐', ST.check);
      put(r, C.style, row.style, ST.text);
      // a style whose cost or description isn't the same on every PO: its cells go red and read units-cost-description
      // for what varies (1632-$3.00-2pk Lip Liners Raise & Steady), so each PO's own value is on the sheet
      const odd = row.varies.cost || row.varies.desc;
      put(r, C.desc, row.desc, row.varies.desc ? ST.flagged : ST.wrap);
      put(r, C.cost, row.cost != null ? row.cost : row.costs.map(x => x.toFixed(2)).join(' / '), row.cost != null ? ST.money : ST.flagged);
      const pk = packCell(row, master);
      put(r, C.pack, pk.value, pk.bad ? ST.flagged : ST.units);
      cols.forEach((po, i) => {
        const cell = row.cells[po];
        if (!cell) put(r, C.po0 + i, '', tint(ST.units, R.tones[po], true));
        else if (odd) put(r, C.po0 + i, cellText(row, po), ST.flagged);
        else put(r, C.po0 + i, cell.units, tint(ST.units, R.tones[po], true));
      });
      put(r, C.total, row.total, ST.units);
      put(r, C.ext, row.ext, ST.money);
      put(r, C.notes, notes[row.style] || '', ST.wrap);
      r++;
    }
    put(r, C.check, '', ST.totalLabel); put(r, C.style, 'Total', ST.totalLabel); put(r, C.desc, '', ST.totalLabel); put(r, C.cost, '', ST.totalLabel); put(r, C.pack, '', ST.totalLabel);
    cols.forEach((po, i) => put(r, C.po0 + i, R.poUnits[po], tint(ST.totalUnits, R.tones[po])));
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

    return finish([{ wch: 7 }, { wch: 13 }, { wch: 34 }, { wch: 10 }, { wch: 9 }, ...cols.map(() => ({ wch: 10 })), { wch: 11 }, { wch: 13 }, { wch: 30 }]);
  }

  // The Distro sheet: for each PO with distribution instructions, in grid order, its styles by DC, with what doesn't
  // match the PO (or Master Sheet Live, or whole cartons) red and saying why; then the POs still without one. Null when
  // no PO in the buy has a distro.
  function distroSheet(buy, master) {
    const R = recap(buy), withD = R.pos.filter(p => p.distro);
    if (!withD.length) return null;
    const ST = JSON.parse(JSON.stringify(STYLES));
    const { put, merge, finish } = sheetWriter();
    const width = Math.max(...withD.map(p => p.distro.dcs.length));
    const C = { check: 0, style: 1, desc: 2, pack: 3, po: 4, total: 5, dc0: 6 };
    C.notes = C.dc0 + width;
    put(0, C.style, buy.name + ' · Distro', ST.title);
    for (let c = C.style + 1; c <= C.notes; c++) put(0, c, '', ST.title);
    merge(0, C.style, 0, C.notes);
    const missing = R.pos.filter(p => !p.distro).map(p => p.po);
    put(2, C.style, 'Distros in', ST.label); put(2, C.desc, withD.length + ' of ' + R.pos.length + ' POs', ST.value);
    put(3, C.style, 'No distro yet', ST.label); put(3, C.desc, missing.length ? missing.join(', ') : 'none', missing.length ? ST.flagged : ST.value);
    let r = 6;
    for (const p of withD) {
      const d = p.distro, issues = distroIssues(p);
      const at = (style, dc) => issues.filter(i => i.style === style && (dc === undefined || i.dc === dc));
      put(r, C.style, `PO ${p.po} · ${p.banner} · ship ${md(p.startShip)}–${md(p.cancel)} · distro${d.version ? ' v' + d.version : ''}${d.versionDate ? ', ' + mdy(d.versionDate) : ''}`, ST.section); r++;
      for (const i of issues.filter(x => !x.style)) { put(r, C.style, i.text, ST.flagged); for (let c = C.style + 1; c <= C.notes; c++) put(r, c, '', ST.flagged); merge(r, C.style, r, C.notes); r++; }
      const heads = [[C.check, 'Check'], [C.style, 'Style'], [C.desc, 'Description'], [C.pack, 'Pack'], [C.po, 'PO units'], [C.total, 'Distro units']]
        .concat(d.dcs.map((x, i) => [C.dc0 + i, (x.code ? x.code + ' ' : '') + x.dc])).concat([[C.notes, 'Notes']]);
      for (let c = C.check; c <= C.notes; c++) put(r, c, '', ST.head);
      for (const [c, t] of heads) put(r, c, t, ST.head);
      r++;
      const poBy = new Map(), dBy = new Map();
      for (const l of p.lines) { const s = poBy.get(l.style) || { units: 0, desc: l.desc, pack: l.pack }; s.units += l.units; poBy.set(l.style, s); }
      for (const l of d.lines) {
        const s = dBy.get(l.style) || { total: 0, desc: l.desc, pack: l.pack, units: {} };
        s.total += l.total; for (const [dc, u] of Object.entries(l.units)) s.units[dc] = (s.units[dc] || 0) + u; dBy.set(l.style, s);
      }
      const sums = { po: 0, total: 0, dc: {} };
      for (const style of [...new Set([...poBy.keys(), ...dBy.keys()])]) {
        const a = poBy.get(style), b = dBy.get(style), mine = at(style);
        put(r, C.check, '☐', ST.check);
        put(r, C.style, style, mine.length ? ST.flagged : ST.text);
        put(r, C.desc, (a || b).desc, ST.wrap);
        const pack = b ? b.pack : a.pack, m = master ? masterPack(master, style) : null;
        const packNote = a && b && a.pack !== b.pack ? ' (PO ' + a.pack + ')' : m && m.pack != null && m.pack !== pack ? ' (master ' + m.pack + ')' : '';
        put(r, C.pack, packNote ? pack + packNote : pack, packNote ? ST.flagged : ST.units);
        put(r, C.po, a ? a.units : 'not on PO', a ? ST.units : ST.flagged);
        if (!b) put(r, C.total, 'not on distro', ST.flagged);
        else if (a && a.units !== b.total) put(r, C.total, b.total + ' (PO ' + a.units + ')', ST.flagged);
        else put(r, C.total, b.total, ST.units);
        d.dcs.forEach((x, i) => {
          const u = b ? b.units[x.dc] : undefined;
          if (u === undefined) { put(r, C.dc0 + i, '', ST.units); return; }
          sums.dc[x.dc] = (sums.dc[x.dc] || 0) + u;
          put(r, C.dc0 + i, at(style, x.dc).length ? u + ' (not ×' + b.pack + ')' : u, at(style, x.dc).length ? ST.flagged : ST.units);
        });
        put(r, C.notes, '', ST.wrap);
        if (a) sums.po += a.units;
        if (b) sums.total += b.total;
        r++;
      }
      for (let c = C.check; c <= C.notes; c++) put(r, c, '', ST.totalLabel);
      put(r, C.style, 'Total', ST.totalLabel); put(r, C.po, sums.po, ST.totalUnits); put(r, C.total, sums.total, ST.totalUnits);
      d.dcs.forEach((x, i) => put(r, C.dc0 + i, sums.dc[x.dc] || 0, ST.totalUnits));
      r += 3;
    }
    return finish([{ wch: 7 }, { wch: 13 }, { wch: 30 }, { wch: 9 }, { wch: 10 }, { wch: 13 }, ...Array.from({ length: width }, () => ({ wch: 10 })), { wch: 30 }]);
  }

  // Excel sheet names: 31 characters, none of : \ / ? * [ ]. A suffix (" distro") is kept whole; the name gives way.
  function sheetName(name, used, suffix) {
    suffix = suffix || '';
    const base = (String(name).replace(/[:\\/?*[\]]/g, '-').trim() || 'Buy').slice(0, 31 - suffix.length).trim() + suffix;
    let s = base, n = 2;
    while (used && used.has(s.toLowerCase())) { const tail = ' (' + n++ + ')'; s = base.slice(0, 31 - tail.length) + tail; }
    if (used) used.add(s.toLowerCase());
    return s;
  }

  return { CUSTOMERS, TONES, customer, read, readSheet, readMarmaxx, readMarmaxxDistro, readDistroSheet, isDistroPages, rows, checkBatch,
           flags, distroIssues, parseMaster, masterPack, masterSays, packIssues, packCell, excelDate, fobLabel, fobIsLA, distroSig,
           recap, cellText, cellTip, variantsTip, worksheet, distroSheet, sheetName, defaultName,
           int, num, iso, md, mdy, fmt, money, words, colName };
});
