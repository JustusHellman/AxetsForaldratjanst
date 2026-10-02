import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateShiftsFromTemplate } from '../src/scheduler';
import { applyLevelChange, defaultLevels, levelsToRatios } from '../src/typePreference';
import { migrateBlockedShiftIds } from '../src/migrations';
import { findScheduleWarnings } from '../src/scheduleWarnings';
import { generateIcsCalendar } from '../src/calendarExport';
import type { ShiftType, TypePreferenceLevel } from '../src/types';

const T = (n: number): ShiftType[] =>
  ['a', 'b', 'c', 'd'].slice(0, n).map(id => ({ id, name: id, color: 'emerald', weight: 1, defaultStartTime: '18:00', defaultEndTime: '20:00' }));
const LEVELS: TypePreferenceLevel[] = ['none', 'little', 'medium', 'mostly', 'only'];

test('question 2: answers always stay valid (never all "Inget", at most one "Bara")', () => {
  for (const n of [2, 3, 4]) {
    const types = T(n);
    let levels = defaultLevels(types);
    let seed = 1;
    for (let k = 0; k < 400; k++) {
      seed = (seed * 16807) % 2147483647;
      const t = types[seed % n].id;
      const l = LEVELS[(seed >> 3) % 5];
      levels = applyLevelChange(types, levels, t, l);
      const vals = types.map(x => levels[x.id]);
      assert.ok(vals.some(v => v !== 'none'), `n=${n}: all none`);
      assert.ok(vals.filter(v => v === 'only').length <= 1);
      if (vals.includes('only')) assert.equal(vals.filter(v => v !== 'none').length, 1);
      const ratios = levelsToRatios(types, levels, Object.fromEntries(types.map(x => [x.id, 100 / n])));
      assert.equal(Object.values(ratios).reduce((a, b) => a + b, 0), 100);
    }
  }
});

test('question 2: two types mirror each other', () => {
  const types = T(2);
  const l = applyLevelChange(types, defaultLevels(types), 'a', 'mostly');
  assert.deepEqual(l, { a: 'mostly', b: 'little' });
  assert.deepEqual(applyLevelChange(types, l, 'b', 'only'), { a: 'none', b: 'only' });
});

test('old blocked-shift IDs are mapped to the new stable IDs', () => {
  const types = T(1);
  const shifts = generateShiftsFromTemplate('2027-01-11', '2027-01-20', [{ id: 't1', dayOfWeek: 1, shiftTypeId: 'a', startTime: '18:00', endTime: '20:00', slots: 2 }], types);
  const wish = { familyId: 'f', spacingPreference: 'neutral' as const, typeRatios: {}, blockedDates: [], submittedAt: 'x', blockedShiftIds: ['shift-2027-01-18-a-2-14', shifts[0].id, 'something-else'] };
  const out = migrateBlockedShiftIds(wish, shifts);
  assert.deepEqual(out.blockedShiftIds, ['shift-2027-01-18-t1-2', shifts[0].id, 'something-else']);
});

test('warnings: family that blocked almost everything, and too many overlapping shifts', () => {
  const types = T(1);
  const shifts = generateShiftsFromTemplate('2027-01-11', '2027-03-01', [{ id: 't1', dayOfWeek: 1, shiftTypeId: 'a', startTime: '18:00', endTime: '20:00', slots: 3 }], types);
  const families = [{ id: 'f1', name: 'Familjen A' }, { id: 'f2', name: 'Familjen B' }];
  const dates = [...new Set(shifts.map(s => s.date))];
  const wishes = { f1: { familyId: 'f1', spacingPreference: 'neutral' as const, typeRatios: {}, blockedDates: dates.slice(1), blockedShiftIds: [], submittedAt: 'x' } };
  const w = findScheduleWarnings(shifts, families, types, wishes);
  assert.ok(w.some(x => x.kind === 'familyTooBlocked' && x.familyId === 'f1'));
  assert.ok(w.some(x => x.kind === 'tooManyOverlapping'));
  assert.equal(findScheduleWarnings(shifts.filter(s => s.id.endsWith('-1')), families, types, {}).length, 0);
});

test('calendar export uses Stockholm time and folds long lines', () => {
  const types = [{ id: 'a', name: 'Städpass med ett väldigt långt namn för att testa radbrytning åäö', color: 'emerald', weight: 1, defaultStartTime: '18:00', defaultEndTime: '20:00' }];
  const shifts = generateShiftsFromTemplate('2027-01-11', '2027-01-12', [{ id: 't', dayOfWeek: 1, shiftTypeId: 'a', startTime: '18:00', endTime: '20:00', slots: 1 }], types);
  const ics = generateIcsCalendar(shifts, types, 'Vårterminen 2027', 'Familjen Holm');
  assert.ok(ics.includes('DTSTART;TZID=Europe/Stockholm:20270111T180000'));
  assert.ok(ics.includes('BEGIN:VTIMEZONE'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});
