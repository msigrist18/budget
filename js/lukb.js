// Liest einen LUKB-Kontoauszug (PDF-Export aus dem E-Banking).
// Bekommt die Textstücke mit Position (von pdf.js) und baut daraus Buchungen.
// Spalten: Buchung | Valuta | Buchungstext | Belastung | Gutschrift | Saldo (CHF)

import { cleanMerchant } from './merchants.js';

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/;
const AMT_RE = /^-?\d{1,3}(?:['’`´]\d{3})*\.\d{2}$|^-?\d+\.\d{2}$/;

export function parseSwissAmount(s) {
  return Math.round(parseFloat(String(s).replace(/['’`´\s]/g, '')) * 100) / 100;
}

export function parseSwissDate(s) {
  const m = DATE_RE.exec(String(s).trim());
  if (!m) return null;
  let y = m[3];
  if (y.length === 2) y = '20' + y;
  return `${y}-${m[2]}-${m[1]}`;
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// Textstücke einer Seite zu Zeilen gruppieren und benachbarte Stücke zusammenfügen
function toLines(items) {
  const its = items
    .filter((it) => it.str && it.str.trim() !== '')
    .map((it) => ({ str: it.str, x: it.x, y: it.y, w: it.w || 0, h: it.h || 8 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const tol = Math.max(1.5, it.h * 0.35);
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    // Stücke ohne Abstand zu Wörtern zusammenfügen
    const toks = [];
    for (const it of l.items) {
      const prev = toks[toks.length - 1];
      const gap = prev ? it.x - (prev.x + prev.w) : 99;
      if (prev && gap < Math.max(0.6, it.h * 0.12)) {
        prev.str += it.str;
        prev.w = it.x + it.w - prev.x;
      } else if (prev && gap < it.h * 0.45 && !AMT_RE.test(it.str.trim()) && !AMT_RE.test(prev.str.trim()) && !DATE_RE.test(it.str.trim())) {
        prev.str += ' ' + it.str;
        prev.w = it.x + it.w - prev.x;
      } else {
        toks.push({ ...it });
      }
    }
    for (const t of toks) t.str = t.str.replace(/\s+/g, ' ').trim();
    l.toks = toks.filter((t) => t.str !== '');
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

function findHeader(lines) {
  for (const l of lines) {
    const find = (re) => l.toks.find((t) => re.test(t.str));
    const tBuchung = find(/^Buchung$/i) || find(/^Buchung\b(?!stext)/i);
    const tValuta = find(/^Valuta/i);
    const tText = find(/^Buchungstext/i) || find(/^Text$/i);
    const tBel = find(/^Belastung/i);
    const tGut = find(/^Gutschrift/i);
    const tSaldo = find(/^Saldo/i);
    if (tValuta && (tBel || tGut)) {
      const right = (t) => (t ? t.x + t.w : null);
      // "Saldo (CHF)" kann aus zwei Stücken bestehen
      let saldoR = right(tSaldo);
      if (tSaldo) {
        const after = l.toks.filter((t) => t.x > tSaldo.x).sort((a, b) => a.x - b.x)[0];
        if (after && /^\(?CHF\)?$/i.test(after.str)) saldoR = right(after);
      }
      return {
        y: l.y,
        buchungX: tBuchung ? tBuchung.x : 0,
        valutaX: tValuta.x,
        textX: tText ? tText.x : tValuta.x + tValuta.w + 10,
        amountCols: [
          tBel && { key: 'debit', r: right(tBel) },
          tGut && { key: 'credit', r: right(tGut) },
          tSaldo && { key: 'saldo', r: saldoR },
        ].filter(Boolean),
      };
    }
  }
  return null;
}

function classify(line, cols) {
  const out = { dates: [], text: [], amounts: {}, hasAmounts: false };
  const amtTol = 18;
  for (const t of line.toks) {
    const s = t.str;
    if (DATE_RE.test(s) && t.x < cols.textX - 1) {
      out.dates.push({ s, col: t.x < cols.valutaX - 2 ? 'buchung' : 'valuta' });
      continue;
    }
    const compact = s.replace(/\s/g, '');
    if (AMT_RE.test(compact) && t.x + t.w > cols.textX + 40) {
      const r = t.x + t.w;
      let best = null, bestD = Infinity;
      for (const c of cols.amountCols) {
        const d = Math.abs(c.r - r);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best && bestD <= amtTol) {
        out.amounts[best.key] = parseSwissAmount(compact);
        out.hasAmounts = true;
        continue;
      }
    }
    if (t.x >= cols.textX - 3) out.text.push(s);
  }
  out.textLine = out.text.join(' ').trim();
  return out;
}

function finishTx(cur, seen) {
  const lines = cur.text.filter(Boolean);
  const first = lines[0] || '';
  const m = /^(.*?)\s*\/\s*(\d{5,})\s*$/.exec(first);
  const type = m ? m[1].trim() : first;
  const ref = m ? m[2] : null;
  const rest = lines.slice(1);
  const bezug = rest.find((l) => /^Bezugsort:/i.test(l));
  let merchant = bezug ? bezug.replace(/^Bezugsort:\s*/i, '') : (rest[0] || type);
  merchant = cleanMerchant(merchant);
  const amount = cur.credit != null ? cur.credit : (cur.debit != null ? -cur.debit : 0);
  const booking = parseSwissDate(cur.booking);
  const valuta = parseSwissDate(cur.valuta || cur.booking);
  let key = ref ? `lukb:${ref}` : `lukb:${booking}|${valuta}|${amount}|${lines.join(' ')}`;
  const n = (seen.get(key) || 0) + 1;
  seen.set(key, n);
  if (n > 1) key += `#${n}`;
  return {
    bookDate: booking,
    date: valuta || booking,
    amount,
    saldo: cur.saldo != null ? cur.saldo : null,
    type,
    ref,
    merchant,
    text: lines.join(' · '),
    lines,
    importKey: key,
    page: cur.page,
  };
}

// pages: [{ items: [{ str, x, y, w, h }] }]
export function parseLukb(pages) {
  const txs = [];
  const diag = [];
  const seen = new Map();
  let cols = null;
  let headerFound = false;
  const allH = [];
  for (const p of pages) for (const it of p.items) if (it.str && it.str.trim()) allH.push(it.h || 8);
  const lineH = median(allH) || 8;
  const maxGap = lineH * 2.4;

  pages.forEach((page, pi) => {
    const lines = toLines(page.items);
    const hdr = findHeader(lines);
    if (hdr) { cols = hdr; headerFound = true; }
    if (!cols) {
      for (const l of lines) diag.push(`S${pi + 1}: ${l.toks.map((t) => t.str).join(' | ')}`);
      return;
    }
    let cur = null;
    const push = () => { if (cur) txs.push(finishTx(cur, seen)); cur = null; };
    for (const l of lines) {
      diag.push(`S${pi + 1}: ${l.toks.map((t) => t.str).join(' | ')}`);
      if (hdr && l.y >= hdr.y - 1) continue; // Kopfbereich der Seite
      const c = classify(l, cols);
      const buchung = c.dates.find((d) => d.col === 'buchung') || c.dates[0];
      if (buchung && (c.hasAmounts || c.textLine)) {
        push();
        const valuta = c.dates.find((d) => d !== buchung);
        cur = {
          booking: buchung.s,
          valuta: valuta ? valuta.s : buchung.s,
          text: c.textLine ? [c.textLine] : [],
          debit: c.amounts.debit ?? null,
          credit: c.amounts.credit ?? null,
          saldo: c.amounts.saldo ?? null,
          lastY: l.y,
          page: pi + 1,
        };
        continue;
      }
      if (cur && !c.dates.length && !c.hasAmounts && c.textLine && cur.lastY - l.y <= maxGap) {
        cur.text.push(c.textLine);
        cur.lastY = l.y;
        continue;
      }
      if (cur && c.hasAmounts && !c.dates.length && cur.debit == null && cur.credit == null && cur.lastY - l.y <= maxGap) {
        // Betrag steht eine Zeile tiefer als das Datum
        cur.debit = c.amounts.debit ?? cur.debit;
        cur.credit = c.amounts.credit ?? cur.credit;
        cur.saldo = c.amounts.saldo ?? cur.saldo;
        if (c.textLine) cur.text.push(c.textLine);
        cur.lastY = l.y;
        continue;
      }
      // Summenzeile, Fusszeile oder Sonstiges: aktuelle Buchung abschliessen
      push();
    }
    push();
  });

  const valid = txs.filter((t) => t.bookDate && (t.amount !== 0));
  return { txs: valid, headerFound, check: checkSaldo(valid), diagnostics: diag };
}

// Prüft mit der Saldo-Spalte, ob die Beträge stimmen
export function checkSaldo(txs) {
  const tryOrder = (newestFirst) => {
    let checked = 0, ok = 0;
    for (let i = 0; i + 1 < txs.length; i++) {
      const a = txs[i], b = txs[i + 1];
      if (a.saldo == null || b.saldo == null) continue;
      checked++;
      const diff = newestFirst ? a.saldo - b.saldo : b.saldo - a.saldo;
      const amt = newestFirst ? a.amount : b.amount;
      if (Math.abs(diff - amt) < 0.005) ok++;
    }
    return { checked, ok };
  };
  const nf = tryOrder(true), of = tryOrder(false);
  const best = nf.ok >= of.ok ? { ...nf, order: 'neueste zuerst' } : { ...of, order: 'älteste zuerst' };
  return { checked: best.checked, ok: best.ok, mismatches: best.checked - best.ok, order: best.order };
}
