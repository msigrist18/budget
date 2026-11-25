// Budget-Logik: Budgetmonate (Zahltag bis Zahltag), Plan, Übertrag, Plan vs. Ist.
// Reine Funktionen ohne DOM, damit sie auch in Node getestet werden können.

import { round2, pad2 } from './format.js';

export const GROUPS = [
  { id: 'einnahmen', name: 'Einnahmen', income: true },
  { id: 'sparen', name: 'Sparen & Investieren' },
  { id: 'fixkosten', name: 'Fixkosten' },
  { id: 'alltag', name: 'Alltag' },
  { id: 'einmalig', name: 'Einmalig' },
  { id: 'schulden', name: 'Schulden' },
];
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));

export const RHYTHMS = [
  { every: 0, label: 'einmalig' },
  { every: 1, label: 'monatlich' },
  { every: 3, label: 'alle 3 Monate' },
  { every: 6, label: 'alle 6 Monate' },
  { every: 12, label: 'jährlich' },
];

export const DEFAULT_SETTINGS = {
  payday: 25, // Budgetmonat beginnt am 25.
  earlyFrom: 20, // Lohn/Miete zählen ab dem 20. schon zum nächsten Monat
  startMonth: null, // erster Budgetmonat, z.B. "2026-12"
  startCarry: 0, // Übertrag in den ersten Monat
  foodCategoryId: null, // Kategorie für die Lebensmittel-Auswertung
};

// ---------- Monats-Helfer ("YYYY-MM") ----------

export function ymAdd(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}

export function ymDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}

export function ymOf(iso) {
  return iso.slice(0, 7);
}

function isoFromParts(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Zu welchem Budgetmonat gehört ein Datum?
// Ab dem Zahltag (z.B. 25.) gehört es zum nächsten Monat.
// earlyFrom: für Lohn/Miete schon ab diesem Tag (falls der 25. auf ein Wochenende fällt).
export function budgetMonthOf(iso, payday = 25, earlyFrom = null) {
  const key = ymOf(iso);
  if (!payday || payday <= 1) return key;
  const day = Number(iso.slice(8, 10));
  const limit = earlyFrom && earlyFrom < payday ? earlyFrom : payday;
  return day >= limit ? ymAdd(key, 1) : key;
}

// Zeitraum eines Budgetmonats: "2027-01" -> 25.12.2026 bis 24.01.2027
export function monthRange(key, payday = 25) {
  const [y, m] = key.split('-').map(Number);
  if (!payday || payday <= 1) {
    return { start: isoFromParts(y, m, 1), end: isoFromParts(y, m + 1, 0) };
  }
  return { start: isoFromParts(y, m - 1, payday), end: isoFromParts(y, m, payday - 1) };
}

// ---------- Plan ----------

export function planAmount(entry, key) {
  if (!entry || !entry.start) return 0;
  if (ymDiff(entry.start, key) < 0) return 0;
  if (entry.end && ymDiff(key, entry.end) < 0) return 0;
  const every = Number(entry.every) || 0;
  if (every === 0) return entry.start === key ? Number(entry.amount) || 0 : 0;
  return ymDiff(entry.start, key) % every === 0 ? Number(entry.amount) || 0 : 0;
}

export function planForCategory(plan, categoryId, key) {
  let s = 0;
  for (const e of plan) if (e.categoryId === categoryId) s += planAmount(e, key);
  return round2(s);
}

// ---------- Buchungen ----------

export function txMonth(tx, settings, catById) {
  if (tx.month) return tx.month;
  const cat = tx.categoryId ? catById[tx.categoryId] : null;
  const iso = tx.bookDate || tx.date;
  return budgetMonthOf(iso, settings.payday, cat && cat.early ? settings.earlyFrom : null);
}

export function invoiceMonth(inv, settings) {
  if (inv.month) return inv.month;
  return budgetMonthOf(inv.due || inv.created, settings.payday, null);
}

export function sortedCategories(categories, groupId) {
  return categories
    .filter((c) => !groupId || c.group === groupId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'de'));
}

// Indexe einmal berechnen, damit die Monatsübersicht schnell bleibt
export function buildIndex(data) {
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const catById = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const txByMonth = new Map();
  for (const tx of data.txs) {
    const k = txMonth(tx, settings, catById);
    if (!txByMonth.has(k)) txByMonth.set(k, []);
    txByMonth.get(k).push(tx);
  }
  const invByMonth = new Map();
  for (const inv of data.invoices || []) {
    if (inv.status !== 'offen') continue;
    const k = invoiceMonth(inv, settings);
    if (!invByMonth.has(k)) invByMonth.set(k, []);
    invByMonth.get(k).push(inv);
  }
  return { settings, catById, txByMonth, invByMonth };
}

export function monthStatus(key, settings, today) {
  const r = monthRange(key, settings.payday);
  if (r.end < today) return 'vorbei';
  if (r.start > today) return 'zukunft';
  return 'laufend';
}

// Übersicht eines Monats.
// result: Was am Ende übrig bleibt und in den nächsten Monat geht.
//  - vorbei + importiert: echte Zahlen (Ist)
//  - sonst: Prognose (Plan, aber wo schon mehr ausgegeben wurde, zählt das Ist)
export function summarizeMonth(key, data, idx, carryIn, today) {
  const { settings, txByMonth, invByMonth } = idx;
  const txs = txByMonth.get(key) || [];
  const invs = invByMonth.get(key) || [];
  const status = monthStatus(key, settings, today);
  const hasData = txs.length > 0;

  const actualByCat = new Map();
  const unc = { count: 0, inSum: 0, outSum: 0, items: [] };
  for (const tx of txs) {
    const cat = tx.categoryId ? idx.catById[tx.categoryId] : null;
    if (!cat) {
      unc.count++;
      unc.items.push(tx);
      if (tx.amount > 0) unc.inSum += tx.amount; else unc.outSum += -tx.amount;
      continue;
    }
    const g = GROUP_BY_ID[cat.group];
    const v = g && g.income ? tx.amount : -tx.amount;
    actualByCat.set(cat.id, (actualByCat.get(cat.id) || 0) + v);
  }
  let openInvoices = 0;
  for (const inv of invs) {
    openInvoices += inv.amount;
    if (inv.categoryId && idx.catById[inv.categoryId]) {
      actualByCat.set(inv.categoryId, (actualByCat.get(inv.categoryId) || 0) + inv.amount);
    } else {
      unc.outSum += inv.amount;
    }
  }

  const groups = [];
  let planIn = 0, planOut = 0, actIn = 0, actOut = 0, fcIn = 0, fcOut = 0;
  for (const g of GROUPS) {
    const cats = [];
    let gp = 0, ga = 0, gf = 0;
    for (const c of sortedCategories(data.categories, g.id)) {
      const plan = planForCategory(data.plan, c.id, key);
      const actual = round2(actualByCat.get(c.id) || 0);
      let forecast;
      if (g.income) forecast = actual !== 0 ? actual : plan;
      else forecast = Math.max(plan, actual);
      if (plan === 0 && actual === 0) continue;
      cats.push({ id: c.id, name: c.name, plan, actual, forecast, over: !g.income && actual > plan + 0.004 });
      gp += plan; ga += actual; gf += forecast;
    }
    groups.push({ id: g.id, name: g.name, income: !!g.income, plan: round2(gp), actual: round2(ga), forecast: round2(gf), cats });
    if (g.income) { planIn += gp; actIn += ga; fcIn += gf; } else { planOut += gp; actOut += ga; fcOut += gf; }
  }
  actIn += unc.inSum; actOut += unc.outSum;
  fcIn += unc.inSum; fcOut += unc.outSum;

  const planResult = round2(carryIn + planIn - planOut);
  const actualResult = round2(carryIn + actIn - actOut);
  const forecastResult = round2(carryIn + fcIn - fcOut);
  let result, resultKind;
  if (status === 'vorbei' && hasData) { result = actualResult; resultKind = 'ist'; }
  else if (!hasData && invs.length === 0) { result = planResult; resultKind = 'plan'; }
  else { result = forecastResult; resultKind = 'prognose'; }

  return {
    key,
    range: monthRange(key, settings.payday),
    status,
    hasData,
    txCount: txs.length,
    carryIn: round2(carryIn),
    groups,
    uncategorized: { count: unc.count, inSum: round2(unc.inSum), outSum: round2(unc.outSum) },
    openInvoices: round2(openInvoices),
    planIn: round2(planIn), planOut: round2(planOut),
    actIn: round2(actIn), actOut: round2(actOut),
    fcIn: round2(fcIn), fcOut: round2(fcOut),
    planResult, actualResult, forecastResult,
    result, resultKind,
    noImport: status === 'vorbei' && !hasData,
  };
}

// Übersichten vom Startmonat bis "toKey" mit durchgehendem Übertrag.
export function summarizeUntil(toKey, data, today) {
  const idx = buildIndex(data);
  const s = idx.settings;
  const start = s.startMonth || toKey;
  const out = new Map();
  if (ymDiff(start, toKey) < 0) {
    // Monat vor dem Start: ohne Übertrag
    out.set(toKey, summarizeMonth(toKey, data, idx, 0, today));
    return out;
  }
  let carry = Number(s.startCarry) || 0;
  for (let k = start; ymDiff(k, toKey) >= 0; k = ymAdd(k, 1)) {
    const sm = summarizeMonth(k, data, idx, carry, today);
    out.set(k, sm);
    carry = sm.result;
  }
  return out;
}

// ---------- Lebensmittel-Auswertung ----------

export function foodStats(data, today, brandOf) {
  const idx = buildIndex(data);
  const catId = idx.settings.foodCategoryId;
  if (!catId) return null;
  const months = new Map();
  for (const [key, txs] of idx.txByMonth) {
    for (const tx of txs) {
      if (tx.categoryId !== catId) continue;
      if (!months.has(key)) months.set(key, { key, total: 0, byBrand: new Map(), count: 0 });
      const m = months.get(key);
      const v = -tx.amount;
      m.total += v;
      m.count++;
      const b = brandOf(tx);
      m.byBrand.set(b, (m.byBrand.get(b) || 0) + v);
    }
  }
  const list = [...months.values()].sort((a, b) => ymDiff(b.key, a.key));
  // Durchschnitt nur über abgeschlossene Monate mit importierten Daten
  const closed = list.filter((m) => monthStatus(m.key, idx.settings, today) === 'vorbei');
  const base = closed.length ? closed : list;
  const avg = base.length ? round2(base.reduce((s, m) => s + m.total, 0) / base.length) : 0;
  const brandTotals = new Map();
  for (const m of base) for (const [b, v] of m.byBrand) brandTotals.set(b, (brandTotals.get(b) || 0) + v);
  const brands = [...brandTotals.entries()]
    .map(([brand, total]) => ({ brand, total: round2(total), avg: round2(total / (base.length || 1)) }))
    .sort((a, b) => b.total - a.total);
  return {
    categoryId: catId,
    months: list.map((m) => ({ key: m.key, total: round2(m.total), count: m.count, closed: monthStatus(m.key, idx.settings, today) === 'vorbei' })),
    avg,
    avgBasis: base.length,
    avgFromClosed: closed.length > 0,
    brands,
  };
}
