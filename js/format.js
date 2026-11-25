// Formatierung und kleine Helfer (ohne DOM)

export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const nf = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 1234.5 -> "1’234.50"; mit sign:true -> "+1’234.50" / "−1’234.50"
export function chf(n, opts = {}) {
  const v = round2(n);
  const abs = nf.format(Math.abs(v)).replace(/'/g, '’');
  if (opts.sign) {
    if (v > 0) return '+' + abs;
    if (v < 0) return '−' + abs;
    return abs;
  }
  return (v < 0 ? '−' : '') + abs;
}

// "12,50" / "1'234.50" / "1’234.50" / "-5" -> Zahl (NaN wenn ungültig)
export function parseAmount(str) {
  if (typeof str === 'number') return str;
  if (str == null) return NaN;
  let s = String(str).trim().replace(/[’'`´\s]/g, '').replace(/^CHF/i, '').replace(/[−–]/g, '-');
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return round2(parseFloat(s));
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "2026-11-25" -> "25.11.2026"
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// "2026-11-25" -> "25.11."
export function fmtDateShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}.${m}.`;
}

// "2027-01" -> "Januar 2027"
export function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_DE[m - 1]} ${y}`;
}

// "2027-01" -> "Jan 27"
export function monthShort(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  const r = (globalThis.crypto && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${r}`;
}

export function daysBetween(isoA, isoB) {
  const a = Date.UTC(...isoA.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const b = Date.UTC(...isoB.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  return Math.round((b - a) / 86400000);
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
