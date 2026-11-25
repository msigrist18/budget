// Kalender-Erinnerung für eine Rechnung (.ics), damit das iPhone an die Frist erinnert.

function icsDate(iso) {
  return iso.replace(/-/g, '');
}

function escIcs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function invoiceIcs(inv, amountText) {
  const d = icsDate(inv.due);
  const next = new Date(inv.due + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const dEnd = next.toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Budget//Rechnungen//DE',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${inv.id}@budget`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${dEnd}`,
    `SUMMARY:${escIcs(`Rechnung zahlen: ${inv.name} (CHF ${amountText})`)}`,
    `DESCRIPTION:${escIcs('Fällig heute. Erfasst in deiner Budget-App.')}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escIcs(`Rechnung ${inv.name} ist in 3 Tagen fällig`)}`,
    'TRIGGER:-P3DT0H0M0S',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escIcs(`Rechnung ${inv.name} ist heute fällig`)}`,
    'TRIGGER:PT9H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function nextDayOfMonth(day) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() > day) m += 1;
  const d = new Date(Date.UTC(y, m, day));
  return d.toISOString().slice(0, 10);
}

// Wiederkehrende Erinnerungen: Zwischenstand und Monatsabschluss
export function remindersIcs(midDay, payday) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const how = 'LUKB E-Banking: Vermögen → Kontoauszug → Filter → Exportieren (PDF). Danach in der Budget-App: Buchungen → Auszug laden. Doppelte Buchungen ignoriert die App.';
  const ev = (uid, day, summary, desc) => {
    const start = nextDayOfMonth(day);
    const next = new Date(start + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    return [
      'BEGIN:VEVENT',
      `UID:${uid}@budget`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(start)}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
      `SUMMARY:${escIcs(summary)}`,
      `DESCRIPTION:${escIcs(desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escIcs(summary)}`,
      'TRIGGER:PT18H',
      'END:VALARM',
      'END:VEVENT',
    ];
  };
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Budget//Erinnerungen//DE',
    'CALSCALE:GREGORIAN',
    ...ev('budget-zwischenstand', midDay, 'Budget: Zwischenstand – Auszug laden', `Lade den Auszug seit dem letzten Import. ${how}`),
    ...ev('budget-monatsabschluss', payday, 'Budget: Monatsabschluss – Auszug laden', `Lade den Auszug bis gestern (Monatsende). ${how}`),
    'END:VCALENDAR',
  ].join('\r\n');
}

function openIcsText(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Auf dem iPhone öffnet Safari die Datei direkt im Kalender
  if (!/iPhone|iPad/i.test(navigator.userAgent)) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function openIcs(inv, amountText) {
  openIcsText(invoiceIcs(inv, amountText), `Rechnung-${inv.name.replace(/[^\wäöüÄÖÜ-]+/g, '_')}.ics`);
}

export function openReminders(midDay, payday) {
  openIcsText(remindersIcs(midDay, payday), 'Budget-Erinnerungen.ics');
}
