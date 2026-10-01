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
    const cleanTime = (timeStr || '18:00').replace(/:/g, '').padEnd(4, '0').slice(0, 4) + '00';
    return `${cleanDate}T${cleanTime}`;
  };

  // A shift ending at or before its start time ends the next day
  const endDateFor = (s: Shift) => {
    if ((s.endTime || '') > (s.startTime || '')) return s.date;
    const [y, m, d] = s.date.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1, 12);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  };

  const events = shifts
    .filter(s => !s.isCancelled)
    .map(s => {
      const sType = typeMap.get(s.shiftTypeId);
      const title = `${sType?.name || s.name} - ${termName}`;
      const desc = sType?.description || `Schemalagt pass för ${familyName || 'familjen'}`;
      const dtStart = formatIcsTime(s.date, s.startTime);
      const dtEnd = formatIcsTime(endDateFor(s), s.endTime);
      const uid = `shift-${s.id}-${dateStrClean(s.date)}@kooperativet`;

      return [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${nowStr}`,
        `DTSTART;TZID=${TZID}:${dtStart}`,
        `DTEND;TZID=${TZID}:${dtEnd}`,
        foldLine(`SUMMARY:${escapeIcs(title)}`),
        foldLine(`DESCRIPTION:${escapeIcs(desc)}`),
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
    foldLine(`X-WR-CALNAME:${escapeIcs(`${termName} - ${familyName || 'Kooperativet'}`)}`),
    `X-WR-TIMEZONE:${TZID}`,
    VTIMEZONE,
    events,
    'END:VCALENDAR',
  ].join('\r\n');
}

// Times are local Swedish time, regardless of the phone's current time zone
const TZID = 'Europe/Stockholm';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Stockholm',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

/** RFC 5545: lines longer than 75 octets must be folded (å/ä/ö count as 2 octets). */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let limit = 75;
  for (const ch of line) {
    if (enc.encode(current + ch).length > limit) {
      parts.push(current);
      current = ch;
      limit = 74; // continuation lines start with a space
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function dateStrClean(d: string): string {
  return d.replace(/-/g, '');
}

function escapeIcs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
