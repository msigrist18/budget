// Ladenerkennung: bekannte Schweizer Läden + was die App von dir lernt.
// Läuft komplett auf dem Gerät, ohne KI-Dienst.

// Reihenfolge ist wichtig: Spezielles vor Allgemeinem (z.B. "Coop City" vor "Coop").
// food: true -> wird automatisch der Lebensmittel-Kategorie zugeordnet.
export const BRANDS = [
  [/migrolino/, 'Migrolino', true],
  [/\bmigrol\b/, 'Migrol (Tankstelle)', false],
  [/melectronics|\bdo it\b|sportx|micasa|bike ?world/, 'Migros Fachmarkt', false],
  [/migros\s*(restaurant|take ?away)/, 'Migros Restaurant', false],
  [/migros|^mm\b|\bmmm\b/, 'Migros', true],
  [/coop\s*city/, 'Coop City', false],
  [/coop\s*vitality/, 'Coop Vitality', false],
  [/coop\s*bau/, 'Coop Bau+Hobby', false],
  [/coop\s*restaurant/, 'Coop Restaurant', false],
  [/coop\s*(pronto|mineral)/, 'Coop Pronto', false],
  [/coop/, 'Coop', true],
  [/denner/, 'Denner', true],
  [/\blidl\b/, 'Lidl', true],
  [/\baldi\b/, 'Aldi', true],
  [/\bvolg\b/, 'Volg', true],
  [/\bspar\b/, 'Spar', true],
  [/manor\s*food/, 'Manor Food', true],
  [/alnatura/, 'Alnatura', true],
  [/aperto/, 'Aperto', true],
  [/\bavec\b/, 'avec', true],
  [/farmy/, 'Farmy', true],
  [/top\s?cc/, 'TopCC', true],
  [/prodega/, 'Prodega', true],
  [/globus.*(delicatessa|food)/, 'Globus Delicatessa', true],
  [/b[äa]ckerei|baeckerei|\bbeck\b|confiserie/, 'Bäckerei', true],
  [/metzgerei/, 'Metzgerei', true],
  [/k\s?-?kiosk/, 'k kiosk', false],
  [/\blandi\b/, 'Landi', false],
  [/galaxus/, 'Galaxus', false],
  [/digitec/, 'Digitec', false],
  [/brack/, 'Brack', false],
  [/zalando/, 'Zalando', false],
  [/\bsbb\b/, 'SBB', false],
];

export function cleanMerchant(s) {
  return String(s || '')
    .replace(/\s*(\.\.\.|…)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Schlüssel zum Wiedererkennen: klein geschrieben, ohne Ziffern, erste 3 Wörter
export function merchantKey(s) {
  const words = cleanMerchant(s)
    .toLowerCase()
    .replace(/[0-9]/g, ' ')
    .replace(/[^a-zäöüéèàç&+ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 3).join(' ');
}

export function detectBrand(merchant) {
  const m = cleanMerchant(merchant).toLowerCase();
  if (!m) return null;
  for (const [re, brand, food] of BRANDS) if (re.test(m)) return { brand, food };
  return null;
}

// Anzeigename für Auswertungen
export function brandOf(tx) {
  const d = detectBrand(tx.merchant || tx.text);
  if (d) return d.brand;
  const c = cleanMerchant(tx.merchant || tx.text || 'Unbekannt');
  return c.length > 28 ? c.slice(0, 27) + '…' : c;
}

// Kategorie-Vorschlag: zuerst deine gelernten Regeln, dann bekannte Läden
export function suggestCategory(tx, rules, settings, catById) {
  const key = merchantKey(tx.merchant || tx.text);
  if (key) {
    const r = rules.find((x) => x.key === key);
    if (r && catById[r.categoryId]) return { categoryId: r.categoryId, source: 'regel' };
  }
  const b = detectBrand(tx.merchant || tx.text);
  if (b && b.food && tx.amount < 0 && settings.foodCategoryId && catById[settings.foodCategoryId]) {
    return { categoryId: settings.foodCategoryId, source: 'laden' };
  }
  return { categoryId: null, source: null };
}
