import { Family, FamilyWish, FairnessMetrics, Shift, ShiftType, SpacingPreference } from './types';

export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, 12, 0, 0);
}

export function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateDefaultShiftRatios(shifts: Shift[], shiftTypes: ShiftType[]): Record<string, number> {
  const activeShifts = shifts.filter(s => !s.isCancelled);
  const total = activeShifts.length;
  if (total === 0) {
    const even = shiftTypes.length > 0 ? Math.round(100 / shiftTypes.length) : 100;
    const res: Record<string, number> = {};
    shiftTypes.forEach(t => { res[t.id] = even; });
    return res;
  }

  const counts: Record<string, number> = {};
  shiftTypes.forEach(t => { counts[t.id] = 0; });
  activeShifts.forEach(s => {
    counts[s.shiftTypeId] = (counts[s.shiftTypeId] || 0) + 1;
  });

  const ratios: Record<string, number> = {};
  let allocatedPct = 0;
  const keys = Object.keys(counts);

  keys.forEach((k, idx) => {
    if (idx === keys.length - 1) {
      ratios[k] = Math.max(0, 100 - allocatedPct);
    } else {
      const pct = Math.round((counts[k] / total) * 100);
      ratios[k] = pct;
      allocatedPct += pct;
    }
  });

  return ratios;
}

export function calculateSemesterTargetPoints(
  shifts: Shift[],
  shiftTypes: ShiftType[],
  families: Family[]
): number {
  if (families.length === 0) return 0;
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));
  const activeShifts = shifts.filter(s => !s.isCancelled);
  const totalPoints = activeShifts.reduce((sum, s) => sum + (typeMap.get(s.shiftTypeId)?.weight ?? 1.0), 0);
  const totalMultiplier = families.reduce((sum, f) => sum + (f.pointsMultiplier ?? 1.0), 0);
  return totalMultiplier > 0 ? totalPoints / totalMultiplier : 0;
}


/**
 * Builds concrete shifts for every week between start and end.
 *
 * Shift IDs are deterministic: `shift-<date>-<templateId>-<slot>`. Regenerating with
 * the same template therefore gives the same IDs, so parents' blocked single shifts
 * (blockedShiftIds) and existing assignments keep matching.
 */
export function generateShiftsFromTemplate(
  startDateStr: string,
  endDateStr: string,
  template: { id?: string; dayOfWeek: number; shiftTypeId: string; startTime: string; endTime: string; slots: number }[],
  shiftTypes: ShiftType[]
): Shift[] {
  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  const shifts: Shift[] = [];
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }

  // Stable key per template row (fallback for rows without an id)
  const templateKeys = template.map((t, idx) => t.id || `${t.dayOfWeek}-${t.shiftTypeId}-${idx}`);

  const current = new Date(start.getTime());

  while (current <= end) {
    const jsDay = current.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const dayOfWeek = jsDay === 0 ? 7 : jsDay; // 1 = Mon ... 7 = Sun
    const dateStr = formatLocalDate(current);

    template.forEach((t, idx) => {
      if (t.dayOfWeek !== dayOfWeek) return;
      const sType = typeMap.get(t.shiftTypeId);
      const typeName = sType ? sType.name : 'Pass';
      const slots = Math.max(1, t.slots || 1);

      for (let slot = 1; slot <= slots; slot++) {
        shifts.push({
          id: `shift-${dateStr}-${templateKeys[idx]}-${slot}`,
          date: dateStr,
          dayOfWeek,
          shiftTypeId: t.shiftTypeId,
          startTime: t.startTime,
          endTime: t.endTime,
          name: slots > 1 ? `${typeName} (${slot}/${slots})` : typeName,
          assignedFamilyId: null,
          isCancelled: false,
        });
      }
    });

    current.setDate(current.getDate() + 1);
  }

  return shifts;
}

/** Minutes since midnight for "HH:MM". */
function toMinutes(time: string | undefined, fallback: number): number {
  if (!time) return fallback;
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h)) return fallback;
  return h * 60 + (isNaN(m) ? 0 : m);
}

/**
 * True when two shifts happen at the same time (same date and overlapping clock times),
 * i.e. one family cannot do both. Shifts that only touch (one ends 15:00, next starts
 * 15:00) do not overlap. An end time at or before the start time is read as "past midnight".
 */
export function shiftsOverlap(a: Pick<Shift, 'date' | 'startTime' | 'endTime'>, b: Pick<Shift, 'date' | 'startTime' | 'endTime'>): boolean {
  if (a.date !== b.date) return false;
  const aS = toMinutes(a.startTime, 0);
  let aE = toMinutes(a.endTime, aS + 60);
  if (aE <= aS) aE += 24 * 60;
  const bS = toMinutes(b.startTime, 0);
  let bE = toMinutes(b.endTime, bS + 60);
  if (bE <= bS) bE += 24 * 60;
  return aS < bE && bS < aE;
}

/**
 * "Så nära varandra som möjligt": the shorter the period from the family's first to last shift,
 * the better. The period is counted in *shift days* – days in the term that have at least one
 * shift – so a preschool with shifts only Mon/Wed/Fri is judged on those days, and weekends or
 * days without shifts don't count. 100% when the family's shifts fill consecutive shift days
 * (span ≤ number of shifts), falling linearly to 25% when they stretch over the whole term.
 */
export function groupedSpanScore(spanShiftDays: number, shiftCount: number, termShiftDays: number): number {
  const ideal = Math.max(1, shiftCount);
  if (termShiftDays <= ideal) return 100;
  const x = Math.min(1, Math.max(0, (spanShiftDays - ideal) / (termShiftDays - ideal)));
  return Math.round(100 - 75 * x);
}

/** Weight of the type mix for families who answered "Spelar ingen roll" (1 = full weight). */
export const FLEXIBLE_TYPE_WEIGHT = 0.25;
const softenFlexible = (typeSat: number) => Math.round(100 - (100 - typeSat) * FLEXIBLE_TYPE_WEIGHT);

export function evaluateFamilySatisfaction(
  family: Family,
  assignedShifts: Shift[],
  wish: FamilyWish | undefined,
  shiftTypes: ShiftType[],
  allSemesterDaysSpan: number,
  /** Sorted, distinct dates in the term that have at least one (non-cancelled) shift. */
  termShiftDates?: string[]
): {
  satisfactionScore: number;
  typeSatisfaction: number;
  spacingSatisfaction: number;
  blockedConflict: boolean;
  shiftsByType: Record<string, number>;
  totalPoints: number;
} {
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));
  const shiftsByType: Record<string, number> = {};
  shiftTypes.forEach(t => { shiftsByType[t.id] = 0; });

  let totalPoints = 0;
  let blockedConflict = false;

  for (const s of assignedShifts) {
    shiftsByType[s.shiftTypeId] = (shiftsByType[s.shiftTypeId] || 0) + 1;
    totalPoints += (typeMap.get(s.shiftTypeId)?.weight ?? 1.0);

    if (wish) {
      if (wish.blockedDates.includes(s.date) || wish.blockedShiftIds.includes(s.id)) {
        blockedConflict = true;
      }
    }
  }

  let typeSatisfaction = 100;
  if (wish && assignedShifts.length > 0 && shiftTypes.length > 1) {
    let diffSum = 0;
    for (const st of shiftTypes) {
      const desiredRatio = (wish.typeRatios[st.id] ?? 0) / 100;
      const targetCount = desiredRatio * assignedShifts.length;
      const actualCount = shiftsByType[st.id] || 0;
      diffSum += Math.abs(actualCount - targetCount);
    }
    const maxDiff = Math.max(1, 2 * assignedShifts.length);
    typeSatisfaction = Math.max(0, Math.round((1 - diffSum / maxDiff) * 100));
    // "Spelar ingen roll": a soft preference for the usual mix that only counts a quarter
    if (wish.typeFlexible) typeSatisfaction = softenFlexible(typeSatisfaction);
  }

  let spacingSatisfaction = 100;
  const pref: SpacingPreference = wish?.spacingPreference || 'neutral';

  if (pref !== 'neutral' && assignedShifts.length >= 2) {
    const dates = assignedShifts.map(s => parseLocalDate(s.date).getTime()).sort((a, b) => a - b);
    const dayMs = 24 * 60 * 60 * 1000;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(Math.round((dates[i] - dates[i - 1]) / dayMs));
    }

    if (pref === 'spread') {
      const idealGap = Math.max(1, allSemesterDaysSpan / assignedShifts.length);
      let gapPenalty = 0;
      for (const g of gaps) {
        if (g < 7) gapPenalty += 30;
        const deviation = Math.abs(g - idealGap) / idealGap;
        gapPenalty += Math.min(25, deviation * 20);
      }
      spacingSatisfaction = Math.max(20, Math.round(100 - gapPenalty / gaps.length));
    } else if (pref === 'grouped') {
      const sortedDates = assignedShifts.map(s => s.date).sort();
      const first = sortedDates[0];
      const last = sortedDates[sortedDates.length - 1];
      const termDates = termShiftDates ?? Array.from(new Set(assignedShifts.map(s => s.date))).sort();
      const span = termDates.filter(d => d >= first && d <= last).length;
      spacingSatisfaction = groupedSpanScore(span, assignedShifts.length, termDates.length);
    }
  }

  let satisfactionScore = Math.round(typeSatisfaction * 0.55 + spacingSatisfaction * 0.45);
  if (blockedConflict) {
    satisfactionScore = Math.max(0, satisfactionScore - 50);
  }

  return {
    satisfactionScore,
    typeSatisfaction,
    spacingSatisfaction,
    blockedConflict,
    shiftsByType,
    totalPoints: Math.round(totalPoints * 10) / 10,
  };
}


export interface OptimizeOptions {
  /** Soft time budget in ms (default 1500). The search stops after this once `minRestarts` are done. */
  timeBudgetMs?: number;
  /** Always run at least this many restarts (default 10). */
  minRestarts?: number;
  /** Never run more than this many restarts (default 60). */
  maxRestarts?: number;
  /** Local-search length per restart, as multiples of the number of shifts (defaults 60 / 15). */
  iterFactor?: number;
  patienceFactor?: number;
  /** Optional deterministic random source (used by tests). Defaults to Math.random. */
  random?: () => number;
}

/**
 * Builds a schedule in three layers of priority:
 *   1. Hard rules: never two overlapping shifts for one family, never a blocked date/shift
 *      (unless every family is blocked, which is then reported as a conflict).
 *   2. Points: every family gets points in proportion to its pointsMultiplier, as evenly as
 *      the shift weights allow.
 *   3. Wishes: maximise the satisfaction of the worst-off family first, then the average.
 *
 * Each restart = a randomised greedy construction followed by a focused local search
 * (equal-weight swaps that never break the hard rules or the point balance). The best
 * restart is kept. Restarts continue until the time budget is used.
 */
export function optimizeSchedule(
  shifts: Shift[],
  families: Family[],
  shiftTypes: ShiftType[],
  wishes: Record<string, FamilyWish>,
  startDateStr: string,
  endDateStr: string,
  options: OptimizeOptions = {}
): { assignments: { shiftId: string; familyId: string }[]; metrics: FairnessMetrics } {
  const rand = options.random ?? Math.random;
  const timeBudgetMs = options.timeBudgetMs ?? 1500;
  const minRestarts = options.minRestarts ?? 10;
  const maxRestarts = options.maxRestarts ?? 60;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const activeShifts = shifts.filter(s => !s.isCancelled);
  if (activeShifts.length === 0 || families.length === 0) {
    return {
      assignments: [],
      metrics: {
        fairnessScore: 100,
        worstSatisfaction: 100,
        worstFamilyName: '',
        averageSatisfaction: 100,
        blockedConflictsCount: 0,
        familyEvaluations: {},
      },
    };
  }

  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));
  const defaultRatios = calculateDefaultShiftRatios(activeShifts, shiftTypes);
  const fullWishes: Record<string, FamilyWish> = {};
  families.forEach(f => {
    const w = wishes[f.id];
    // "Spelar ingen roll" families lean (softly) towards the preschool's usual mix
    fullWishes[f.id] = w ? (w.typeFlexible ? { ...w, typeRatios: defaultRatios } : w) : {
      familyId: f.id,
      spacingPreference: 'neutral',
      typeRatios: defaultRatios,
      blockedDates: [],
      blockedShiftIds: [],
      submittedAt: '',
    };
  });

  const DAY = 24 * 60 * 60 * 1000;
  const startMs = parseLocalDate(startDateStr).getTime();
  const endMs = parseLocalDate(endDateStr).getTime();
  const semesterDaysSpan = Math.max(1, Math.round((endMs - startMs) / DAY));

  // ---------- Precompute per shift ----------
  const S = activeShifts.length;
  const F = families.length;
  const T = shiftTypes.length;
  const typeIndex = new Map(shiftTypes.map((t, i) => [t.id, i]));
  const sWeight = activeShifts.map(s => typeMap.get(s.shiftTypeId)?.weight ?? 1.0);
  const sType = activeShifts.map(s => typeIndex.get(s.shiftTypeId) ?? -1);
  const sDay = activeShifts.map(s => Math.round((parseLocalDate(s.date).getTime() - startMs) / DAY));
  // Shift days: distinct dates with at least one shift. A family's "grouped" span is counted in these.
  const termShiftDates = Array.from(new Set(activeShifts.map(s => s.date))).sort();
  const dateRank = new Map(termShiftDates.map((d, k) => [d, k]));
  const sRank = activeShifts.map(s => dateRank.get(s.date)!);
  const overlapsWith: number[][] = activeShifts.map(() => []);
  {
    const byDate = new Map<string, number[]>();
    activeShifts.forEach((s, i) => {
      const list = byDate.get(s.date) || [];
      list.push(i);
      byDate.set(s.date, list);
    });
    byDate.forEach(list => {
      for (let x = 0; x < list.length; x++)
        for (let y = x + 1; y < list.length; y++)
          if (shiftsOverlap(activeShifts[list[x]], activeShifts[list[y]])) {
            overlapsWith[list[x]].push(list[y]);
            overlapsWith[list[y]].push(list[x]);
          }
    });
  }

  // ---------- Precompute per family ----------
  const fWish = families.map(f => fullWishes[f.id]);
  const fRatio = fWish.map(w => shiftTypes.map(t => (w.typeRatios[t.id] ?? 0) / 100));
  const fPref = fWish.map(w => w.spacingPreference || 'neutral');
  const fFlex = fWish.map(w => Boolean(w.typeFlexible));
  const blocked: boolean[][] = families.map((_, f) => {
    const bd = new Set(fWish[f].blockedDates);
    const bs = new Set(fWish[f].blockedShiftIds);
    return activeShifts.map(s => bd.has(s.date) || bs.has(s.id));
  });
  const totalPoints = sWeight.reduce((a, b) => a + b, 0);
  const totalMultiplier = families.reduce((sum, f) => sum + (f.pointsMultiplier ?? 1.0), 0);
  const fTarget = families.map(f => Math.max(1e-6, totalMultiplier > 0 ? (totalPoints * (f.pointsMultiplier ?? 1.0)) / totalMultiplier : 0));
  const meanTarget = totalPoints / F;
  const eligibleCount = activeShifts.map((_, i) => families.reduce((c, _f, f) => c + (blocked[f][i] ? 0 : 1), 0));

  // Equal-weight buckets so swaps never change anyone's points
  const weightBucket = new Map<number, number[]>();
  sWeight.forEach((w, i) => {
    const key = Math.round(w * 100);
    weightBucket.set(key, [...(weightBucket.get(key) || []), i]);
  });
  const bucketOf = sWeight.map(w => weightBucket.get(Math.round(w * 100))!);

  // ---------- Fast satisfaction (identical maths to evaluateFamilySatisfaction) ----------
  const counts = new Array(T).fill(0);
  const satOf = (f: number, list: number[]): number => {
    const n = list.length;
    let conflict = false;
    for (let k = 0; k < T; k++) counts[k] = 0;
    for (const i of list) {
      if (sType[i] >= 0) counts[sType[i]]++;
      if (blocked[f][i]) conflict = true;
    }
    let typeSat = 100;
    if (n > 0 && T > 1) {
      let diff = 0;
      for (let k = 0; k < T; k++) diff += Math.abs(counts[k] - fRatio[f][k] * n);
      typeSat = Math.max(0, Math.round((1 - diff / Math.max(1, 2 * n)) * 100));
      if (fFlex[f]) typeSat = softenFlexible(typeSat);
    }
    let spacingSat = 100;
    const pref = fPref[f];
    if (pref !== 'neutral' && n >= 2) {
      const days = list.map(i => sDay[i]).sort((a, b) => a - b);
      let pen = 0;
      if (pref === 'spread') {
        const ideal = Math.max(1, semesterDaysSpan / n);
        for (let k = 1; k < n; k++) {
          const g = days[k] - days[k - 1];
          if (g < 7) pen += 30;
          pen += Math.min(25, (Math.abs(g - ideal) / ideal) * 20);
        }
        spacingSat = Math.max(20, Math.round(100 - pen / (n - 1)));
      } else if (pref === 'grouped') {
        let first = Infinity;
        let last = -Infinity;
        for (const i of list) {
          if (sRank[i] < first) first = sRank[i];
          if (sRank[i] > last) last = sRank[i];
        }
        spacingSat = groupedSpanScore(last - first + 1, n, termShiftDates.length);
      }
    }
    let score = Math.round(typeSat * 0.55 + spacingSat * 0.45);
    if (conflict) score = Math.max(0, score - 50);
    return score;
  };

  const overlapsFamily = (i: number, list: number[], ignore = -1): boolean => {
    const ov = overlapsWith[i];
    if (ov.length === 0) return false;
    for (const j of list) if (j !== ignore && ov.includes(j)) return true;
    return false;
  };

  type Candidate = {
    assign: Int32Array;
    key: number[]; // lexicographic, lower is better
  };
  let best: Candidate | null = null;

  const t0 = now();
  let restart = 0;
  while (restart < maxRestarts && (restart < minRestarts || now() - t0 < timeBudgetMs)) {
    restart++;

    // ---- 1. Randomised greedy construction ----
    const assign = new Int32Array(S).fill(-1);
    const lists: number[][] = families.map(() => []);
    const pts = new Array(F).fill(0);
    const tie = activeShifts.map(() => rand());
    const order = activeShifts.map((_, i) => i).sort((a, b) => eligibleCount[a] - eligibleCount[b] || tie[a] - tie[b]);

    for (const i of order) {
      let pool: number[] = [];
      for (let f = 0; f < F; f++) if (!blocked[f][i] && !overlapsFamily(i, lists[f])) pool.push(f);
      if (pool.length === 0) for (let f = 0; f < F; f++) if (!overlapsFamily(i, lists[f])) pool.push(f);
      if (pool.length === 0) pool = families.map((_, f) => f);

      let minRatio = Infinity;
      for (const f of pool) minRatio = Math.min(minRatio, pts[f] / fTarget[f]);
      let bestF = pool[0];
      let bestScore = -Infinity;
      for (const f of pool) {
        if (pts[f] / fTarget[f] > minRatio + 1e-9) continue;
        const list = lists[f];
        let score = (fTarget[f] - pts[f]) * 100 + rand() * 2;
        if (sType[i] >= 0) {
          let ofType = 0;
          for (const j of list) if (sType[j] === sType[i]) ofType++;
          score += (fRatio[f][sType[i]] * (list.length + 1) - ofType) * 20 * (fFlex[f] ? FLEXIBLE_TYPE_WEIGHT : 1);
        }
        if (list.length > 0 && fPref[f] !== 'neutral') {
          let nearest = Infinity;
          for (const j of list) nearest = Math.min(nearest, Math.abs(sDay[j] - sDay[i]));
          if (fPref[f] === 'spread') {
            score += nearest < 7 ? -40 : nearest > 14 ? 15 : 0;
          } else {
            // Grouped: prefer shifts that don't stretch the family's current period
            let lo = Infinity;
            let hi = -Infinity;
            for (const j of list) {
              lo = Math.min(lo, sRank[j]);
              hi = Math.max(hi, sRank[j]);
            }
            // How many shift days this shift would add to the family's period
            const growth = Math.max(hi, sRank[i]) - Math.min(lo, sRank[i]) - (hi - lo);
            score += growth === 0 ? 30 : 30 - Math.min(60, growth * 8);
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestF = f;
        }
      }
      assign[i] = bestF;
      lists[bestF].push(i);
      pts[bestF] += sWeight[i];
    }

    // ---- 1b. Even out points (hard rule) ----
    // If a family blocked so much that it ended up below its share, move shifts to it from the
    // families with the most points until everyone is within one shift weight. Shifts the family
    // can actually do are preferred; only if none exist anywhere does it get a shift on a day it
    // blocked (reported as a conflict). Overlapping shifts are never created.
    const maxWeight = Math.max(...sWeight);
    for (let guard = 0; guard < S * 2; guard++) {
      let poor = 0;
      for (let f = 1; f < F; f++) if (pts[f] / fTarget[f] < pts[poor] / fTarget[poor]) poor = f;
      const poorRatioAfter = (w: number) => (pts[poor] + w) / fTarget[poor];
      let bestMove: { i: number; from: number; blockedHit: boolean; cost: number } | null = null;
      for (let f = 0; f < F; f++) {
        if (f === poor) continue;
        for (const i of lists[f]) {
          const w = sWeight[i];
          // Only moves that strictly narrow the gap (never overshoot the donor)
          if (!((pts[f] - w) / fTarget[f] >= pts[poor] / fTarget[poor] - 1e-9 && poorRatioAfter(w) < pts[f] / fTarget[f] - 1e-9)) continue;
          if (overlapsFamily(i, lists[poor])) continue;
          const blockedHit = blocked[poor][i];
          // Prefer: not blocked > take from the richest > smallest loss in satisfaction
          const cost = (blockedHit ? 1e6 : 0) - (pts[f] / fTarget[f]) * 1000 + (satOf(f, lists[f]) - satOf(f, lists[f].filter(x => x !== i)));
          if (!bestMove || cost < bestMove.cost) bestMove = { i, from: f, blockedHit, cost };
        }
      }
      if (!bestMove) break;
      const { i, from } = bestMove;
      lists[from] = lists[from].filter(x => x !== i);
      lists[poor].push(i);
      pts[from] -= sWeight[i];
      pts[poor] += sWeight[i];
      assign[i] = poor;
    }

    // ---- 2. Focused local search with equal-weight swaps ----
    const sat = families.map((_, f) => satOf(f, lists[f]));
    const maxIter = (options.iterFactor ?? 60) * S;
    const patience = (options.patienceFactor ?? 15) * S;
    let sinceImprove = 0;
    for (let iter = 0; iter < maxIter && sinceImprove < patience; iter++) {
      sinceImprove++;
      let a: number;
      if (rand() < 0.6) {
        // Focus on the worst-off family
        let minSat = Infinity;
        for (let f = 0; f < F; f++) if (lists[f].length > 0 && sat[f] < minSat) minSat = sat[f];
        const worst: number[] = [];
        for (let f = 0; f < F; f++) if (lists[f].length > 0 && sat[f] === minSat) worst.push(f);
        const fw = worst[Math.floor(rand() * worst.length)];
        a = lists[fw][Math.floor(rand() * lists[fw].length)];
      } else {
        a = Math.floor(rand() * S);
      }
      const bucket = bucketOf[a];
      const b = bucket[Math.floor(rand() * bucket.length)];
      const fA = assign[a];
      const fB = assign[b];
      if (fA === fB) continue;
      if (blocked[fB][a] || blocked[fA][b]) {
        // Allowed only if it removes more blocked hits than it creates
        const before = (blocked[fA][a] ? 1 : 0) + (blocked[fB][b] ? 1 : 0);
        const after = (blocked[fB][a] ? 1 : 0) + (blocked[fA][b] ? 1 : 0);
        if (after >= before) continue;
      }
      if (overlapsFamily(b, lists[fA], a) || overlapsFamily(a, lists[fB], b)) continue;

      const newA = lists[fA].map(x => (x === a ? b : x));
      const newB = lists[fB].map(x => (x === b ? a : x));
      const sA = satOf(fA, newA);
      const sB = satOf(fB, newB);
      const minBefore = Math.min(sat[fA], sat[fB]);
      const minAfter = Math.min(sA, sB);
      const sumBefore = sat[fA] + sat[fB];
      const sumAfter = sA + sB;
      const better = minAfter > minBefore || (minAfter === minBefore && sumAfter > sumBefore);
      const sideways = minAfter === minBefore && sumAfter === sumBefore && rand() < 0.15;
      if (better || sideways) {
        assign[a] = fB;
        assign[b] = fA;
        lists[fA] = newA;
        lists[fB] = newB;
        sat[fA] = sA;
        sat[fB] = sB;
        if (better) sinceImprove = 0;
      }
    }

    // ---- 3. Score this restart (lexicographic, lower is better) ----
    let conflicts = 0;
    let overlaps = 0;
    for (let i = 0; i < S; i++) {
      if (blocked[assign[i]][i]) conflicts++;
      for (const j of overlapsWith[i]) if (j > i && assign[j] === assign[i]) overlaps++;
    }
    let minR = Infinity;
    let maxR = -Infinity;
    for (let f = 0; f < F; f++) {
      const r = pts[f] / fTarget[f];
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    const pointSpread = Math.round((maxR - minR) * meanTarget * 100) / 100;
    const minSat = Math.min(...sat);
    const sumSat = sat.reduce((x, y) => x + y, 0);
    const avgSat = sumSat / F;
    // Families who got more than their share should preferably be the happier ones
    let compensation = 0;
    for (let f = 0; f < F; f++) compensation += (pts[f] / fTarget[f] > minR + 1e-9 ? 1 : -1) * (sat[f] - avgSat);
    // Priority: no overlaps > points within one shift > fewest blocked-date conflicts > ...
    const pointExcess = Math.max(0, Math.round((pointSpread - maxWeight) * 100) / 100);
    const key = [overlaps, pointExcess, conflicts, pointSpread, -minSat, -sumSat, -Math.round(compensation)];

    let isBetter = !best;
    if (best) {
      for (let k = 0; k < key.length; k++) {
        if (key[k] !== best.key[k]) {
          isBetter = key[k] < best.key[k];
          break;
        }
      }
    }
    if (isBetter) best = { assign: assign.slice(), key };
  }

  // ---------- Final, verified metrics using the public evaluator ----------
  const bestAssign = best!.assign;
  const finalAssignments = activeShifts.map((s, i) => ({ shiftId: s.id, familyId: families[bestAssign[i]].id }));

  const evaluations: FairnessMetrics['familyEvaluations'] = {};
  let minSat = 100;
  let worstName = '';
  let totalSat = 0;
  let conflictsCount = 0;
  families.forEach((f, fi) => {
    const famShifts = activeShifts.filter((_, i) => bestAssign[i] === fi);
    const ev = evaluateFamilySatisfaction(f, famShifts, fullWishes[f.id], shiftTypes, semesterDaysSpan, termShiftDates);
    evaluations[f.id] = { ...ev, familyId: f.id, familyName: f.name, totalShifts: famShifts.length };
    totalSat += ev.satisfactionScore;
    if (ev.blockedConflict) conflictsCount++;
    if (ev.satisfactionScore < minSat) {
      minSat = ev.satisfactionScore;
      worstName = f.name;
    }
  });
  const avgSat = Math.round(totalSat / families.length);

  return {
    assignments: finalAssignments,
    metrics: {
      fairnessScore: Math.max(0, Math.min(100, Math.round(minSat * 0.7 + avgSat * 0.3))),
      worstSatisfaction: minSat,
      worstFamilyName: worstName,
      averageSatisfaction: avgSat,
      blockedConflictsCount: conflictsCount,
      familyEvaluations: evaluations,
    },
  };
}
