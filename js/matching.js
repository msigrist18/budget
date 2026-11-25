// Import vorbereiten: Doppelte erkennen, Kategorien vorschlagen,
// Handeinträge und offene Rechnungen abgleichen. Reine Funktionen.

import { suggestCategory } from './merchants.js';
import { daysBetween, round2 } from './format.js';

export function prepareImport(parsedTxs, data, settings) {
  const catById = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const existingKeys = new Set(data.txs.filter((t) => t.importKey).map((t) => t.importKey));

  const fresh = [];
  let duplicates = 0;
  for (const p of parsedTxs) {
    if (existingKeys.has(p.importKey)) { duplicates++; continue; }
    const sug = suggestCategory(p, data.rules, settings, catById);
    // TWINT von/an Personen nicht automatisch merken (z.B. Rückzahlungen von Freunden)
    fresh.push({ ...p, categoryId: sug.categoryId, suggestSource: sug.source, learn: !/twint/i.test(p.type || '') });
  }

  // Handeinträge (z.B. vorab erfasst) mit gleicher Summe und ähnlichem Datum
  const manual = data.txs.filter((t) => t.source === 'manuell' && !t.matchedKey);
  const usedManual = new Set();
  for (const f of fresh) {
    let best = null, bestD = 99;
    for (const m of manual) {
      if (usedManual.has(m.id)) continue;
      if (Math.abs(round2(m.amount) - round2(f.amount)) > 0.004) continue;
      const d = Math.abs(daysBetween(m.date, f.date));
      if (d <= 3 && d < bestD) { best = m; bestD = d; }
    }
    if (best) {
      usedManual.add(best.id);
      f.matchManualId = best.id;
      if (best.categoryId) { f.categoryId = best.categoryId; f.suggestSource = 'handeintrag'; }
    }
  }

  // Offene Rechnungen: Zahlung mit gleichem Betrag nach dem Erfassen der Rechnung
  const open = (data.invoices || []).filter((i) => i.status === 'offen')
    .sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const usedInv = new Set();
  for (const f of fresh) {
    if (f.amount >= 0 || f.matchManualId) continue;
    const inv = open.find((i) => !usedInv.has(i.id)
      && Math.abs(round2(i.amount) - round2(-f.amount)) < 0.005
      && daysBetween((i.created || i.due).slice(0, 10), f.date) >= -2);
    if (inv) {
      usedInv.add(inv.id);
      f.matchInvoiceId = inv.id;
      if (inv.categoryId) { f.categoryId = inv.categoryId; f.suggestSource = 'rechnung'; }
    }
  }

  return {
    fresh,
    duplicates,
    matchedManual: fresh.filter((f) => f.matchManualId).length,
    matchedInvoices: fresh.filter((f) => f.matchInvoiceId).length,
    uncategorized: fresh.filter((f) => !f.categoryId).length,
  };
}
