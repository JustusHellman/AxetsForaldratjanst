import { shiftsOverlap } from './scheduler';
import { Family, FamilyWish, Shift, ShiftType } from './types';

export type ScheduleWarning =
  | { kind: 'familyTooBlocked'; familyId: string; familyName: string; availablePoints: number; targetPoints: number }
  | { kind: 'tooManyOverlapping'; date: string; concurrent: number; families: number };

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Things the admin should know before generating, because no schedule can fully solve them:
 *  - a family has blocked so much that the shifts left for them are worth less than their share
 *    of points (the others then have to cover for them)
 *  - a day has more shifts at the same time than there are families (someone must get two
 *    overlapping shifts)
 */
export function findScheduleWarnings(
  shifts: Shift[],
  families: Family[],
  shiftTypes: ShiftType[],
  wishes: Record<string, FamilyWish>
): ScheduleWarning[] {
  const active = shifts.filter(s => !s.isCancelled);
  if (active.length === 0 || families.length === 0) return [];
  const weight = new Map(shiftTypes.map(t => [t.id, t.weight ?? 1]));
  const w = (s: Shift) => weight.get(s.shiftTypeId) ?? 1;
  const totalPoints = active.reduce((sum, s) => sum + w(s), 0);
  const totalMultiplier = families.reduce((sum, f) => sum + (f.pointsMultiplier ?? 1), 0) || 1;
  const warnings: ScheduleWarning[] = [];

  for (const f of families) {
    const wish = wishes[f.id];
    if (!wish) continue;
    const blockedDates = new Set(wish.blockedDates || []);
    const blockedIds = new Set(wish.blockedShiftIds || []);
    const target = (totalPoints * (f.pointsMultiplier ?? 1)) / totalMultiplier;
    // One family can't do overlapping shifts, so per day count the best set of non-overlapping ones
    const free = active.filter(s => !blockedDates.has(s.date) && !blockedIds.has(s.id));
    const freeByDate = new Map<string, Shift[]>();
    free.forEach(s => freeByDate.set(s.date, [...(freeByDate.get(s.date) || []), s]));
    let available = 0;
    freeByDate.forEach(list => (available += bestNonOverlapping(list, w)));
    if (available < target - 0.01) {
      warnings.push({
        kind: 'familyTooBlocked',
        familyId: f.id,
        familyName: f.name,
        availablePoints: round1(available),
        targetPoints: round1(target),
      });
    }
  }

  // Largest group of mutually overlapping shifts per day (clock-time intervals → sweep line)
  const byDate = new Map<string, Shift[]>();
  active.forEach(s => byDate.set(s.date, [...(byDate.get(s.date) || []), s]));
  byDate.forEach((list, date) => {
    let maxConcurrent = 1;
    for (const a of list) {
      // Intervals that contain the start of `a` overlap each other at that moment
      const atStart = list.filter(b => b === a || (shiftsOverlap(a, b) && b.startTime <= a.startTime)).length;
      maxConcurrent = Math.max(maxConcurrent, atStart);
    }
    if (maxConcurrent > families.length) {
      warnings.push({ kind: 'tooManyOverlapping', date, concurrent: maxConcurrent, families: families.length });
    }
  });

  return warnings;
}

/** Highest total weight of shifts on one day that one family could do (no two overlapping). */
function bestNonOverlapping(list: Shift[], w: (s: Shift) => number): number {
  const sorted = [...list].sort((a, b) => a.endTime.localeCompare(b.endTime));
  const best: number[] = [];
  sorted.forEach((s, k) => {
    let prev = -1;
    for (let j = k - 1; j >= 0; j--) if (!shiftsOverlap(sorted[j], s)) { prev = j; break; }
    const take = w(s) + (prev >= 0 ? best[prev] : 0);
    best[k] = Math.max(take, k > 0 ? best[k - 1] : 0);
  });
  return best.length ? best[best.length - 1] : 0;
}
