// Small deterministic scenario generator for the tests (no Firebase involved).
import { generateShiftsFromTemplate, formatLocalDate, parseLocalDate } from '../src/scheduler';
import type { Family, FamilyWish, Shift, ShiftType, TemplateShift } from '../src/types';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scenario {
  shiftTypes: ShiftType[];
  shifts: Shift[];
  families: Family[];
  wishes: Record<string, FamilyWish>;
  start: string;
  end: string;
}

export function makeScenario(seed: number, opts: { multipliers?: boolean } = {}): Scenario {
  const r = rng(seed);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const allTypes: ShiftType[] = [
    { id: 'cleaning', name: 'Städpass', color: 'emerald', weight: 1, defaultStartTime: '18:00', defaultEndTime: '20:30' },
    { id: 'childcare', name: 'Barngrupp', color: 'amber', weight: r() < 0.25 ? 1.5 : 1, defaultStartTime: '08:30', defaultEndTime: '15:00' },
    { id: 'kitchen', name: 'Kök', color: 'blue', weight: 1, defaultStartTime: '10:00', defaultEndTime: '13:00' },
  ];
  const shiftTypes = allTypes.slice(0, r() < 0.7 ? 2 : 3);
  const template: TemplateShift[] = [];
  let tid = 0;
  for (const st of shiftTypes) {
    const days = [1, 2, 3, 4, 5].sort(() => r() - 0.5).slice(0, ri(1, 3));
    for (const d of days)
      template.push({ id: `t${++tid}`, dayOfWeek: d, shiftTypeId: st.id, startTime: st.defaultStartTime, endTime: st.defaultEndTime, slots: r() < 0.15 ? 2 : 1 });
  }
  const startD = new Date(2027, 0, 11, 12);
  const endD = new Date(startD.getTime());
  endD.setDate(endD.getDate() + ri(14, 20) * 7 - 3);
  const start = formatLocalDate(startD);
  const end = formatLocalDate(endD);
  const shifts = generateShiftsFromTemplate(start, end, template, shiftTypes);
  const families: Family[] = Array.from({ length: ri(8, 18) }, (_, i) => ({
    id: `fam-${i}`,
    name: `Familj ${i}`,
    pointsMultiplier: opts.multipliers && r() < 0.25 ? pick([0.5, 2]) : 1,
  }));
  const dates = [...new Set(shifts.map(s => s.date))];
  const wishes: Record<string, FamilyWish> = {};
  for (const f of families) {
    if (r() < 0.2) continue;
    const ratios: Record<string, number> = {};
    const a = pick([0, 25, 50, 75, 100]);
    shiftTypes.forEach((t, i) => (ratios[t.id] = shiftTypes.length === 2 ? (i === 0 ? a : 100 - a) : Math.round(100 / shiftTypes.length)));
    const blocked = new Set<string>();
    for (let k = 0; k < ri(0, 8); k++) blocked.add(pick(dates));
    wishes[f.id] = {
      familyId: f.id,
      spacingPreference: pick(['spread', 'grouped', 'neutral'] as const),
      typeRatios: ratios,
      typeFlexible: r() < 0.15,
      blockedDates: [...blocked],
      blockedShiftIds: [],
      submittedAt: 'x',
    };
  }
  return { shiftTypes, shifts, families, wishes, start, end };
}

export const days = (a: string, b: string) => Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 864e5);
