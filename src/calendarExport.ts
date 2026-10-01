import { Shift, ShiftType } from './types';

/**
 * Generate standard RFC 5545 iCalendar (.ics) string for user's assigned shifts
 */
export function generateIcsCalendar(
  shifts: Shift[],
  shiftTypes: ShiftType[],
  termName: string,
  familyName?: string
): string {
  const typeMap = new Map(shiftTypes.map(st => [st.id, st]));
  const nowStr = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

  const formatIcsTime = (dateStr: string, timeStr: string) => {
    const cleanDate = dateStr.replace(/-/g, '');
    const cleanTime = (timeStr || '18:00').replace(/:/g, '') + '00';
    return `${cleanDate}T${cleanTime}`;
  };

  const events = shifts
    .map(s => {
      const sType = typeMap.get(s.shiftTypeId);
      const title = `${sType?.name || s.name} - ${termName}`;
      const desc = sType?.description || `Schemalagt pass för ${familyName || 'familjen'}`;
      const dtStart = formatIcsTime(s.date, s.startTime);
      const dtEnd = formatIcsTime(s.date, s.endTime);
      const uid = `shift-${s.id}-${dateStrClean(s.date)}@kooperativet`;

      return [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${nowStr}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${escapeIcs(title)}`,
        `DESCRIPTION:${escapeIcs(desc)}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
      ].join('\r\n');
    })
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kooperativet Schema & Städ//SE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(`${termName} - ${familyName || 'Kooperativet'}`)}`,
    events,
    'END:VCALENDAR',
  ].join('\r\n');
}

function dateStrClean(d: string): string {
  return d.replace(/-/g, '');
}

function escapeIcs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
