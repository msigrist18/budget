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

export function openIcs(inv, amountText) {
  const blob = new Blob([invoiceIcs(inv, amountText)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Auf dem iPhone öffnet Safari die Datei direkt im Kalender
  if (!/iPhone|iPad/i.test(navigator.userAgent)) a.download = `Rechnung-${inv.name.replace(/[^\wäöüÄÖÜ-]+/g, '_')}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
