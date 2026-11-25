// Budget – Oberfläche. Alles läuft lokal im Browser, Daten liegen in IndexedDB.

import * as db from './db.js';
import {
  GROUPS, RHYTHMS, DEFAULT_SETTINGS, budgetMonthOf, monthRange, ymAdd, ymDiff,
  summarizeUntil, foodStats, txMonth, invoiceMonth, sortedCategories, planForCategory, planForTree,
  topCategories, childCategories, parentOf, dailyOverview, importStatus, importHint, nextPayday, mergeCategoryOps,
} from './model.js';
import {
  chf, parseAmount, todayISO, fmtDate, fmtDateShort, monthLabel, monthShort, esc, uid, daysBetween,
  fmtBytes, round2, MONTHS_DE, MONTHS_SHORT,
} from './format.js';
import { brandOf, merchantKey, cleanMerchant } from './merchants.js';
import { parseLukb } from './lukb.js';
import { prepareImport } from './matching.js';
import { prepareReceipt } from './receipts.js';
import { encryptPayload, decryptFile, inspectFile, backupFileName, deliverFile, blobToB64, b64ToBlob } from './backup.js';
import { openIcs, openReminders } from './ics.js';

const VERSION = '1.1.0';
const MID_DAY = 10; // Kalender-Erinnerung Zwischenstand

// ---------------------------------------------------------------- Zustand

const S = {
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  plan: [],
  txs: [],
  invoices: [],
  rules: [],
  receipts: [],
  tab: 'heute',
  backTab: 'heute',
  month: null,
  txFilter: 'alle',
  loaded: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const top = $('#top');
const tabbar = $('#tabbar');
const sheetRoot = $('#sheet-root');

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function data() {
  return { settings: S.settings, categories: S.categories, plan: S.plan, txs: S.txs, invoices: S.invoices, rules: S.rules };
}
function catById() {
  return Object.fromEntries(S.categories.map((c) => [c.id, c]));
}
function catLabel(c, cbi = catById()) {
  if (!c) return '';
  const p = parentOf(c, cbi);
  return p ? `${p.name} › ${c.name}` : c.name;
}
function currentMonth() {
  return budgetMonthOf(todayISO(), S.settings.payday);
}
function defaultMonth() {
  const cur = currentMonth();
  const st = S.settings.startMonth;
  return st && ymDiff(cur, st) > 0 ? st : cur;
}
function nowISO() {
  return new Date().toISOString();
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthName(key) {
  return MONTHS_DE[Number(key.slice(5, 7)) - 1];
}
function idsWithChildren(id) {
  return [id, ...childCategories(S.categories, id).map((c) => c.id)];
}

async function load() {
  const [settings, categories, plan, txs, invoices, rules, receipts] = await Promise.all([
    db.loadSettings(), db.getAll('categories'), db.getAll('plan'), db.getAll('txs'),
    db.getAll('invoices'), db.getAll('rules'), db.getAll('receipts'),
  ]);
  S.settings = { ...DEFAULT_SETTINGS, ...settings };
  S.categories = categories;
  S.plan = plan;
  S.txs = txs;
  S.invoices = invoices;
  S.rules = rules;
  S.receipts = receipts;
  if (!S.month) S.month = defaultMonth();
  S.loaded = true;
}

async function saveSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    await db.saveSetting(k, v);
    S.settings[k] = v;
  }
}

// ---------------------------------------------------------------- Icons

const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9v9h9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
};

// ---------------------------------------------------------------- Bausteine

// Auswahlliste mit Haupt- und Unterkategorien und "+ Neue Kategorie"
function catOptions(selected, noneLabel = '— ohne Kategorie —', { allowNew = true, exclude = [] } = {}) {
  let h = `<option value="">${esc(noneLabel)}</option>`;
  const opt = (id, label) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  for (const g of GROUPS) {
    const tops = topCategories(S.categories, g.id).filter((c) => !exclude.includes(c.id));
    if (!tops.length) continue;
    h += `<optgroup label="${esc(g.name)}">`;
    for (const c of tops) {
      h += opt(c.id, c.name);
      for (const s of childCategories(S.categories, c.id)) if (!exclude.includes(s.id)) h += opt(s.id, `${c.name} › ${s.name}`);
    }
    h += '</optgroup>';
  }
  if (allowNew) h += '<option value="__new">＋ Neue Kategorie …</option>';
  return h;
}

function catSelect(name, selected, { noneLabel = '— ohne Kategorie —', attrs = '' } = {}) {
  return `<select class="input" ${name ? `name="${name}"` : ''} data-catsel data-none="${esc(noneLabel)}" data-prev="${esc(selected || '')}" ${attrs}>${catOptions(selected, noneLabel)}</select>`;
}

function monthList(extra = []) {
  const base = S.settings.startMonth || currentMonth();
  const from = ymAdd(base, -12);
  const to = ymAdd(currentMonth(), 36);
  const set = new Set();
  for (let k = from; ymDiff(k, to) >= 0; k = ymAdd(k, 1)) set.add(k);
  for (const e of extra) if (e) set.add(e);
  return [...set].sort();
}

function monthOptions(selected, { emptyLabel = null, short = false } = {}) {
  let h = emptyLabel !== null ? `<option value=""${!selected ? ' selected' : ''}>${esc(emptyLabel)}</option>` : '';
  const lbl = (k) => (short ? `${MONTHS_SHORT[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : monthLabel(k));
  for (const k of monthList([selected])) h += `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(lbl(k))}</option>`;
  return h;
}

function monthbar(key) {
  const r = monthRange(key, S.settings.payday);
  return `<div class="monthbar">
    <button class="iconbtn" data-act="month-prev" aria-label="Vorheriger Monat">${ICON.left}</button>
    <button class="mlabel" data-act="month-today" aria-label="Zum aktuellen Monat"><strong>${esc(monthLabel(key))}</strong><span>${fmtDateShort(r.start)} – ${fmtDate(r.end)}</span></button>
    <button class="iconbtn" data-act="month-next" aria-label="Nächster Monat">${ICON.right}</button>
  </div>`;
}

function notice({ ico = 'ℹ️', title, text = '', actions = '', kind = '' }) {
  return `<div class="notice ${kind}"><div class="ico">${ico}</div><div class="body"><strong>${title}</strong>${text}${actions ? `<div class="actions">${actions}</div>` : ''}</div></div>`;
}

function rhythmLabel(every) {
  const r = RHYTHMS.find((x) => x.every === Number(every));
  return r ? r.label : 'monatlich';
}

// Rückgabe ist HTML (Bezeichnung wird escaped)
function entrySummary(e) {
  const amt = chf(e.amount);
  const lbl = e.label ? `<b>${esc(e.label)}</b> · ` : '';
  if (Number(e.every) === 0) return `${lbl}${amt} einmalig im ${monthShort(e.start)}`;
  return `${lbl}${amt} ${rhythmLabel(e.every)} · ${monthShort(e.start)} – ${e.end ? monthShort(e.end) : 'offen'}`;
}

function receiptsOf(ownerType, ownerId) {
  return S.receipts.filter((r) => r.ownerType === ownerType && r.ownerId === ownerId);
}

function dueInfo(inv) {
  const d = daysBetween(todayISO(), inv.due);
  if (d < 0) return { text: `seit ${-d} ${-d === 1 ? 'Tag' : 'Tagen'} überfällig`, cls: 'red', d };
  if (d === 0) return { text: 'heute fällig', cls: 'red', d };
  if (d === 1) return { text: 'morgen fällig', cls: 'warn', d };
  if (d <= 7) return { text: `in ${d} Tagen fällig`, cls: 'warn', d };
  return { text: `fällig ${fmtDateShort(inv.due)}`, cls: 'grey', d };
}

function importHintHtml(compact = false) {
  const h = importHint(S.txs, S.settings, todayISO());
  if (!h) return '';
  const range = `vom <b>${fmtDate(h.from)}</b> bis <b>${h.kind === 'zwischen' ? 'heute' : fmtDate(h.to)}</b>`;
  if (compact) return `<p class="small muted" style="margin:2px 4px 8px">📄 Nächster Auszug: ${range}</p>`;
  return notice({
    ico: '📄',
    title: h.kind === 'abschluss' ? `Monatsabschluss ${monthName(h.month)}` : 'Zeit für einen Zwischenstand',
    text: `Lade den Auszug ${range} hoch. Doppelte Buchungen ignoriert die App.`,
    actions: '<button class="btn small" data-act="import-pdf">Auszug laden</button>',
  });
}

function backupNotice() {
  const lb = S.settings.lastBackup;
  const lbDays = lb ? daysBetween(lb.slice(0, 10), todayISO()) : null;
  if (!S.txs.length || (lbDays !== null && lbDays <= 30)) return '';
  return notice({ ico: '💾', title: lb ? `Letztes Backup vor ${lbDays} Tagen` : 'Noch kein Backup', text: 'Deine Daten gibt es nur auf diesem Gerät. Ein Backup schützt vor Verlust.', actions: '<button class="btn small" data-act="backup">Backup erstellen</button>' });
}

// ---------------------------------------------------------------- Toast

let toastTimer = null;
function toast(msg, actionLabel = null, action = null, ms = 3500) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) el.querySelector('button').onclick = () => { el.classList.remove('show'); action(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? ms + 2500 : ms);
}

// ---------------------------------------------------------------- Sheets

let SH = null; // aktueller Sheet-Kontext

function openSheet(html, ctx = {}, { full = false } = {}) {
  closeSheet(true);
  SH = { urls: [], ...ctx };
  sheetRoot.innerHTML = `<div class="sheet-overlay"><div class="sheet${full ? ' full' : ''}" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${html}</div></div>`;
  document.body.style.overflow = 'hidden';
  return $('.sheet', sheetRoot);
}

function closeSheet(silent = false) {
  if (SH && SH.urls) for (const u of SH.urls) URL.revokeObjectURL(u);
  if (SH && SH.onClose && !silent) SH.onClose();
  SH = null;
  sheetRoot.innerHTML = '';
  document.body.style.overflow = '';
}

function sheetHead(title) {
  return `<div class="sheet-head"><h2>${esc(title)}</h2><button class="close" data-act="sheet-close" aria-label="Schliessen">✕</button></div>`;
}

function overlay(innerHtml) {
  const box = document.createElement('div');
  box.className = 'sheet-overlay';
  box.style.zIndex = 60;
  box.innerHTML = innerHtml;
  document.body.appendChild(box);
  return box;
}

function ask(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const box = overlay(`<div class="sheet"><div class="sheet-handle"></div><h2 style="margin:4px 0 8px;font-size:20px">${esc(title)}</h2><p class="muted" style="margin:0 0 16px">${text}</p>
      <div class="btnrow"><button class="btn secondary" data-r="0">Abbrechen</button><button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(okLabel)}</button></div></div>`);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b || e.target === box) {
        e.stopPropagation();
        box.remove();
        resolve(b ? b.dataset.r === '1' : false);
      }
    });
  });
}

function askPassword(title, text, { confirm = false, okLabel = 'Weiter' } = {}) {
  return new Promise((resolve) => {
    const box = overlay(`<form class="sheet" autocomplete="on"><div class="sheet-handle"></div>
      <h2 style="margin:4px 0 8px;font-size:20px">${esc(title)}</h2><p class="muted small" style="margin:0 0 6px">${text}</p>
      <input type="text" name="username" autocomplete="username" value="Budget-Backup" hidden readonly>
      <label class="field"><span>Passwort</span><input class="input" type="password" name="pw" autocomplete="${confirm ? 'new-password' : 'current-password'}" required minlength="${confirm ? 8 : 1}"></label>
      ${confirm ? '<label class="field"><span>Passwort wiederholen</span><input class="input" type="password" name="pw2" autocomplete="new-password" required></label>' : ''}
      <p class="small" data-err style="color:var(--minus);min-height:1em;margin:4px 2px"></p>
      <div class="btnrow"><button type="button" class="btn secondary" data-r="0">Abbrechen</button><button type="submit" class="btn">${esc(okLabel)}</button></div></form>`);
    const form = box.querySelector('form');
    setTimeout(() => form.pw.focus(), 50);
    const finish = (v) => { box.remove(); resolve(v); };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-r="0"]') || e.target === box) { e.stopPropagation(); finish(null); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pw = form.pw.value;
      if (confirm) {
        if (pw.length < 8) { form.querySelector('[data-err]').textContent = 'Mindestens 8 Zeichen.'; return; }
        if (pw !== form.pw2.value) { form.querySelector('[data-err]').textContent = 'Die Passwörter stimmen nicht überein.'; return; }
      }
      finish(pw);
    });
  });
}

// Neue Kategorie direkt aus einer Auswahlliste anlegen. Gibt die neue ID zurück.
function askNewCategory() {
  return new Promise((resolve) => {
    const tops = GROUPS.map((g) => {
      const cs = topCategories(S.categories, g.id);
      return cs.length ? `<optgroup label="${esc(g.name)}">${cs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const box = overlay(`<form class="sheet" autocomplete="off"><div class="sheet-handle"></div>
      <h2 style="margin:4px 0 8px;font-size:20px">Neue Kategorie</h2>
      <label class="field"><span>Name</span><input class="input" name="name" required placeholder="z.B. Dates, Fitness, Geschenke"></label>
      <label class="field"><span>Gehört zu</span><select class="input" name="parentId"><option value="">— eigene Hauptkategorie —</option>${tops}</select></label>
      <label class="field" data-groupfield><span>Gruppe</span><select class="input" name="group">${GROUPS.map((g) => `<option value="${g.id}"${g.id === 'alltag' ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <p class="small muted" style="margin:0 2px">Einen Betrag kannst du später im Plan festlegen. Unterkategorien teilen sich das Budget ihrer Hauptkategorie.</p>
      <div class="btnrow"><button type="button" class="btn secondary" data-r="0">Abbrechen</button><button type="submit" class="btn">Anlegen</button></div></form>`);
    const form = box.querySelector('form');
    setTimeout(() => form.name.focus(), 50);
    const toggle = () => { box.querySelector('[data-groupfield]').style.display = form.parentId.value ? 'none' : ''; };
    form.parentId.addEventListener('change', toggle);
    const finish = (v) => { box.remove(); resolve(v); };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-r="0"]') || e.target === box) { e.stopPropagation(); finish(null); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = form.name.value.trim();
      if (!name) return;
      const parentId = form.parentId.value || null;
      const cbi = catById();
      const group = parentId ? cbi[parentId].group : form.group.value;
      const siblings = parentId ? childCategories(S.categories, parentId) : S.categories.filter((c) => c.group === group && !c.parentId);
      const order = siblings.length ? Math.max(...siblings.map((x) => x.order ?? 0)) + 1 : 0;
      const c = { id: uid('cat'), name, group, parentId, order, early: false };
      await db.put('categories', c);
      S.categories.push(c);
      finish(c.id);
      toast(`Kategorie «${name}» angelegt.`);
    });
  });
}

function refreshCatSelects(target, newId) {
  document.querySelectorAll('select[data-catsel]').forEach((s) => {
    const v = s === target ? newId : s.value;
    s.innerHTML = catOptions(v, s.dataset.none || undefined);
    s.value = v;
    s.dataset.prev = v;
  });
}

// ---------------------------------------------------------------- Rendern

function render() {
  if (!S.loaded) return;
  if (!S.categories.length) {
    tabbar.hidden = true;
    top.innerHTML = '';
    view.innerHTML = renderWelcome();
    return;
  }
  tabbar.hidden = false;
  renderTabbar();
  const fn = { heute: renderToday, uebersicht: renderOverview, buchungen: renderTxs, rechnungen: renderInvoices, plan: renderPlan, mehr: renderMore }[S.tab] || renderToday;
  const { head, body } = fn();
  top.innerHTML = head;
  view.innerHTML = body;
  if (S.tab === 'mehr') fillStorageInfo();
}

function renderTabbar() {
  const unc = S.txs.filter((t) => !t.categoryId).length;
  const due = S.invoices.filter((i) => i.status === 'offen' && dueInfo(i).d <= 3).length;
  const tabs = [
    ['heute', 'Heute', ICON.sun, due],
    ['uebersicht', 'Monat', ICON.home, 0],
    ['buchungen', 'Buchungen', ICON.list, unc],
    ['plan', 'Plan', ICON.plan, 0],
    ['mehr', 'Mehr', ICON.more, 0],
  ];
  const active = S.tab === 'rechnungen' ? S.backTab : S.tab;
  tabbar.innerHTML = tabs.map(([id, label, icon, badge]) =>
    `<button class="${active === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${icon}<span>${label}</span>${badge ? `<span class="dot">${badge}</span>` : ''}</button>`).join('');
}

function installSteps() {
  return 'Tippe in Safari auf die <b>drei Punkte</b> rechts neben der Adressleiste, dann <b>Teilen</b> und <b>Zum Home-Bildschirm</b>. «Als Web-App öffnen» eingeschaltet lassen.';
}

function renderWelcome() {
  return `<div class="welcome">
    <h1>Willkommen 👋</h1>
    <p>Deine Budget-App. Alles bleibt auf diesem Gerät, nichts geht ins Internet.</p>
    ${isIOS && !isStandalone() ? notice({ ico: '📲', title: 'Zuerst auf den Homescreen legen', text: `${installSteps()} Öffne die App danach vom Homescreen und lade erst dort deine Startdatei. Die Homescreen-App hat ihren eigenen Speicher.` }) : ''}
    <div style="display:grid;gap:10px;margin-top:18px">
      <button class="btn block" data-act="data-load">Startdatei oder Backup laden</button>
      <button class="btn secondary block" data-act="start-empty">Leer beginnen</button>
    </div>
  </div>`;
}

// ---------- Heute

function renderToday() {
  const today = todayISO();
  const key = currentMonth();
  const sums = summarizeUntil(key, data(), today);
  const sm = sums.get(key);
  const d = dailyOverview(sm, today);
  const { lastBook } = importStatus(S.txs);
  const manualSince = S.txs.filter((t) => t.source === 'manuell' && (!lastBook || t.date > lastBook)).length;
  const dateText = new Date().toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });

  let stand;
  if (!lastBook) stand = 'Noch kein Auszug importiert. Die Zahlen sind dein Plan.';
  else if (lastBook < sm.range.start) stand = `Stand: Auszug bis ${fmtDate(lastBook)}. In diesem Monat ist noch nichts importiert, die Zahlen sind dein Plan.`;
  else stand = `Stand: Auszug bis ${fmtDate(lastBook)}`;
  if (manualSince) stand += ` · ${manualSince} ${manualSince === 1 ? 'Handeintrag' : 'Handeinträge'} seither`;

  let notices = '';
  if (isIOS && !isStandalone()) {
    notices += notice({ ico: '📲', title: 'Auf den Homescreen legen', text: 'Sonst kann Safari deine Daten löschen, wenn du die Seite 7 Tage nicht öffnest.', actions: '<button class="btn small" data-act="help-install">So geht\'s</button>' });
  }
  notices += importHintHtml();

  // Alltag: ca. pro Tag
  let items = '';
  for (const it of d.items) {
    const used = it.plan > 0 ? Math.min(100, (it.actual / it.plan) * 100) : 0;
    const over = it.left < 0;
    const subs = (it.subs || []).filter((s) => s.actual !== 0)
      .map((s) => `<div class="day-subline">davon ${esc(s.name)}: <span class="num">${chf(s.actual)}</span>${s.plan ? ` von ${chf(s.plan)}` : ''}</div>`).join('');
    items += `<div class="day-item" data-act="cat-txs" data-id="${esc(it.id)}" data-month="${key}" role="button">
      <div class="day-top"><span class="day-name">${esc(it.name)}</span>
        <span class="day-big num ${over ? 'minus' : ''}">${over ? '0' : `ca. ${Math.round(it.perDay)}`} <small>CHF/Tag</small></span></div>
      <div class="day-sub"><span>${over ? `<b class="minus">${chf(-it.left)} überzogen</b>` : `noch <b class="num">${chf(it.left)}</b> von ${chf(it.plan)}`}</span><span>bis ${fmtDateShort(d.end)}</span></div>
      <div class="bar${over ? ' over' : ''}"><i style="width:${used.toFixed(1)}%"></i></div>
      ${subs}
    </div>`;
  }
  const alltag = d.items.length
    ? `<div class="card"><div class="group-head"><h3>Alltag</h3><span class="sum">noch ${d.daysLeft} ${d.daysLeft === 1 ? 'Tag' : 'Tage'}</span></div>${items}</div>`
    : notice({ ico: '🗓️', title: 'Kein Alltag-Budget geplant', text: 'Leg im Plan Beträge für Essen oder Freizeit an, dann siehst du hier, wie viel du pro Tag ausgeben kannst.' });

  // Rechnungen
  const open = S.invoices.filter((i) => i.status === 'offen').sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const soon = open.filter((i) => dueInfo(i).d <= 14);
  let inv = '';
  if (soon.length) {
    inv = `<div class="section-title">Rechnungen</div><div class="list">${soon.map((i) => {
      const di = dueInfo(i);
      return `<button class="row" data-act="inv-open" data-id="${esc(i.id)}"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub"><span class="chip ${di.cls}">${esc(di.text)}</span></div></div><div class="right amount">${chf(i.amount)}</div></button>`;
    }).join('')}<button class="row" data-act="open-invoices"><div class="main"><div class="title" style="color:var(--accent)">Alle Rechnungen (${open.length} offen)</div></div><span class="chev">›</span></button></div>`;
  } else {
    inv = `<div class="list"><button class="row" data-act="open-invoices"><div class="main"><div class="title">🧾 Rechnungen</div><div class="sub">${open.length ? `${open.length} offen, nichts in den nächsten 14 Tagen fällig` : 'Keine offenen Rechnungen'}</div></div><span class="chev">›</span></button></div>`;
  }

  const pd = nextPayday(today, S.settings.payday);
  const payText = pd.days === 0 ? '🎉 Heute ist Zahltag' : `💰 Lohn in ${pd.days} ${pd.days === 1 ? 'Tag' : 'Tagen'} <span class="muted">(${fmtDateShort(pd.date)})</span>`;

  const reminders = S.settings.remindersAdded ? '' : notice({ ico: '📅', kind: 'info', title: 'Erinnerungen in den Kalender', text: `Dein iPhone erinnert dich jeden Monat am ${MID_DAY}. an den Zwischenstand und am ${S.settings.payday}. an den Monatsabschluss.`, actions: '<button class="btn small" data-act="reminders">Eintragen</button>' });

  const head = `<h1>Heute</h1><div class="today-date">${esc(dateText)}</div>`;
  const body = `${notices}
    <p class="stand">${stand}</p>
    ${alltag}
    <div class="btnrow" style="margin-top:4px"><button class="btn secondary" data-act="tx-new">+ Ausgabe eintragen</button></div>
    ${inv}
    <div class="list">
      <div class="row" style="cursor:default"><div class="main"><div class="title">${payText}</div></div></div>
      <button class="row" data-act="goto-month" data-month="${key}"><div class="main"><div class="title">Ende Monat übrig</div><div class="sub">${sm.resultKind === 'plan' ? 'laut Plan' : 'Prognose'} · ${esc(monthLabel(key))}</div></div><div class="right amount ${sm.result < 0 ? 'minus' : ''}">${chf(sm.result)}</div><span class="chev">›</span></button>
    </div>
    ${backupNotice()}
    ${reminders}`;
  return { head, body };
}

// ---------- Monat

function renderOverview() {
  const today = todayISO();
  const sums = summarizeUntil(S.month, data(), today);
  const sm = sums.get(S.month);
  const prevName = monthName(ymAdd(S.month, -1));
  const nextName = monthName(ymAdd(S.month, 1));
  const kind = sm.resultKind;
  const inSum = kind === 'ist' ? sm.actIn : kind === 'prognose' ? sm.fcIn : sm.planIn;
  const outSum = kind === 'ist' ? sm.actOut : kind === 'prognose' ? sm.fcOut : sm.planOut;
  const label = { plan: 'Geplant übrig am Monatsende', prognose: 'Voraussichtlich übrig am Monatsende', ist: 'Übrig geblieben' }[kind];
  let status;
  if (sm.status === 'laufend') status = '<span class="chip">läuft</span>';
  else if (sm.status === 'zukunft') status = '<span class="chip grey">geplant</span>';
  else if (sm.hasData) status = '<span class="chip">abgeschlossen</span>';
  else status = '<span class="chip warn">noch kein Auszug</span>';
  const beforeStart = S.settings.startMonth && ymDiff(S.month, S.settings.startMonth) > 0;

  let notices = '';
  if (sm.noImport) {
    notices += notice({ ico: '📄', title: `${monthName(S.month)} ist vorbei`, text: `Lade den Kontoauszug vom ${fmtDate(sm.range.start)} bis ${fmtDate(sm.range.end)} hoch.`, actions: '<button class="btn small" data-act="import-pdf">Auszug laden</button>' });
  }
  if (sm.uncategorized.count) {
    notices += notice({ ico: '🏷️', title: `${sm.uncategorized.count} ${sm.uncategorized.count === 1 ? 'Buchung' : 'Buchungen'} ohne Kategorie`, text: 'Ordne sie zu, damit die Zahlen stimmen. Die App merkt sich die Läden.', actions: '<button class="btn small" data-act="goto-unc">Zuordnen</button>' });
  }

  const showActual = kind !== 'plan';
  let groupsHtml = '';
  for (const g of sm.groups) {
    if (!g.cats.length) continue;
    const sum = showActual ? `${chf(g.actual)} <span class="of">/ ${chf(g.plan)}</span>` : chf(g.plan);
    groupsHtml += `<div class="card"><div class="group-head"><h3>${esc(g.name)}</h3><span class="sum num">${sum}</span></div>`;
    for (const c of g.cats) {
      const pct = c.plan > 0 ? Math.min(100, (c.actual / c.plan) * 100) : (c.actual > 0 ? 100 : 0);
      const val = showActual ? `${chf(c.actual)} <span class="of">/ ${chf(c.plan)}</span>` : chf(c.plan);
      groupsHtml += `<div class="cat" data-act="cat-txs" data-id="${esc(c.id)}" role="button">
        <div class="cat-row"><span class="cat-name">${esc(c.name)}</span><span class="cat-val num${c.over ? ' minus' : ''}">${val}</span></div>
        ${showActual ? `<div class="bar${c.over ? ' over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      </div>`;
      for (const s of c.subs || []) {
        const sv = showActual ? `${chf(s.actual)}${s.plan ? ` <span class="of">/ ${chf(s.plan)}</span>` : ''}` : (s.plan ? chf(s.plan) : '');
        groupsHtml += `<div class="cat sub" data-act="cat-txs" data-id="${esc(s.id)}" role="button"><div class="cat-row"><span class="cat-name">↳ ${esc(s.name)}</span><span class="cat-val num${s.over ? ' minus' : ''}">${sv}</span></div></div>`;
      }
    }
    groupsHtml += '</div>';
  }
  if (sm.uncategorized.count) {
    groupsHtml += `<div class="card"><div class="cat" data-act="goto-unc" role="button"><div class="cat-row"><span class="cat-name">Ohne Kategorie (${sm.uncategorized.count})</span><span class="cat-val num">${sm.uncategorized.outSum ? '−' + chf(sm.uncategorized.outSum) : ''}${sm.uncategorized.inSum ? ' +' + chf(sm.uncategorized.inSum) : ''}</span></div></div></div>`;
  }
  if (!groupsHtml) groupsHtml = '<div class="empty"><div class="big">🗓️</div>Für diesen Monat ist noch nichts geplant.</div>';

  let foodHtml = '';
  const fs = foodStats(data(), today, brandOf);
  if (fs && fs.months.length) {
    const planFood = planForCategory(S.plan, fs.categoryId, S.month);
    foodHtml = `<div class="card card-pad" data-act="food" role="button" style="cursor:pointer">
      <div class="cat-row"><strong>🛒 Lebensmittel</strong><span class="chev">›</span></div>
      <div class="kv"><span class="k">Durchschnitt pro Monat</span><span class="num">${chf(fs.avg)}</span></div>
      ${planFood ? `<div class="kv"><span class="k">Dein Plan</span><span class="num">${chf(planFood)}</span></div>` : ''}
    </div>`;
  }

  const head = monthbar(S.month);
  const body = `${notices}
    <div class="card hero">
      <div class="cat-row"><span class="label">${label}</span>${status}</div>
      <div class="big num ${sm.result < 0 ? 'minus' : ''}">${chf(sm.result)}</div>
      <div class="rows">
        ${beforeStart ? '<div class="kv"><span class="k">Vor dem Startmonat, ohne Übertrag</span></div>' : `<div class="kv"><span class="k">Übertrag aus ${esc(prevName)}${S.month === S.settings.startMonth && S.settings.startCarryNote ? `<br><span class="tiny">${esc(S.settings.startCarryNote)}</span>` : ''}</span><span class="num ${sm.carryIn < 0 ? 'minus' : ''}">${chf(sm.carryIn, { sign: true })}</span></div>`}
        <div class="kv"><span class="k">Einnahmen</span><span class="num">${chf(inSum, { sign: true })}</span></div>
        <div class="kv"><span class="k">Ausgaben</span><span class="num">${chf(-outSum, { sign: true })}</span></div>
        <div class="kv total"><span>Geht in den ${esc(nextName)}</span><span class="num ${sm.result < 0 ? 'minus' : ''}">${chf(sm.result, { sign: true })}</span></div>
        ${kind === 'ist' ? `<div class="kv small"><span class="k">Geplant war</span><span class="num muted">${chf(sm.planResult, { sign: true })}</span></div>` : ''}
        ${kind === 'prognose' ? '<div class="kv small"><span class="k">Plan, aber wo du schon mehr ausgegeben hast, zählt das echte Ist.</span></div>' : ''}
      </div>
    </div>
    ${sm.result < 0 && kind !== 'ist' ? notice({ ico: '⚠️', kind: 'red', title: 'Dieser Monat geht ins Minus', text: 'Schau im Plan, was du verschieben oder kürzen kannst.' }) : ''}
    ${groupsHtml}
    ${foodHtml}`;
  return { head, body };
}

// ---------- Buchungen

function txsOfMonth(key) {
  const cbi = catById();
  return S.txs.filter((t) => txMonth(t, S.settings, cbi) === key);
}

function renderTxs() {
  const cbi = catById();
  const all = txsOfMonth(S.month);
  const unc = all.filter((t) => !t.categoryId);
  let list = all;
  let filterChip = '';
  if (S.txFilter === 'ohne') list = unc;
  else if (S.txFilter.startsWith('cat:')) {
    const id = S.txFilter.slice(4);
    const ids = idsWithChildren(id);
    list = all.filter((t) => ids.includes(t.categoryId));
    filterChip = `<button class="on" data-act="tx-filter" data-f="alle">${esc(catLabel(cbi[id], cbi) || 'Kategorie')} ✕</button>`;
  }
  list = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.bookDate || '').localeCompare(a.bookDate || ''));
  const out = round2(list.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0));
  const inn = round2(list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));

  let rows = '';
  let lastDate = null;
  let chunk = '';
  const flush = () => { if (chunk) rows += `<div class="list">${chunk}</div>`; chunk = ''; };
  for (const t of list) {
    if (t.date !== lastDate) {
      flush();
      rows += `<div class="date-head">${fmtDate(t.date)}</div>`;
      lastDate = t.date;
    }
    const cat = t.categoryId ? cbi[t.categoryId] : null;
    const nRec = receiptsOf('tx', t.id).length + (t.invoiceId ? receiptsOf('invoice', t.invoiceId).length : 0);
    const bits = [cat ? esc(catLabel(cat, cbi)) : '<span class="need">Kategorie wählen</span>'];
    if (nRec) bits.push(`📎 ${nRec}`);
    if (t.source === 'manuell') bits.push(esc(t.paidWith || 'von Hand'));
    if (t.month) bits.push('verschoben');
    if (t.note) bits.push('📝');
    chunk += `<button class="row" data-act="tx-open" data-id="${esc(t.id)}">
      <div class="main"><div class="title">${esc(t.merchant || t.text || 'Buchung')}</div><div class="sub">${bits.join(' · ')}</div></div>
      <div class="right amount ${t.amount > 0 ? 'plus' : ''}">${chf(t.amount, { sign: true })}</div>
    </button>`;
  }
  flush();
  if (!list.length) {
    const r = monthRange(S.month, S.settings.payday);
    rows = all.length
      ? '<div class="empty">Keine Buchungen für diesen Filter.</div>'
      : `<div class="empty"><div class="big">📄</div>Noch keine Buchungen in diesem Monat.<br>Lade den Auszug vom ${fmtDate(r.start)} bis ${fmtDate(r.end)} hoch, gern auch schon zwischendurch.</div>`;
  }

  const head = monthbar(S.month);
  const body = `<div class="btnrow">
      <button class="btn" data-act="import-pdf">Auszug laden</button>
      <button class="btn secondary" data-act="tx-new">+ Eintrag</button>
    </div>
    ${importHintHtml(true)}
    <div class="chips">
      <button class="${S.txFilter === 'alle' ? 'on' : ''}" data-act="tx-filter" data-f="alle">Alle (${all.length})</button>
      <button class="${S.txFilter === 'ohne' ? 'on' : ''}" data-act="tx-filter" data-f="ohne">Ohne Kategorie (${unc.length})</button>
      ${filterChip}
    </div>
    ${list.length ? `<p class="small muted" style="margin:8px 4px">Ausgaben <b class="num">${chf(out)}</b> · Einnahmen <b class="num">${chf(inn)}</b></p>` : ''}
    ${rows}`;
  return { head, body };
}

// ---------- Rechnungen

function renderInvoices() {
  const cbi = catById();
  const open = S.invoices.filter((i) => i.status === 'offen').sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const paid = S.invoices.filter((i) => i.status === 'bezahlt').sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || '')).slice(0, 20);
  const total = round2(open.reduce((s, i) => s + i.amount, 0));
  const row = (i) => {
    const di = dueInfo(i);
    const cat = i.categoryId ? cbi[i.categoryId] : null;
    const sub = i.status === 'offen'
      ? `${cat ? esc(catLabel(cat, cbi)) + ' · ' : ''}zählt zum ${esc(monthName(invoiceMonth(i, S.settings)))}${receiptsOf('invoice', i.id).length ? ' · 📎' : ''}`
      : `bezahlt ${fmtDate(i.paidDate)}${i.paidTxId ? ' · im Import gefunden' : ''}`;
    return `<button class="row" data-act="inv-open" data-id="${esc(i.id)}">
      <div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${sub}</div></div>
      <div class="right"><div class="amount">${chf(i.amount)}</div>${i.status === 'offen' ? `<span class="chip ${di.cls}">${esc(di.text)}</span>` : ''}</div>
    </button>`;
  };
  const backLabel = { heute: 'Heute', mehr: 'Mehr', uebersicht: 'Monat', buchungen: 'Buchungen', plan: 'Plan' }[S.backTab] || 'Heute';
  const head = `<button class="btn ghost small backbtn" data-act="tab" data-tab="${S.backTab}">‹ ${backLabel}</button><h1>Rechnungen</h1>`;
  const body = `
    <button class="btn block" data-act="inv-new" style="margin-top:6px">+ Rechnung erfassen</button>
    <p class="small muted" style="margin:10px 4px">Offene Rechnungen zählen sofort in deinem Budget. Beim Import findet die App die Zahlung und hakt sie automatisch ab.</p>
    <div class="section-title">Offen${open.length ? ` · ${chf(total)}` : ''}</div>
    ${open.length ? `<div class="list">${open.map(row).join('')}</div>` : '<div class="empty">Keine offenen Rechnungen. 🎉</div>'}
    ${paid.length ? `<details><summary>Bezahlt (${paid.length})</summary><div class="list">${paid.map(row).join('')}</div></details>` : ''}`;
  return { head, body };
}

// ---------- Plan

function planRow(c, isSub) {
  const amt = isSub ? planForCategory(S.plan, c.id, S.month) : planForTree(S.plan, S.categories, c.id, S.month);
  const entries = S.plan.filter((e) => e.categoryId === c.id);
  const kids = isSub ? [] : childCategories(S.categories, c.id);
  let sub = entries.length ? entries.map(entrySummary).join('<br>') : (kids.length ? 'Budget über die Unterkategorien' : 'Kein Betrag geplant');
  if (isSub && !entries.length) sub = 'teilt das Budget der Hauptkategorie';
  const flags = [c.id === S.settings.foodCategoryId ? '🛒' : '', c.early ? '📅' : ''].join('');
  return `<button class="row${isSub ? ' subrow' : ''}" data-act="cat-open" data-id="${esc(c.id)}">
    <div class="main"><div class="title">${isSub ? '↳ ' : ''}${esc(c.name)} ${flags}</div><div class="sub" style="white-space:normal">${sub}</div></div>
    <div class="right amount ${amt ? '' : 'muted'}">${amt ? chf(amt) : '–'}</div>
  </button>`;
}

function renderPlan() {
  let planIn = 0, planOut = 0;
  let html = `<p class="small muted" style="margin:6px 4px 0">Beträge im ${esc(monthLabel(S.month))}. Tippe auf eine Kategorie, um sie zu bearbeiten.</p>`;
  for (const g of GROUPS) {
    let gsum = 0;
    let rows = '';
    for (const c of topCategories(S.categories, g.id)) {
      gsum += planForTree(S.plan, S.categories, c.id, S.month);
      rows += planRow(c, false);
      for (const s of childCategories(S.categories, c.id)) rows += planRow(s, true);
    }
    if (g.income) planIn += gsum; else planOut += gsum;
    html += `<div class="section-title" style="display:flex;justify-content:space-between"><span>${esc(g.name)}</span><span class="num">${chf(gsum)}</span></div>
      <div class="list">${rows}<button class="row" data-act="cat-new" data-group="${g.id}"><div class="main"><div class="title" style="color:var(--accent)">+ Kategorie</div></div></button></div>`;
  }
  const diff = round2(planIn - planOut);
  html += `<div class="card card-pad">
    <div class="kv"><span class="k">Geplante Einnahmen</span><span class="num">${chf(planIn)}</span></div>
    <div class="kv"><span class="k">Geplante Ausgaben</span><span class="num">${chf(-planOut, { sign: true })}</span></div>
    <div class="kv total"><span>Im ${esc(monthName(S.month))} geplant übrig</span><span class="num ${diff < 0 ? 'minus' : 'plus'}">${chf(diff, { sign: true })}</span></div>
    <p class="small muted" style="margin:6px 0 0">Ohne Übertrag aus dem Vormonat. Den siehst du unter «Monat».</p>
  </div>
  <p class="tiny muted" style="margin:4px">🛒 = Lebensmittel-Auswertung · 📅 = kommt um den Zahltag (Lohn, Miete) · ↳ = Unterkategorie</p>`;
  return { head: monthbar(S.month), body: html };
}

// ---------- Mehr

function renderMore() {
  const lb = S.settings.lastBackup;
  const open = S.invoices.filter((i) => i.status === 'offen').length;
  const head = '<h1>Mehr</h1>';
  const r = (act, title, sub = '', extra = '') => `<button class="row" data-act="${act}" ${extra}><div class="main"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div><span class="chev">›</span></button>`;
  const body = `
    <div class="section-title">Geld</div>
    <div class="list">
      ${r('open-invoices', '🧾 Rechnungen', open ? `${open} offen` : 'Keine offenen')}
      ${r('food', '🛒 Lebensmittel', 'Durchschnitt pro Monat und nach Laden')}
    </div>
    <div class="section-title">Kontoauszug</div>
    <div class="list">
      ${r('import-pdf', '📄 Auszug laden (PDF)', 'LUKB E-Banking → Vermögen → Kontoauszug → Exportieren')}
      ${r('reminders', '📅 Erinnerungen in den Kalender', `Jeden Monat am ${MID_DAY}. und ${S.settings.payday}.${S.settings.remindersAdded ? ' · eingetragen ✓' : ''}`)}
    </div>
    <div class="section-title">Daten & Backup</div>
    <div class="list">
      ${r('backup', '💾 Backup erstellen', lb ? `Letztes Backup: ${fmtDate(lb.slice(0, 10))}` : 'Noch nie')}
      ${r('data-load', '📂 Backup oder Startdatei laden', 'Ersetzt alle Daten auf diesem Gerät')}
    </div>
    <div class="section-title">Einstellungen</div>
    <div class="list">
      ${r('tab', '🗂️ Kategorien & Plan', 'Anlegen, umbenennen, Unterkategorien, zusammenführen', 'data-tab="plan"')}
      ${r('settings', '⚙️ Budgetmonat & Übertrag', `Zahltag am ${S.settings.payday}. · Start ${S.settings.startMonth ? monthLabel(S.settings.startMonth) : '–'}`)}
      ${r('rules', '🏪 Gelernte Läden', `${S.rules.length} gemerkt`)}
    </div>
    <div class="section-title">Gerät</div>
    <div class="list">
      <div class="row" style="cursor:default"><div class="main"><div class="title">🔒 Speicher</div><div class="sub" id="storage-info">wird geprüft …</div></div></div>
      ${r('help-install', '📲 Auf den Homescreen legen')}
    </div>
    <div class="section-title">Gefahrenzone</div>
    <div class="list">${r('wipe', '<span style="color:var(--minus)">Alle Daten auf diesem Gerät löschen</span>')}</div>
    <p class="tiny muted" style="text-align:center;margin:22px 0">Budget ${VERSION} · Deine Daten bleiben auf diesem Gerät.</p>`;
  return { head, body };
}

async function fillStorageInfo() {
  const el = $('#storage-info');
  if (!el) return;
  const parts = [];
  try {
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      parts.push(p ? 'Dauerhaft gespeichert ✓' : (isIOS && !isStandalone() ? 'Nicht dauerhaft: App auf den Homescreen legen' : 'Browser darf bei Platzmangel löschen'));
    }
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      if (e.usage != null) parts.push(`${fmtBytes(e.usage)} belegt`);
    }
  } catch (_) { /* egal */ }
  parts.push(`${S.txs.length} Buchungen · ${S.receipts.length} Belege`);
  el.textContent = parts.join(' · ');
}

// ---------------------------------------------------------------- Buchung bearbeiten

function receiptsBlock(ownerType, ownerId) {
  const items = ownerId ? receiptsOf(ownerType, ownerId) : [];
  const pend = SH.pending || [];
  let h = '';
  for (const r of items) {
    const isImg = (r.mime || '').startsWith('image/');
    let inner = '<span class="pdf">PDF</span>';
    if (isImg) {
      const url = URL.createObjectURL(r.blob);
      SH.urls.push(url);
      inner = `<img src="${url}" alt="Beleg">`;
    }
    h += `<div class="receipt" data-act="rec-view" data-id="${esc(r.id)}">${inner}<button class="x" data-act="rec-del" data-id="${esc(r.id)}" aria-label="Beleg löschen">✕</button></div>`;
  }
  pend.forEach((p, i) => {
    let inner = '<span class="pdf">PDF</span>';
    if (p.mime.startsWith('image/')) {
      const url = URL.createObjectURL(p.blob);
      SH.urls.push(url);
      inner = `<img src="${url}" alt="Beleg">`;
    }
    h += `<div class="receipt">${inner}<button class="x" data-act="rec-del-pending" data-i="${i}" aria-label="Beleg entfernen">✕</button></div>`;
  });
  h += '<button class="receipt add" data-act="rec-add"><b>+</b>Beleg</button>';
  return `<div class="receipts" id="receipts">${h}</div>`;
}

function refreshReceipts() {
  const el = $('#receipts', sheetRoot);
  if (el && SH) el.outerHTML = receiptsBlock(SH.ownerType, SH.persisted ? SH.ownerId : null);
}

function openTx(id) {
  const t = S.txs.find((x) => x.id === id);
  if (!t) return;
  openTxForm(t, false);
}

function openTxForm(t, isNew) {
  const manual = isNew || t.source === 'manuell';
  const cbi = catById();
  const autoMonth = txMonth({ ...t, month: null }, S.settings, cbi);
  const hasRule = t.merchant && S.rules.find((r) => r.key === merchantKey(t.merchant));
  const twint = /twint/i.test(t.type || '');
  const inv = t.invoiceId ? S.invoices.find((i) => i.id === t.invoiceId) : null;
  const html = `${sheetHead(isNew ? 'Neuer Eintrag' : (t.merchant || 'Buchung'))}
    <form data-form="tx" autocomplete="off">
      ${manual ? `
        <div class="seg" data-seg="kind">
          <button type="button" class="${!isNew && t.amount > 0 ? '' : 'on'}" data-act="seg" data-v="aus">Ausgabe</button>
          <button type="button" class="${!isNew && t.amount > 0 ? 'on' : ''}" data-act="seg" data-v="ein">Einnahme</button>
        </div>
        <label class="field"><span>Betrag (CHF)</span><input class="input amount-input" name="amount" inputmode="decimal" placeholder="0.00" value="${isNew ? '' : esc(Math.abs(t.amount).toFixed(2))}" required></label>
        <div class="grid2">
          <label class="field"><span>Datum</span><input class="input" type="date" name="date" value="${esc(t.date || todayISO())}" required></label>
          <label class="field"><span>Bezahlt mit</span><select class="input" name="paidWith">
            ${['Kreditkarte', 'Debitkarte', 'Twint', 'Bar', 'Anderes'].map((p) => `<option${(t.paidWith || 'Kreditkarte') === p ? ' selected' : ''}>${p}</option>`).join('')}
          </select></label>
        </div>
        <label class="field"><span>Bezeichnung</span><input class="input" name="merchant" value="${esc(t.merchant || '')}" placeholder="z.B. Restaurant, Laden"></label>
        ${isNew ? '<p class="small muted" style="margin:-4px 2px 6px">Mit Debitkarte oder Twint bezahlt? Beim nächsten Import wird der Eintrag mit dem Auszug abgeglichen und zählt nicht doppelt.</p>' : ''}
      ` : `
        <div class="card card-pad" style="margin-top:4px">
          <div class="big num ${t.amount > 0 ? 'plus' : ''}" style="font-size:30px;font-weight:700">${chf(t.amount, { sign: true })}</div>
          <div class="small muted">${t.date !== t.bookDate ? `Kauftag ${fmtDate(t.date)} · gebucht ${fmtDate(t.bookDate)}` : fmtDate(t.date)}</div>
          <div class="lines">${(t.lines || [t.text]).map(esc).join('<br>')}</div>
        </div>
      `}
      <label class="field"><span>Kategorie</span>${catSelect('categoryId', t.categoryId)}</label>
      ${(!manual && t.merchant) ? `<label class="check"><input type="checkbox" name="learn" ${hasRule || twint ? '' : 'checked'}><span>Für «${esc(t.merchant || '')}» merken${hasRule ? ` <span class="muted small">(gemerkt: ${esc(catLabel(cbi[hasRule.categoryId], cbi) || '?')})</span>` : ''}${twint && !hasRule ? ' <span class="muted small">(TWINT von Personen besser nicht)</span>' : ''}</span></label>` : ''}
      <label class="field"><span>Monat</span><select class="input" name="month">${monthOptions(t.month || '', { emptyLabel: `Automatisch (${monthLabel(autoMonth)})` })}</select></label>
      <label class="field"><span>Notiz</span><textarea class="input" name="note" rows="2">${esc(t.note || '')}</textarea></label>
      <div class="field"><span>Belege</span>__RECEIPTS__</div>
      ${inv ? `<p class="small muted">Bezahlte Rechnung: <b>${esc(inv.name)}</b>${receiptsOf('invoice', inv.id).length ? ` · ${receiptsOf('invoice', inv.id).length} Beleg(e) bei der Rechnung` : ''}</p>` : ''}
      <div class="btnrow">
        ${isNew ? '' : '<button type="button" class="btn danger" data-act="tx-delete">Löschen</button>'}
        <button type="submit" class="btn">Speichern</button>
      </div>
    </form>`;
  const sheet = openSheet(html, { kind: 'tx', tx: t, isNew, ownerType: 'tx', ownerId: isNew ? uid('tx') : t.id, persisted: !isNew, pending: [] });
  sheet.innerHTML = sheet.innerHTML.replace('__RECEIPTS__', receiptsBlock('tx', SH.persisted ? SH.ownerId : null));
  if (isNew) setTimeout(() => { const a = $('input[name=amount]', sheet); if (a) a.focus(); }, 80);
}

async function saveTx(form) {
  const { tx, isNew, ownerId } = SH;
  const f = form.elements;
  const categoryId = f.categoryId.value && f.categoryId.value !== '__new' ? f.categoryId.value : null;
  const month = f.month.value || null;
  const note = f.note.value.trim();
  let t;
  if (isNew || tx.source === 'manuell') {
    const amt = parseAmount(f.amount.value);
    if (!(amt > 0)) { toast('Bitte einen Betrag eingeben.'); return; }
    const kind = $('[data-seg="kind"] .on', sheetRoot)?.dataset.v || 'aus';
    const date = f.date.value || todayISO();
    const merchant = cleanMerchant(f.merchant.value) || 'Eintrag';
    t = {
      ...(isNew ? { id: ownerId, source: 'manuell', created: nowISO() } : tx),
      date, bookDate: date, amount: kind === 'ein' ? amt : -amt, merchant, text: merchant,
      paidWith: f.paidWith.value, categoryId, month, note,
    };
  } else {
    t = { ...tx, categoryId, month, note };
  }
  const ops = [{ store: 'txs', type: 'put', value: t }];
  for (const p of SH.pending) {
    ops.push({ store: 'receipts', type: 'put', value: { id: uid('rc'), ownerType: 'tx', ownerId: t.id, blob: p.blob, mime: p.mime, name: p.name, size: p.blob.size, created: nowISO() } });
  }
  let extra = 0;
  const learn = !isNew && tx.source !== 'manuell' && f.learn && f.learn.checked && categoryId && t.merchant;
  if (learn) {
    const key = merchantKey(t.merchant);
    if (key) {
      ops.push({ store: 'rules', type: 'put', value: { key, categoryId, label: t.merchant } });
      for (const o of S.txs) {
        if (o.id !== t.id && !o.categoryId && merchantKey(o.merchant || o.text) === key) {
          ops.push({ store: 'txs', type: 'put', value: { ...o, categoryId } });
          extra++;
        }
      }
    }
  }
  await db.batch(ops);
  await load();
  closeSheet();
  render();
  toast(extra ? `Gespeichert. ${extra} weitere ${extra === 1 ? 'Buchung' : 'Buchungen'} zugeordnet.` : 'Gespeichert.');
}

async function deleteTx() {
  const { tx } = SH;
  if (!(await ask('Buchung löschen?', `«${esc(tx.merchant || tx.text)}» ${chf(tx.amount, { sign: true })} wird gelöscht. Wenn sie aus einem Import stammt, kommt sie beim nächsten Import desselben Auszugs wieder.`, 'Löschen', true))) return;
  const ops = [{ store: 'txs', type: 'del', key: tx.id }];
  for (const r of receiptsOf('tx', tx.id)) ops.push({ store: 'receipts', type: 'del', key: r.id });
  if (tx.invoiceId) {
    const inv = S.invoices.find((i) => i.id === tx.invoiceId);
    if (inv && inv.paidTxId === tx.id) ops.push({ store: 'invoices', type: 'put', value: { ...inv, status: 'offen', paidTxId: null, paidDate: null } });
  }
  await db.batch(ops);
  await load();
  closeSheet();
  render();
  toast('Gelöscht.');
}

// ---------------------------------------------------------------- Rechnungen bearbeiten

function openInvoiceForm(inv, isNew) {
  const i = inv || { name: '', amount: '', due: addDays(todayISO(), 30), categoryId: null, month: null, note: '' };
  const autoMonth = budgetMonthOf(i.due, S.settings.payday);
  const di = !isNew ? dueInfo(i) : null;
  const html = `${sheetHead(isNew ? 'Neue Rechnung' : 'Rechnung')}
    <form data-form="inv" autocomplete="off">
      ${!isNew && i.status === 'bezahlt' ? notice({ ico: '✅', kind: 'info', title: `Bezahlt am ${fmtDate(i.paidDate)}`, text: i.paidTxId ? 'Die Zahlung wurde im Kontoauszug gefunden.' : 'Von Hand als bezahlt markiert.' }) : ''}
      ${di && i.status === 'offen' ? `<p><span class="chip ${di.cls}">${esc(di.text)}</span></p>` : ''}
      <label class="field"><span>Wofür?</span><input class="input" name="name" value="${esc(i.name)}" placeholder="z.B. Galaxus Geschenke" required></label>
      <div class="grid2">
        <label class="field"><span>Betrag (CHF)</span><input class="input" name="amount" inputmode="decimal" value="${i.amount !== '' ? esc(Number(i.amount).toFixed(2)) : ''}" placeholder="0.00" required></label>
        <label class="field"><span>Fällig am</span><input class="input" type="date" name="due" value="${esc(i.due)}" required></label>
      </div>
      <label class="field"><span>Kategorie</span>${catSelect('categoryId', i.categoryId)}</label>
      <label class="field"><span>Zählt zum Monat (automatisch nach Fälligkeit)</span><select class="input" name="month">${monthOptions(i.month || '', { emptyLabel: `Automatisch (${monthLabel(autoMonth)})` })}</select></label>
      <label class="field"><span>Notiz</span><textarea class="input" name="note" rows="2">${esc(i.note || '')}</textarea></label>
      <div class="field"><span>Rechnung / Beleg</span>__RECEIPTS__</div>
      <div class="btnrow"><button type="submit" class="btn">${isNew ? 'Rechnung speichern' : 'Speichern'}</button></div>
      ${!isNew ? `<div class="btnrow">
        <button type="button" class="btn secondary" data-act="inv-ics">📅 In Kalender</button>
        ${i.status === 'offen' ? '<button type="button" class="btn secondary" data-act="inv-paid">✓ Bezahlt</button>' : '<button type="button" class="btn secondary" data-act="inv-reopen">Wieder offen</button>'}
      </div>
      <button type="button" class="btn ghost block" data-act="inv-delete" style="color:var(--minus)">Rechnung löschen</button>` : '<p class="small muted">Nach dem Speichern kannst du die Frist in deinen Kalender eintragen.</p>'}
    </form>`;
  const ownerId = isNew ? uid('inv') : i.id;
  const sheet = openSheet(html, { kind: 'inv', inv: i, isNew, ownerType: 'invoice', ownerId, persisted: !isNew, pending: [] });
  sheet.innerHTML = sheet.innerHTML.replace('__RECEIPTS__', receiptsBlock('invoice', SH.persisted ? ownerId : null));
}

async function saveInvoice(form) {
  const { inv, isNew, ownerId } = SH;
  const f = form.elements;
  const amount = parseAmount(f.amount.value);
  if (!(amount > 0)) { toast('Bitte einen Betrag eingeben.'); return; }
  const name = f.name.value.trim() || 'Rechnung';
  const catId = f.categoryId.value && f.categoryId.value !== '__new' ? f.categoryId.value : null;
  const rec = {
    ...(isNew ? { id: ownerId, status: 'offen', created: todayISO() } : inv),
    name, amount, due: f.due.value, categoryId: catId, month: f.month.value || null, note: f.note.value.trim(),
  };
  const ops = [{ store: 'invoices', type: 'put', value: rec }];
  for (const p of SH.pending) {
    ops.push({ store: 'receipts', type: 'put', value: { id: uid('rc'), ownerType: 'invoice', ownerId: rec.id, blob: p.blob, mime: p.mime, name: p.name, size: p.blob.size, created: nowISO() } });
  }
  await db.batch(ops);
  await load();
  if (isNew) {
    openInvoiceForm(S.invoices.find((x) => x.id === rec.id), false);
    toast('Gespeichert. Jetzt noch in den Kalender?', 'Kalender', () => openIcs(rec, chf(rec.amount)));
  } else {
    closeSheet();
    toast('Gespeichert.');
  }
  render();
}

// ---------------------------------------------------------------- Kategorien / Plan bearbeiten

function entryEditor(entries) {
  return entries.map((e, i) => `<div class="entry" data-i="${i}">
    <label class="field"><span>Bezeichnung (optional)</span><input class="input" data-k="label" value="${esc(e.label || '')}" placeholder="z.B. Steuern 2026, Raten, Geburtstag Anna"></label>
    <div class="grid2">
      <label class="field"><span>Betrag (CHF)</span><input class="input" data-k="amount" inputmode="decimal" value="${e.amount !== '' && e.amount != null ? esc(Number(e.amount).toFixed(2)) : ''}" placeholder="0.00"></label>
      <label class="field"><span>Rhythmus</span><select class="input" data-k="every">${RHYTHMS.map((r) => `<option value="${r.every}"${Number(e.every) === r.every ? ' selected' : ''}>${r.label}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">
      <label class="field"><span>${Number(e.every) === 0 ? 'Im Monat' : 'Ab'}</span><select class="input" data-k="start">${monthOptions(e.start, { short: true })}</select></label>
      <label class="field" ${Number(e.every) === 0 ? 'style="visibility:hidden"' : ''}><span>Bis</span><select class="input" data-k="end">${monthOptions(e.end || '', { emptyLabel: 'offen', short: true })}</select></label>
    </div>
    <button type="button" class="btn ghost small" data-act="entry-del" data-i="${i}" style="color:var(--minus);padding-left:0">Betrag entfernen</button>
  </div>`).join('');
}

function readEntries() {
  const out = [];
  sheetRoot.querySelectorAll('.entry').forEach((el) => {
    const i = Number(el.dataset.i);
    const old = SH.entries[i] || {};
    const g = (k) => el.querySelector(`[data-k="${k}"]`).value;
    out.push({
      ...old, label: g('label').trim(), amount: g('amount') === '' ? '' : parseAmount(g('amount')),
      every: Number(g('every')), start: g('start'), end: g('end') || null,
    });
  });
  return out;
}

function refreshEntries() {
  $('#entries', sheetRoot).innerHTML = entryEditor(SH.entries);
}

function openCategory(id, groupId) {
  const isNew = !id;
  const cbi = catById();
  const c = isNew ? { id: uid('cat'), name: '', group: groupId || 'alltag', order: 999, early: false, parentId: null } : cbi[id];
  if (!c) return;
  const kids = isNew ? [] : childCategories(S.categories, c.id);
  const parent = parentOf(c, cbi);
  const entries = S.plan.filter((e) => e.categoryId === c.id).map((e) => ({ ...e }));
  if (isNew) entries.push({ id: null, label: '', amount: '', every: 1, start: S.month, end: null });
  const parentOptions = GROUPS.map((g) => {
    const cs = topCategories(S.categories, g.id).filter((x) => x.id !== c.id);
    return cs.length ? `<optgroup label="${esc(g.name)}">${cs.map((x) => `<option value="${esc(x.id)}"${parent && parent.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const usedTx = isNew ? 0 : S.txs.filter((t) => t.categoryId === c.id).length;
  const html = `${sheetHead(isNew ? 'Neue Kategorie' : c.name)}
    <form data-form="cat" autocomplete="off">
      <label class="field"><span>Name</span><input class="input" name="name" value="${esc(c.name)}" required placeholder="z.B. Steuern, Geschenke, Dates"></label>
      <label class="field"><span>Gehört zu</span><select class="input" name="parentId" data-change="cat-parent" ${kids.length ? 'disabled' : ''}>
        <option value="">— eigene Hauptkategorie —</option>${parentOptions}</select></label>
      ${kids.length ? `<p class="small muted" style="margin:-6px 2px 8px">Hat Unterkategorien (${kids.map((k) => esc(k.name)).join(', ')}) und bleibt darum eine Hauptkategorie.</p>` : ''}
      <label class="field" data-groupfield ${parent ? 'style="display:none"' : ''}><span>Gruppe</span><select class="input" name="group">${GROUPS.map((g) => `<option value="${g.id}"${g.id === c.group ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <div class="section-title">Geplante Beträge</div>
      <div id="entries">${entryEditor(entries)}</div>
      <button type="button" class="btn secondary block" data-act="entry-add">+ Betrag hinzufügen</button>
      <p class="small muted" style="margin:8px 2px">Einmalige Sachen (z.B. Steuern 2026) als beschrifteten Betrag in einer festen Kategorie wie «Steuern» erfassen. Unterkategorien ohne eigenen Betrag teilen sich das Budget der Hauptkategorie.</p>
      <div class="section-title">Optionen</div>
      <label class="check"><input type="checkbox" name="food" ${S.settings.foodCategoryId === c.id ? 'checked' : ''}><span>🛒 Für die Lebensmittel-Auswertung verwenden<br><span class="small muted">Läden wie Migros, Coop, Denner, Lidl landen automatisch hier.</span></span></label>
      <label class="check"><input type="checkbox" name="early" ${c.early ? 'checked' : ''}><span>📅 Kommt um den Zahltag (Lohn, Miete)<br><span class="small muted">Zählt schon ab dem ${S.settings.earlyFrom}. zum nächsten Monat, falls der ${S.settings.payday}. auf ein Wochenende fällt.</span></span></label>
      <div class="btnrow"><button type="submit" class="btn">Speichern</button></div>
      ${isNew ? '' : `<div class="btnrow">
        <button type="button" class="btn secondary" data-act="cat-merge">Zusammenführen …</button>
        <button type="button" class="btn danger" data-act="cat-delete">Löschen</button>
      </div>
      <p class="small muted" style="margin:0 2px">${usedTx} ${usedTx === 1 ? 'Buchung' : 'Buchungen'} in dieser Kategorie.</p>`}
    </form>`;
  openSheet(html, { kind: 'cat', cat: c, isNew, entries });
}

async function saveCategory(form) {
  const { cat, isNew } = SH;
  const f = form.elements;
  const name = f.name.value.trim();
  if (!name) { toast('Bitte einen Namen eingeben.'); return; }
  const entries = readEntries().filter((e) => e.amount !== '' && !Number.isNaN(e.amount) && e.start);
  for (const e of entries) {
    if (e.end && ymDiff(e.start, e.end) < 0) { toast('«Bis» liegt vor «Ab». Bitte prüfen.'); return; }
  }
  const cbi = catById();
  const parentId = f.parentId.disabled ? null : (f.parentId.value || null);
  const group = parentId ? cbi[parentId].group : f.group.value;
  let order = cat.order;
  if (isNew || cat.group !== group || (cat.parentId || null) !== parentId) {
    const sib = parentId ? childCategories(S.categories, parentId) : S.categories.filter((x) => x.group === group && !x.parentId);
    const others = sib.filter((x) => x.id !== cat.id);
    order = others.length ? Math.max(...others.map((x) => x.order ?? 0)) + 1 : 0;
  }
  const c = { ...cat, name, group, parentId, early: f.early.checked, order };
  const ops = [{ store: 'categories', type: 'put', value: c }];
  // Unterkategorien wandern mit, wenn die Gruppe der Hauptkategorie ändert
  for (const k of childCategories(S.categories, c.id)) if (k.group !== group) ops.push({ store: 'categories', type: 'put', value: { ...k, group } });
  const keep = new Set();
  for (const e of entries) {
    const eid = e.id || uid('p');
    keep.add(eid);
    ops.push({ store: 'plan', type: 'put', value: { id: eid, categoryId: c.id, label: e.label || '', amount: round2(e.amount), every: Number(e.every), start: e.start, end: Number(e.every) === 0 ? null : (e.end || null) } });
  }
  for (const old of S.plan.filter((p) => p.categoryId === c.id)) if (!keep.has(old.id)) ops.push({ store: 'plan', type: 'del', key: old.id });
  await db.batch(ops);
  if (f.food.checked && S.settings.foodCategoryId !== c.id) await saveSettings({ foodCategoryId: c.id });
  if (!f.food.checked && S.settings.foodCategoryId === c.id) await saveSettings({ foodCategoryId: null });
  await load();
  closeSheet();
  render();
  toast('Gespeichert.');
}

async function deleteCategory() {
  const { cat } = SH;
  const used = S.txs.filter((t) => t.categoryId === cat.id).length + S.invoices.filter((i) => i.categoryId === cat.id).length;
  const kids = childCategories(S.categories, cat.id);
  let msg = used ? `${used} Buchungen/Rechnungen verlieren ihre Kategorie. Der Plan dieser Kategorie wird gelöscht.` : 'Der Plan dieser Kategorie wird gelöscht.';
  if (kids.length) msg += ` Die Unterkategorien (${kids.map((k) => esc(k.name)).join(', ')}) werden zu Hauptkategorien.`;
  msg += ' Tipp: Mit «Zusammenführen» bleiben Buchungen und Beträge erhalten.';
  if (!(await ask(`«${esc(cat.name)}» löschen?`, msg, 'Löschen', true))) return;
  const ops = [{ store: 'categories', type: 'del', key: cat.id }];
  for (const p of S.plan.filter((x) => x.categoryId === cat.id)) ops.push({ store: 'plan', type: 'del', key: p.id });
  for (const t of S.txs.filter((x) => x.categoryId === cat.id)) ops.push({ store: 'txs', type: 'put', value: { ...t, categoryId: null } });
  for (const i of S.invoices.filter((x) => x.categoryId === cat.id)) ops.push({ store: 'invoices', type: 'put', value: { ...i, categoryId: null } });
  for (const r of S.rules.filter((x) => x.categoryId === cat.id)) ops.push({ store: 'rules', type: 'del', key: r.key });
  for (const k of kids) ops.push({ store: 'categories', type: 'put', value: { ...k, parentId: null } });
  await db.batch(ops);
  if (S.settings.foodCategoryId === cat.id) await saveSettings({ foodCategoryId: null });
  await load();
  closeSheet();
  render();
  toast('Kategorie gelöscht.');
}

function openMerge() {
  const { cat } = SH;
  const exclude = idsWithChildren(cat.id);
  const nPlan = S.plan.filter((e) => e.categoryId === cat.id).length;
  const nTx = S.txs.filter((t) => t.categoryId === cat.id).length;
  const nInv = S.invoices.filter((i) => i.categoryId === cat.id).length;
  const html = `${sheetHead(`«${cat.name}» zusammenführen`)}
    <form data-form="merge">
      <p class="small muted" style="margin:0 2px 8px">Alles aus «${esc(cat.name)}» wandert in die Kategorie, die du hier wählst: ${nPlan} ${nPlan === 1 ? 'Betrag' : 'Beträge'} (mit Bezeichnung «${esc(cat.name)}»), ${nTx} Buchungen${nInv ? `, ${nInv} Rechnungen` : ''} und gelernte Läden. Danach wird «${esc(cat.name)}» gelöscht.</p>
      <label class="field"><span>Zusammenführen mit</span><select class="input" name="target" required>${catOptions(null, '— Kategorie wählen —', { allowNew: false, exclude })}</select></label>
      <p class="small muted" style="margin:0 2px">Beispiel: «Steuern 2025» mit «Steuern» zusammenführen. Im Plan steht dann bei «Steuern» der Betrag «Steuern 2025 · 900 im Dez».</p>
      <div class="btnrow"><button type="button" class="btn secondary" data-act="cat-open" data-id="${esc(cat.id)}">Zurück</button><button type="submit" class="btn">Zusammenführen</button></div>
    </form>`;
  openSheet(html, { kind: 'merge', cat });
}

async function doMerge(form) {
  const { cat } = SH;
  const target = form.elements.target.value;
  if (!target) { toast('Bitte eine Kategorie wählen.'); return; }
  const { ops, counts, settingsPatch } = mergeCategoryOps(data(), cat.id, target);
  await db.batch(ops);
  if (settingsPatch) await saveSettings(settingsPatch);
  const toName = catLabel(catById()[target]);
  await load();
  closeSheet();
  render();
  toast(`Zusammengeführt in «${toName}»: ${counts.plan} ${counts.plan === 1 ? 'Betrag' : 'Beträge'}, ${counts.txs} ${counts.txs === 1 ? 'Buchung' : 'Buchungen'}.`);
}

// ---------------------------------------------------------------- Import

async function handlePdf(file) {
  openSheet(`${sheetHead('Auszug wird gelesen')}<div class="empty"><div class="big">⏳</div>Das PDF wird auf diesem Gerät gelesen. Es wird nirgends hochgeladen.</div>`);
  try {
    const { pdfToPages } = await import('./pdf-import.js');
    const pages = await pdfToPages(file);
    const res = parseLukb(pages);
    if (!res.txs.length) {
      openSheet(`${sheetHead('Keine Buchungen gefunden')}
        ${notice({ ico: '🤔', kind: 'red', title: 'Die App konnte in diesem PDF keine Buchungen lesen.', text: 'Ist es der Kontoauszug aus dem LUKB E-Banking (Vermögen → Kontoauszug → Exportieren)? Unten siehst du, was die App gelesen hat. Das bleibt alles auf deinem Gerät.' })}
        <details><summary>Was die App gelesen hat</summary><div class="diag">${esc(res.diagnostics.slice(0, 80).join('\n'))}</div></details>
        <button class="btn block" data-act="sheet-close" style="margin-top:12px">Schliessen</button>`);
      return;
    }
    const prep = prepareImport(res.txs, data(), S.settings);
    openImport({ res, prep, fileName: file.name });
  } catch (e) {
    console.error(e);
    openSheet(`${sheetHead('Import fehlgeschlagen')}${notice({ ico: '⚠️', kind: 'red', title: 'Das PDF konnte nicht gelesen werden.', text: esc(e.message || String(e)) })}<button class="btn block" data-act="sheet-close">Schliessen</button>`);
  }
}

function impRow(f, i) {
  const learnable = !!merchantKey(f.merchant);
  const meta = [fmtDate(f.date), esc(f.type || '')];
  if (f.matchManualId) meta.push('✓ mit Handeintrag abgeglichen');
  if (f.matchInvoiceId) meta.push('✓ Rechnung bezahlt');
  if (f.suggestSource === 'regel') meta.push('gemerkt');
  if (f.suggestSource === 'laden') meta.push('Laden erkannt');
  return `<div class="imp-row ${f.categoryId ? '' : 'need'}" data-i="${i}">
    <div class="imp-top"><span class="m">${esc(f.merchant || f.type)}</span><span class="amount ${f.amount > 0 ? 'plus' : ''}">${chf(f.amount, { sign: true })}</span></div>
    <div class="meta">${meta.join(' · ')}</div>
    ${catSelect('', f.categoryId, { noneLabel: '— Kategorie wählen —', attrs: `data-change="imp-cat" data-i="${i}"` })}
    ${learnable ? `<label class="check small" style="margin:6px 2px 0"><input type="checkbox" data-change="imp-learn" data-i="${i}" ${f.learn ? 'checked' : ''}><span>Laden merken</span></label>` : ''}
  </div>`;
}

function openImport(ctx) {
  const { res, prep, fileName } = ctx;
  const fresh = prep.fresh;
  const need = fresh.map((f, i) => [f, i]).filter(([f]) => !f.categoryId);
  const auto = fresh.map((f, i) => [f, i]).filter(([f]) => f.categoryId);
  const chk = res.check;
  let checkHtml = '';
  if (chk.checked > 0) {
    checkHtml = chk.mismatches === 0
      ? notice({ ico: '✅', kind: 'info', title: 'Saldo-Prüfung bestanden', text: `Alle ${chk.checked} Beträge passen zum Saldo im Auszug.` })
      : notice({ ico: '⚠️', title: `${chk.mismatches} Beträge passen nicht zum Saldo`, text: 'Vielleicht wurde eine Zeile nicht richtig gelesen. Vergleiche die Liste kurz mit dem PDF.' });
  }
  const html = `${sheetHead('Auszug importieren')}
    <p class="small muted" style="margin:0 2px">${esc(fileName || '')}</p>
    <div class="stat-grid">
      <div class="stat"><div class="k">Neue Buchungen</div><div class="v">${fresh.length}</div></div>
      <div class="stat"><div class="k">Schon importiert</div><div class="v">${prep.duplicates}</div></div>
    </div>
    ${checkHtml}
    ${prep.matchedManual ? notice({ ico: '🔗', kind: 'info', title: `${prep.matchedManual} ${prep.matchedManual === 1 ? 'Handeintrag' : 'Handeinträge'} abgeglichen`, text: 'Diese zählen nicht doppelt. Notizen und Belege werden übernommen.' }) : ''}
    ${prep.matchedInvoices ? notice({ ico: '🧾', kind: 'info', title: `${prep.matchedInvoices} ${prep.matchedInvoices === 1 ? 'Rechnung' : 'Rechnungen'} als bezahlt erkannt` }) : ''}
    ${!fresh.length ? '<div class="empty"><div class="big">👍</div>Nichts Neues. Dieser Auszug ist schon importiert.</div><button class="btn block" data-act="sheet-close">Schliessen</button>' : `
      ${need.length ? `<div class="section-title">Bitte zuordnen (${need.length})</div><p class="small muted" style="margin:0 4px 6px">Was du hier zuordnest, merkt sich die App für das nächste Mal. TWINT von Personen merkt sie sich nicht automatisch.</p><div class="list">${need.map(([f, i]) => impRow(f, i)).join('')}</div>` : ''}
      ${auto.length ? `<div class="section-title">Automatisch zugeordnet (${auto.length})</div><div class="list">${auto.map(([f, i]) => impRow(f, i)).join('')}</div>` : ''}
      <div class="btnrow" style="position:sticky;bottom:0;background:var(--bg);padding:10px 0 4px;margin-bottom:0">
        <button class="btn secondary" data-act="sheet-close">Abbrechen</button>
        <button class="btn" data-act="import-confirm">${fresh.length} importieren</button>
      </div>`}`;
  openSheet(html, { kind: 'import', ...ctx }, { full: true });
}

async function confirmImport() {
  const { prep } = SH;
  const now = nowISO();
  const ops = [];
  const cbi = catById();
  const months = new Map();
  for (const f of prep.fresh) {
    const tx = {
      id: uid('tx'), source: 'import', importKey: f.importKey, ref: f.ref, date: f.date, bookDate: f.bookDate,
      amount: f.amount, saldo: f.saldo, type: f.type, merchant: f.merchant, text: f.text, lines: f.lines,
      categoryId: f.categoryId || null, note: '', importedAt: now, month: null,
    };
    if (f.matchManualId) {
      const m = S.txs.find((x) => x.id === f.matchManualId);
      if (m) {
        tx.note = [m.note, m.merchant && m.merchant !== f.merchant ? `Eintrag: ${m.merchant}` : ''].filter(Boolean).join(' · ');
        tx.month = m.month || null;
        tx.matchedFrom = m.id;
        for (const r of receiptsOf('tx', m.id)) ops.push({ store: 'receipts', type: 'put', value: { ...r, ownerId: tx.id } });
        ops.push({ store: 'txs', type: 'del', key: m.id });
      }
    }
    if (f.matchInvoiceId) {
      const inv = S.invoices.find((x) => x.id === f.matchInvoiceId);
      if (inv) {
        ops.push({ store: 'invoices', type: 'put', value: { ...inv, status: 'bezahlt', paidTxId: tx.id, paidDate: tx.date } });
        tx.invoiceId = inv.id;
      }
    }
    if (f.userSet && f.learn && f.categoryId) {
      const key = merchantKey(f.merchant);
      if (key) ops.push({ store: 'rules', type: 'put', value: { key, categoryId: f.categoryId, label: f.merchant } });
    }
    ops.push({ store: 'txs', type: 'put', value: tx });
    const k = txMonth(tx, S.settings, cbi);
    months.set(k, (months.get(k) || 0) + 1);
  }
  await db.batch(ops);
  await load();
  const n = prep.fresh.length;
  const best = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) S.month = best[0];
  closeSheet();
  S.tab = 'uebersicht';
  render();
  window.scrollTo(0, 0);
  toast(`${n} Buchungen importiert.`, 'Backup erstellen', () => startBackup(), 6000);
}

// ---------------------------------------------------------------- Lebensmittel

function openFood() {
  const fs = foodStats(data(), todayISO(), brandOf);
  const cbi = catById();
  let html = sheetHead('Lebensmittel');
  if (!fs) {
    html += '<div class="empty">Noch keine Kategorie für Lebensmittel gewählt.<br>Im Plan bei «Essen» die Option 🛒 einschalten.</div>';
  } else if (!fs.months.length) {
    html += `<div class="empty"><div class="big">🛒</div>Nach dem ersten Import siehst du hier, wie viel du pro Monat für Lebensmittel ausgibst, aufgeteilt nach Laden.<br><br>Gezählt wird alles in der Kategorie «${esc(cbi[fs.categoryId]?.name || '')}».</div>`;
  } else {
    const planNow = planForCategory(S.plan, fs.categoryId, currentMonth());
    const maxB = Math.max(...fs.brands.map((b) => b.avg), 1);
    html += `<div class="stat-grid">
        <div class="stat"><div class="k">Ø pro Monat</div><div class="v num">${chf(fs.avg)}</div></div>
        <div class="stat"><div class="k">Dein Plan</div><div class="v num">${planNow ? chf(planNow) : '–'}</div></div>
      </div>
      <p class="small muted" style="margin:0 4px">${fs.avgFromClosed ? `Aus ${fs.avgBasis} abgeschlossenen ${fs.avgBasis === 1 ? 'Monat' : 'Monaten'}.` : 'Noch kein Monat abgeschlossen, der Wert ist vorläufig.'}
      ${planNow && fs.avg > planNow ? ` Du liegst im Schnitt <b class="minus">${chf(fs.avg - planNow)}</b> über dem Plan.` : ''}${planNow && fs.avg <= planNow ? ' Du liegst im Plan. 👍' : ''}</p>
      <div class="section-title">Nach Laden (Ø pro Monat)</div>
      <div class="card">${fs.brands.map((b) => `<div class="cat"><div class="cat-row"><span class="cat-name">${esc(b.brand)}</span><span class="cat-val num">${chf(b.avg)}</span></div><div class="bar"><i style="width:${((b.avg / maxB) * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>
      <div class="section-title">Pro Monat</div>
      <div class="list">${fs.months.map((m) => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(monthLabel(m.key))}</div><div class="sub">${m.count} Einkäufe${m.closed ? '' : ' · läuft noch'}</div></div><div class="right num">${chf(m.total)}</div></div>`).join('')}</div>
      <p class="small muted" style="margin:6px 4px">Gezählt wird alles in der Kategorie «${esc(cbi[fs.categoryId]?.name || '')}». Shampoo aus der Migros zählt mit, weil der Auszug nur den Gesamtbetrag kennt.</p>`;
  }
  openSheet(html, { kind: 'food' }, { full: true });
}

// ---------------------------------------------------------------- Einstellungen, Regeln, Hilfe

function openSettings() {
  const s = S.settings;
  const html = `${sheetHead('Budgetmonat & Übertrag')}
    <form data-form="settings">
      <label class="field"><span>Zahltag (Budgetmonat beginnt an diesem Tag)</span><select class="input" name="payday">${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}"${d === Number(s.payday) ? ' selected' : ''}>${d}. ${d === 1 ? '(Kalendermonat)' : ''}</option>`).join('')}</select></label>
      <p class="small muted" style="margin:-4px 2px 8px">Beispiel: Zahltag 25. → «Januar» geht vom 25.12. bis 24.01. Der Lohn vom 25.12. ist dein Januar-Geld.</p>
      <label class="field"><span>Lohn & Miete zählen schon ab dem</span><select class="input" name="earlyFrom">${Array.from({ length: 27 }, (_, i) => i + 1).map((d) => `<option value="${d}"${d === Number(s.earlyFrom) ? ' selected' : ''}>${d}.</option>`).join('')}</select></label>
      <p class="small muted" style="margin:-4px 2px 8px">Falls der Lohn früher kommt (Wochenende, Weihnachten). Gilt nur für Kategorien mit 📅.</p>
      <label class="field"><span>Erster Budgetmonat</span><select class="input" name="startMonth">${monthOptions(s.startMonth || currentMonth())}</select></label>
      <label class="field"><span>Übertrag in den ersten Monat (CHF)</span><input class="input" name="startCarry" inputmode="decimal" value="${esc(Number(s.startCarry || 0).toFixed(2))}"></label>
      <label class="field"><span>Notiz zum Übertrag</span><input class="input" name="startCarryNote" value="${esc(s.startCarryNote || '')}" placeholder="z.B. Kontostand am 24.11."></label>
      <button type="submit" class="btn block">Speichern</button>
    </form>`;
  openSheet(html, { kind: 'settings' });
}

async function saveSettingsForm(form) {
  const f = form.elements;
  const carry = parseAmount(f.startCarry.value);
  const payday = Number(f.payday.value);
  let earlyFrom = Number(f.earlyFrom.value);
  if (earlyFrom > payday) earlyFrom = payday;
  await saveSettings({ payday, earlyFrom, startMonth: f.startMonth.value, startCarry: Number.isNaN(carry) ? 0 : carry, startCarryNote: f.startCarryNote.value.trim() });
  closeSheet();
  render();
  toast('Gespeichert.');
}

function openRules() {
  const cbi = catById();
  const rules = [...S.rules].sort((a, b) => (a.label || a.key).localeCompare(b.label || b.key, 'de'));
  const html = `${sheetHead('Gelernte Läden')}
    <p class="small muted" style="margin:0 2px 10px">Wenn du eine Buchung zuordnest und «merken» anlässt, ordnet die App diesen Laden beim nächsten Import automatisch zu. Bekannte Lebensmittelläden (Migros, Coop, Denner, Lidl …) erkennt sie auch ohne Regel.</p>
    ${rules.length ? `<div class="list">${rules.map((r) => `<div class="row" style="cursor:default"><div class="main"><div class="title">${esc(r.label || r.key)}</div><div class="sub">→ ${esc(catLabel(cbi[r.categoryId], cbi) || 'gelöschte Kategorie')}</div></div><button class="btn ghost small" data-act="rule-del" data-key="${esc(r.key)}" style="color:var(--minus)">Löschen</button></div>`).join('')}</div>` : '<div class="empty">Noch nichts gemerkt.</div>'}`;
  openSheet(html, { kind: 'rules' });
}

function openInstallHelp() {
  const html = `${sheetHead('Auf den Homescreen legen')}
    <div class="card card-pad">
      <strong>iPhone (Safari)</strong>
      <ol style="padding-left:20px;margin:8px 0">
        <li>Diese Seite in <b>Safari</b> öffnen.</li>
        <li>Auf die <b>drei Punkte</b> rechts neben der Adressleiste tippen, dann <b>Teilen</b>. (Ältere iOS-Versionen: direkt der Teilen-Knopf unten.)</li>
        <li>Nach unten scrollen und <b>Zum Home-Bildschirm</b> wählen. «Als Web-App öffnen» eingeschaltet lassen.</li>
        <li>Die App ab jetzt immer <b>vom Homescreen</b> öffnen.</li>
      </ol>
      <p class="small muted" style="margin:0">Wichtig: Die Homescreen-App hat ihren eigenen Speicher, getrennt von Safari. Lade deine Startdatei oder dein Backup erst in der Homescreen-App. Dort löscht iOS die Daten auch nicht nach 7 Tagen.</p>
    </div>
    <div class="card card-pad">
      <strong>PC (Chrome oder Firefox)</strong>
      <p class="small" style="margin:6px 0 0">Einfach die Adresse als Lesezeichen speichern. Um deine Daten vom iPhone zu sehen: auf dem iPhone ein Backup erstellen, per AirDrop an den PC schicken und hier unter «Mehr → Backup laden» öffnen.</p>
    </div>`;
  openSheet(html, { kind: 'help' });
}

// ---------------------------------------------------------------- Backup

async function exportPayload() {
  const receipts = [];
  for (const r of S.receipts) {
    receipts.push({ id: r.id, ownerType: r.ownerType, ownerId: r.ownerId, mime: r.mime, name: r.name, size: r.size, created: r.created, b64: await blobToB64(r.blob) });
  }
  return {
    exportedAt: nowISO(),
    appVersion: VERSION,
    settings: { ...S.settings },
    categories: S.categories,
    plan: S.plan,
    txs: S.txs,
    invoices: S.invoices,
    rules: S.rules,
    receipts,
  };
}

async function startBackup() {
  const pw = await askPassword('Backup erstellen', 'Das Backup wird mit diesem Passwort verschlüsselt. <b>Ohne Passwort ist das Backup wertlos</b>, niemand kann es zurücksetzen. Speichere es im Schlüsselbund oder Passwort-Manager.', { confirm: true, okLabel: 'Verschlüsseln' });
  if (!pw) return;
  openSheet(`${sheetHead('Backup')}<div class="empty"><div class="big">🔐</div>Wird verschlüsselt …</div>`);
  try {
    const payload = await exportPayload();
    const file = await encryptPayload(payload, pw);
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const name = backupFileName().replace(/\.budget$/, '.json');
    openSheet(`${sheetHead('Backup ist bereit')}
      <div class="empty" style="padding:16px 10px"><div class="big">✅</div><b>${esc(name)}</b><br><span class="small">${fmtBytes(blob.size)} · ${S.txs.length} Buchungen · ${S.receipts.length} Belege</span></div>
      <p class="small muted">Sichere die Datei in «Dateien» (iCloud Drive) oder schick sie per AirDrop an deinen PC. Sie ist verschlüsselt, also egal wo sie liegt.</p>
      <button class="btn block" data-act="backup-save">Datei sichern</button>`, { kind: 'backup', blob, name });
  } catch (e) {
    console.error(e);
    openSheet(`${sheetHead('Backup fehlgeschlagen')}${notice({ ico: '⚠️', kind: 'red', title: 'Fehler', text: esc(e.message || String(e)) })}`);
  }
}

async function saveBackupFile() {
  const { blob, name } = SH;
  const res = await deliverFile(blob, name);
  if (res !== 'abgebrochen') {
    await saveSettings({ lastBackup: nowISO() });
    closeSheet();
    render();
    toast(res === 'geteilt' ? 'Backup gesichert.' : 'Backup heruntergeladen.');
  }
}

async function handleDataFile(file) {
  try {
    const text = await file.text();
    const info = inspectFile(text);
    let payload;
    if (info.encrypted) {
      const pw = await askPassword('Backup öffnen', 'Gib das Passwort ein, mit dem du dieses Backup erstellt hast.', { okLabel: 'Öffnen' });
      if (!pw) return;
      payload = await decryptFile(info.file, pw);
    } else {
      payload = info.payload;
    }
    const cnt = `${(payload.categories || []).length} Kategorien, ${(payload.txs || []).length} Buchungen, ${(payload.receipts || []).length} Belege`;
    const when = payload.exportedAt ? ` (Stand ${fmtDate(payload.exportedAt.slice(0, 10))})` : '';
    if (S.categories.length || S.txs.length) {
      const ok = await ask('Daten ersetzen?', `Alle Daten auf diesem Gerät werden durch die Datei ersetzt${esc(when)}: ${esc(cnt)}.`, 'Ersetzen', true);
      if (!ok) return;
    }
    await importPayload(payload);
    toast(`Geladen: ${cnt}.`);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Datei konnte nicht geladen werden.');
  }
}

async function importPayload(p) {
  const ops = db.STORES.map((s) => ({ store: s, type: 'clear' }));
  for (const [key, value] of Object.entries(p.settings || {})) ops.push({ store: 'settings', type: 'put', value: { key, value } });
  for (const s of ['categories', 'plan', 'txs', 'invoices', 'rules']) {
    for (const v of p[s] || []) ops.push({ store: s, type: 'put', value: v });
  }
  for (const r of p.receipts || []) {
    const { b64, ...rest } = r;
    ops.push({ store: 'receipts', type: 'put', value: { ...rest, blob: b64ToBlob(b64, r.mime) } });
  }
  await db.batch(ops);
  S.month = null;
  await load();
  S.tab = 'heute';
  closeSheet(true);
  render();
  requestPersist();
}

async function startEmpty() {
  const cur = currentMonth();
  const cats = [
    { id: 'lohn', group: 'einnahmen', name: 'Lohn', order: 0, early: true },
    { id: 'miete', group: 'fixkosten', name: 'Miete', order: 0, early: true },
    { id: 'krankenkasse', group: 'fixkosten', name: 'Krankenkasse', order: 1 },
    { id: 'handy', group: 'fixkosten', name: 'Handy', order: 2 },
    { id: 'steuern', group: 'fixkosten', name: 'Steuern', order: 3 },
    { id: 'essen', group: 'alltag', name: 'Essen', order: 0 },
    { id: 'freizeit', group: 'alltag', name: 'Freizeit', order: 1 },
    { id: 'geschenke', group: 'einmalig', name: 'Geschenke', order: 0 },
    { id: 'reisen', group: 'einmalig', name: 'Reisen', order: 1 },
    { id: 'sparen', group: 'sparen', name: 'Sparen', order: 0 },
  ];
  await db.batch(cats.map((c) => ({ store: 'categories', type: 'put', value: c })));
  await saveSettings({ ...DEFAULT_SETTINGS, startMonth: cur, foodCategoryId: 'essen' });
  S.month = null;
  await load();
  S.tab = 'plan';
  render();
  requestPersist();
  toast('Los geht\'s: Trag im Plan deine Beträge ein.');
}

async function wipe() {
  if (!(await ask('Alle Daten löschen?', 'Plan, Buchungen, Rechnungen und Belege auf diesem Gerät werden gelöscht. Mach vorher ein Backup, wenn du sie behalten willst.', 'Weiter', true))) return;
  if (!(await ask('Wirklich alles löschen?', 'Das kann nicht rückgängig gemacht werden.', 'Endgültig löschen', true))) return;
  await db.clearAll();
  S.month = null;
  await load();
  S.tab = 'heute';
  render();
  toast('Alle Daten gelöscht.');
}

function requestPersist() {
  try {
    // Firefox würde jedes Mal nachfragen; dort ist es nur die Kopie zum Anschauen
    if (/Firefox\//.test(navigator.userAgent)) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (_) { /* egal */ }
}

// ---------------------------------------------------------------- Belege

let receiptTarget = null;

async function handleReceiptFiles(files) {
  if (!SH || !files.length) return;
  const ctx = SH;
  for (const file of files) {
    try {
      const prep = await prepareReceipt(file);
      if (ctx.persisted) {
        const rec = { id: uid('rc'), ownerType: ctx.ownerType, ownerId: ctx.ownerId, blob: prep.blob, mime: prep.mime, name: prep.name, size: prep.blob.size, created: nowISO() };
        await db.put('receipts', rec);
        S.receipts.push(rec);
      } else {
        ctx.pending.push(prep);
      }
    } catch (e) {
      toast(e.message || 'Beleg konnte nicht gelesen werden.');
    }
  }
  if (SH === ctx) refreshReceipts();
  if (ctx.persisted) toast('Beleg gespeichert.');
  render();
}

function viewReceipt(id) {
  const r = S.receipts.find((x) => x.id === id);
  if (!r) return;
  const url = URL.createObjectURL(r.blob);
  if ((r.mime || '').startsWith('image/')) {
    const v = document.createElement('div');
    v.className = 'viewer';
    v.innerHTML = `<img src="${url}" alt="Beleg"><button class="close" aria-label="Schliessen">✕</button>`;
    v.addEventListener('click', () => { v.remove(); URL.revokeObjectURL(url); });
    document.body.appendChild(v);
  } else {
    const w = window.open(url, '_blank');
    if (!w) deliverFile(r.blob, r.name || 'Beleg.pdf');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

// ---------------------------------------------------------------- Aktionen

function gotoTab(tab) {
  S.tab = tab;
  if (tab !== 'buchungen') S.txFilter = 'alle';
  render();
  window.scrollTo(0, 0);
}

const ACTIONS = {
  'tab': (el) => gotoTab(el.dataset.tab),
  'open-invoices': () => { if (S.tab !== 'rechnungen') S.backTab = S.tab; closeSheet(true); gotoTab('rechnungen'); },
  'goto-month': (el) => { S.month = el.dataset.month || currentMonth(); gotoTab('uebersicht'); },
  'month-prev': () => { S.month = ymAdd(S.month, -1); render(); },
  'month-next': () => { S.month = ymAdd(S.month, 1); render(); },
  'month-today': () => { S.month = currentMonth(); render(); },
  'goto-unc': () => { S.tab = 'buchungen'; S.txFilter = 'ohne'; render(); window.scrollTo(0, 0); },
  'cat-txs': (el) => { if (el.dataset.month) S.month = el.dataset.month; S.tab = 'buchungen'; S.txFilter = 'cat:' + el.dataset.id; render(); window.scrollTo(0, 0); },
  'tx-filter': (el) => { S.txFilter = el.dataset.f; render(); },
  'tx-open': (el) => openTx(el.dataset.id),
  'tx-new': () => openTxForm({ source: 'manuell', date: todayISO(), amount: 0 }, true),
  'tx-delete': () => deleteTx(),
  'seg': (el) => { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); },
  'inv-new': () => openInvoiceForm(null, true),
  'inv-open': (el) => openInvoiceForm(S.invoices.find((i) => i.id === el.dataset.id), false),
  'inv-ics': () => { const i = SH.inv; openIcs(i, chf(i.amount)); },
  'inv-paid': async () => {
    const i = SH.inv;
    await db.put('invoices', { ...i, status: 'bezahlt', paidDate: todayISO(), paidTxId: null });
    await load(); closeSheet(); render(); toast('Als bezahlt markiert.');
  },
  'inv-reopen': async () => {
    const i = SH.inv;
    await db.put('invoices', { ...i, status: 'offen', paidDate: null, paidTxId: null });
    await load(); closeSheet(); render(); toast('Wieder offen.');
  },
  'inv-delete': async () => {
    const i = SH.inv;
    if (!(await ask('Rechnung löschen?', `«${esc(i.name)}» wird gelöscht.`, 'Löschen', true))) return;
    const ops = [{ store: 'invoices', type: 'del', key: i.id }];
    for (const r of receiptsOf('invoice', i.id)) ops.push({ store: 'receipts', type: 'del', key: r.id });
    await db.batch(ops); await load(); closeSheet(); render(); toast('Gelöscht.');
  },
  'cat-open': (el) => openCategory(el.dataset.id),
  'cat-new': (el) => openCategory(null, el.dataset.group),
  'cat-delete': () => deleteCategory(),
  'cat-merge': () => openMerge(),
  'entry-add': () => { SH.entries = readEntries(); SH.entries.push({ id: null, label: '', amount: '', every: 1, start: S.month, end: null }); refreshEntries(); },
  'entry-del': (el) => { SH.entries = readEntries(); SH.entries.splice(Number(el.dataset.i), 1); refreshEntries(); },
  'import-pdf': () => { const i = $('#file-pdf'); i.value = ''; i.click(); },
  'import-confirm': () => confirmImport(),
  'food': () => openFood(),
  'settings': () => openSettings(),
  'rules': () => openRules(),
  'rule-del': async (el) => { await db.del('rules', el.dataset.key); await load(); openRules(); render(); },
  'help-install': () => openInstallHelp(),
  'reminders': async () => { openReminders(MID_DAY, S.settings.payday); await saveSettings({ remindersAdded: true }); render(); toast('Termine geöffnet. Im Kalender auf «Alle hinzufügen» tippen.'); },
  'backup': () => startBackup(),
  'backup-save': () => saveBackupFile(),
  'data-load': () => { const i = $('#file-data'); i.value = ''; i.click(); },
  'start-empty': () => startEmpty(),
  'wipe': () => wipe(),
  'sheet-close': () => closeSheet(),
  'rec-add': () => { receiptTarget = SH; const i = $('#file-receipt'); i.value = ''; i.click(); },
  'rec-view': (el, e) => { if (e.target.closest('.x')) return; viewReceipt(el.dataset.id); },
  'rec-del': async (el, e) => {
    e.stopPropagation();
    if (!(await ask('Beleg löschen?', 'Der Beleg wird von diesem Gerät gelöscht.', 'Löschen', true))) return;
    await db.del('receipts', el.dataset.id);
    S.receipts = S.receipts.filter((r) => r.id !== el.dataset.id);
    refreshReceipts();
    render();
  },
  'rec-del-pending': (el, e) => { e.stopPropagation(); SH.pending.splice(Number(el.dataset.i), 1); refreshReceipts(); },
};

const CHANGES = {
  'imp-cat': (el) => {
    const f = SH.prep.fresh[Number(el.dataset.i)];
    f.categoryId = el.value || null;
    f.userSet = true;
    el.closest('.imp-row').classList.toggle('need', !f.categoryId);
  },
  'imp-learn': (el) => { SH.prep.fresh[Number(el.dataset.i)].learn = el.checked; },
  'cat-parent': (el) => {
    const gf = $('[data-groupfield]', sheetRoot);
    if (gf) gf.style.display = el.value ? 'none' : '';
  },
};

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('sheet-overlay') && e.target.parentElement === sheetRoot) {
    closeSheet();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) {
    e.preventDefault();
    Promise.resolve(fn(el, e)).catch((err) => { console.error(err); toast(err.message || 'Fehler'); });
  }
});

document.addEventListener('change', (e) => {
  // "+ Neue Kategorie" in jeder Kategorie-Auswahl
  if (e.target.matches && e.target.matches('select[data-catsel]')) {
    const sel = e.target;
    if (sel.value === '__new') {
      sel.value = sel.dataset.prev || '';
      askNewCategory().then((id) => {
        if (!id) return;
        refreshCatSelects(sel, id);
        const ch = sel.dataset.change;
        if (ch && CHANGES[ch]) CHANGES[ch](sel);
      });
      return;
    }
    sel.dataset.prev = sel.value;
  }
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
  // Rhythmus "einmalig" blendet "Bis" aus
  if (e.target.matches && e.target.matches('.entry [data-k="every"]') && SH && SH.kind === 'cat') {
    SH.entries = readEntries();
    refreshEntries();
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fn = { tx: saveTx, inv: saveInvoice, cat: saveCategory, settings: saveSettingsForm, merge: doMerge }[form.dataset.form];
  if (fn) Promise.resolve(fn(form)).catch((err) => { console.error(err); toast(err.message || 'Fehler beim Speichern'); });
});

$('#file-pdf').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) handlePdf(f); });
$('#file-data').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) handleDataFile(f); });
$('#file-receipt').addEventListener('change', (e) => {
  const files = [...e.target.files];
  if (receiptTarget && receiptTarget === SH) handleReceiptFiles(files);
  receiptTarget = null;
});

// Beim Zurückkommen in die App (z.B. am nächsten Tag) neu zeichnen
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.loaded && !SH) render();
});

// ---------------------------------------------------------------- Start

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const ok = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!ok) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update && reg.update()).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Neue Version ist da.', 'Neu laden', () => location.reload(), 8000);
  });
}

async function init() {
  try {
    await load();
    if (S.categories.length) requestPersist();
    render();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><div class="big">⚠️</div>Die Daten konnten nicht geladen werden.<br><span class="small">${esc(e.message || String(e))}</span></div>`;
  }
  registerSW();
}

window.__budget = { S, load, render }; // für Tests
init();
