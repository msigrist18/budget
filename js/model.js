// Budget-Logik: Budgetmonate (Zahltag bis Zahltag), Plan, Übertrag, Plan vs. Ist,
// Unterkategorien, Zusammenführen, Heute-Übersicht und Import-Erinnerung.
// Reine Funktionen ohne DOM, damit sie auch in Node getestet werden können.

import { round2, pad2, daysBetween } from './format.js';

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
  midImportAfterDays: 14, // Zwischenstand: Erinnerung nach so vielen Tagen
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

// ---------- Kategorien (mit Unterkategorien) ----------

// Unterkategorie = hat parentId, und die Hauptkategorie existiert noch
export function parentOf(cat, catById) {
  return cat && cat.parentId && catById[cat.parentId] && cat.parentId !== cat.id ? catById[cat.parentId] : null;
}

export function effectiveGroup(cat, catById) {
  const p = parentOf(cat, catById);
  return p ? p.group : cat.group;
}

export function sortedCategories(categories, groupId) {
  return categories
    .filter((c) => !groupId || c.group === groupId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'de'));
}

export function topCategories(categories, groupId) {
  const byId = Object.fromEntries(categories.map((c) => [c.id, c]));
  return sortedCategories(categories.filter((c) => !parentOf(c, byId)), groupId);
}

export function childCategories(categories, parentId) {
  return sortedCategories(categories.filter((c) => c.parentId === parentId && c.id !== parentId));
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

// Hauptkategorie inkl. Unterkategorien
export function planForTree(plan, categories, categoryId, key) {
  let s = planForCategory(plan, categoryId, key);
  for (const c of childCategories(categories, categoryId)) s += planForCategory(plan, c.id, key);
  return round2(s);
}

// ---------- Buchungen ----------

export function txMonth(tx, settings, catById) {
  if (tx.month) return tx.month;
  const cat = tx.categoryId ? catById[tx.categoryId] : null;
  const parent = cat ? parentOf(cat, catById) : null;
  const early = (cat && cat.early) || (parent && parent.early);
  const iso = tx.bookDate || tx.date;
  return budgetMonthOf(iso, settings.payday, early ? settings.earlyFrom : null);
}

export function invoiceMonth(inv, settings) {
  if (inv.month) return inv.month;
  return budgetMonthOf(inv.due || inv.created, settings.payday, null);
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
// Unterkategorien werden in ihre Hauptkategorie eingerechnet (gemeinsames Budget).
export function summarizeMonth(key, data, idx, carryIn, today) {
  const { settings, txByMonth, invByMonth, catById } = idx;
  const txs = txByMonth.get(key) || [];
  const invs = invByMonth.get(key) || [];
  const status = monthStatus(key, settings, today);
  const hasData = txs.length > 0;

  const actualByCat = new Map();
  const unc = { count: 0, inSum: 0, outSum: 0 };
  for (const tx of txs) {
    const cat = tx.categoryId ? catById[tx.categoryId] : null;
    if (!cat) {
      unc.count++;
      if (tx.amount > 0) unc.inSum += tx.amount; else unc.outSum += -tx.amount;
      continue;
    }
    const g = GROUP_BY_ID[effectiveGroup(cat, catById)];
    const v = g && g.income ? tx.amount : -tx.amount;
    actualByCat.set(cat.id, (actualByCat.get(cat.id) || 0) + v);
  }
  let openInvoices = 0;
  for (const inv of invs) {
    openInvoices += inv.amount;
    if (inv.categoryId && catById[inv.categoryId]) {
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
    for (const c of topCategories(data.categories, g.id)) {
      const ownPlan = planForCategory(data.plan, c.id, key);
      const ownActual = round2(actualByCat.get(c.id) || 0);
      const subs = childCategories(data.categories, c.id).map((s) => {
        const plan = planForCategory(data.plan, s.id, key);
        const actual = round2(actualByCat.get(s.id) || 0);
        return { id: s.id, name: s.name, plan, actual, over: !g.income && plan > 0 && actual > plan + 0.004 };
      });
      const plan = round2(ownPlan + subs.reduce((x, s) => x + s.plan, 0));
      const actual = round2(ownActual + subs.reduce((x, s) => x + s.actual, 0));
      const forecast = g.income ? (actual !== 0 ? actual : plan) : Math.max(plan, actual);
      if (plan === 0 && actual === 0) continue;
      cats.push({
        id: c.id, name: c.name, plan, actual, forecast, ownPlan, ownActual,
        over: !g.income && actual > plan + 0.004,
        subs: subs.filter((s) => s.plan !== 0 || s.actual !== 0),
      });
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

// ---------- Heute ----------

// Für jede Alltag-Kategorie: noch übrig im Monat und ungefähr pro Tag.
export function dailyOverview(sm, today) {
  const daysLeft = Math.max(1, daysBetween(today, sm.range.end) + 1);
  const g = sm.groups.find((x) => x.id === 'alltag');
  const items = (g ? g.cats : [])
    .filter((c) => c.plan > 0)
    .map((c) => {
      const left = round2(c.plan - c.actual);
      return {
        id: c.id, name: c.name, plan: c.plan, actual: c.actual, left,
        perDay: round2(Math.max(0, left) / daysLeft),
        subs: c.subs,
      };
    });
  return { daysLeft, end: sm.range.end, items };
}

// Wann wurde zuletzt importiert, und bis zu welchem Buchungsdatum?
export function importStatus(txs) {
  let lastBook = null, lastAt = null;
  for (const t of txs) {
    if (t.source !== 'import') continue;
    if (t.bookDate && (!lastBook || t.bookDate > lastBook)) lastBook = t.bookDate;
    const at = (t.importedAt || '').slice(0, 10);
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  }
  return { lastBook, lastAt };
}

// Erinnerung: Monatsabschluss für den Vormonat oder Zwischenstand im laufenden Monat
export function importHint(txs, settingsIn, today) {
  const settings = { ...DEFAULT_SETTINGS, ...(settingsIn || {}) };
  const { lastBook, lastAt } = importStatus(txs);
  const cur = budgetMonthOf(today, settings.payday);
  const cr = monthRange(cur, settings.payday);
  const prev = ymAdd(cur, -1);
  const pr = monthRange(prev, settings.payday);
  const start = settings.startMonth;
  if (start && ymDiff(start, prev) >= 0 && (!lastAt || lastAt <= pr.end)) {
    return { kind: 'abschluss', month: prev, from: lastBook && lastBook >= pr.start ? lastBook : pr.start, to: pr.end };
  }
  const since = lastAt && lastAt > cr.start ? lastAt : cr.start;
  const daysLeft = daysBetween(today, cr.end);
  if (daysBetween(since, today) >= (settings.midImportAfterDays || 14) && daysLeft > 3) {
    return { kind: 'zwischen', month: cur, from: lastBook && lastBook >= cr.start ? lastBook : cr.start, to: today };
  }
  return null;
}

// Nächster Zahltag (ohne Wochenend-Korrektur)
export function nextPayday(today, payday = 25) {
  const d = Number(today.slice(8, 10));
  const ym = today.slice(0, 7);
  const target = d <= payday ? `${ym}-${pad2(payday)}` : `${ymAdd(ym, 1)}-${pad2(payday)}`;
  return { date: target, days: daysBetween(today, target) };
}

// ---------- Zusammenführen ----------

// Kategorie "fromId" in "toId" zusammenführen. Gibt die Datenbank-Änderungen zurück.
export function mergeCategoryOps(data, fromId, toId) {
  const byId = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const from = byId[fromId];
  const to = byId[toId];
  if (!from || !to || fromId === toId) throw new Error('Ungültige Auswahl.');
  if (to.parentId === fromId) throw new Error('Eine Unterkategorie kann nicht das Ziel sein.');
  const ops = [];
  const counts = { plan: 0, txs: 0, invoices: 0, rules: 0, subs: 0 };
  for (const e of data.plan) {
    if (e.categoryId !== fromId) continue;
    ops.push({ store: 'plan', type: 'put', value: { ...e, categoryId: toId, label: e.label || from.name } });
    counts.plan++;
  }
  for (const t of data.txs) {
    if (t.categoryId !== fromId) continue;
    ops.push({ store: 'txs', type: 'put', value: { ...t, categoryId: toId } });
    counts.txs++;
  }
  for (const i of data.invoices || []) {
    if (i.categoryId !== fromId) continue;
    ops.push({ store: 'invoices', type: 'put', value: { ...i, categoryId: toId } });
    counts.invoices++;
  }
  for (const r of data.rules || []) {
    if (r.categoryId !== fromId) continue;
    ops.push({ store: 'rules', type: 'put', value: { ...r, categoryId: toId } });
    counts.rules++;
  }
  const toParent = parentOf(to, byId);
  const newParent = toParent ? toParent.id : to.id;
  const newGroup = toParent ? toParent.group : to.group;
  for (const c of data.categories) {
    if (c.parentId !== fromId || c.id === fromId) continue;
    ops.push({ store: 'categories', type: 'put', value: { ...c, parentId: newParent, group: newGroup } });
    counts.subs++;
  }
  if (from.early && !to.early) ops.push({ store: 'categories', type: 'put', value: { ...to, early: true } });
  ops.push({ store: 'categories', type: 'del', key: fromId });
  const settingsPatch = data.settings && data.settings.foodCategoryId === fromId ? { foodCategoryId: toId } : null;
  return { ops, counts, settingsPatch };
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
