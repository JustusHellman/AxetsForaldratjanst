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

export function generateShiftsFromTemplate(
  startDateStr: string,
  endDateStr: string,
  template: { dayOfWeek: number; shiftTypeId: string; startTime: string; endTime: string; slots: number }[],
  shiftTypes: ShiftType[]
): Shift[] {
  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  const shifts: Shift[] = [];
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }

  const current = new Date(start.getTime());
  let idCounter = 1;

  while (current <= end) {
    const jsDay = current.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const dayOfWeek = jsDay === 0 ? 7 : jsDay; // 1 = Mon ... 7 = Sun
    const dateStr = formatLocalDate(current);

    const dayTemplates = template.filter(t => t.dayOfWeek === dayOfWeek);

    for (const t of dayTemplates) {
      const sType = typeMap.get(t.shiftTypeId);
      const typeName = sType ? sType.name : 'Pass';
      const slots = Math.max(1, t.slots || 1);

      for (let slot = 1; slot <= slots; slot++) {
        shifts.push({
          id: `shift-${dateStr}-${t.shiftTypeId}-${slot}-${idCounter++}`,
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
    }

    current.setDate(current.getDate() + 1);
  }

  return shifts;
}

export function evaluateFamilySatisfaction(
  family: Family,
  assignedShifts: Shift[],
  wish: FamilyWish | undefined,
  shiftTypes: ShiftType[],
  allSemesterDaysSpan: number
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
      let largeGapPenalty = 0;
      for (const g of gaps) {
        if (g > 21) largeGapPenalty += 30;
        else if (g > 14) largeGapPenalty += 15;
      }
      spacingSatisfaction = Math.max(25, Math.round(100 - largeGapPenalty / gaps.length));
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

export function optimizeSchedule(
  shifts: Shift[],
  families: Family[],
  shiftTypes: ShiftType[],
  wishes: Record<string, FamilyWish>,
  startDateStr: string,
  endDateStr: string
): { assignments: { shiftId: string; familyId: string }[]; metrics: FairnessMetrics } {
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
    fullWishes[f.id] = wishes[f.id] || {
      familyId: f.id,
      spacingPreference: 'neutral',
      typeRatios: defaultRatios,
      blockedDates: [],
      blockedShiftIds: [],
      submittedAt: '',
    };
  });

  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  const semesterDaysSpan = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 3600 * 1000)));

  const totalPoints = activeShifts.reduce((sum, s) => sum + (typeMap.get(s.shiftTypeId)?.weight ?? 1.0), 0);
  const totalMultiplier = families.reduce((sum, f) => sum + (f.pointsMultiplier ?? 1.0), 0);

  const targetPointsMap = new Map<string, number>();
  families.forEach(f => {
    const mult = f.pointsMultiplier ?? 1.0;
    const rawTarget = totalMultiplier > 0 ? (totalPoints * mult) / totalMultiplier : 0;
    targetPointsMap.set(f.id, rawTarget);
  });

  const NUM_RESTARTS = 800;
  let bestAssignmentMap: Map<string, string> = new Map();
  let bestPointDisparity = Infinity;
  let bestCompensationScore = -Infinity;
  let bestMinSatisfaction = -1;
  let bestAvgSatisfaction = -1;
  let bestMetrics: FairnessMetrics | null = null;

  for (let restart = 0; restart < NUM_RESTARTS; restart++) {
    const shuffledFamilies = [...families].sort(() => Math.random() - 0.5);

    const familyShiftsMap = new Map<string, Shift[]>();
    const familyPointsMap = new Map<string, number>();
    shuffledFamilies.forEach(f => {
      familyShiftsMap.set(f.id, []);
      familyPointsMap.set(f.id, 0);
    });

    const currentAssignments = new Map<string, string>();

    // Sort shifts: prioritize most constrained dates first
    const sortedShifts = [...activeShifts].sort((a, b) => {
      const blockedA = shuffledFamilies.filter(f => {
        const w = fullWishes[f.id];
        return w.blockedDates.includes(a.date) || w.blockedShiftIds.includes(a.id);
      }).length;
      const blockedB = shuffledFamilies.filter(f => {
        const w = fullWishes[f.id];
        return w.blockedDates.includes(b.date) || w.blockedShiftIds.includes(b.id);
      }).length;

      if (blockedB !== blockedA) return blockedB - blockedA;
      return Math.random() - 0.5;
    });

    for (const shift of sortedShifts) {
      const shiftWeight = typeMap.get(shift.shiftTypeId)?.weight ?? 1.0;

      const nonBlocked = shuffledFamilies.filter(f => {
        const w = fullWishes[f.id];
        return !w.blockedDates.includes(shift.date) && !w.blockedShiftIds.includes(shift.id);
      });

      const pool = nonBlocked.length > 0 ? nonBlocked : shuffledFamilies;

      // Find minimum current points in pool to guarantee STRICT point quota adherence
      let minPtsInPool = Infinity;
      for (const fam of pool) {
        const pts = familyPointsMap.get(fam.id) || 0;
        if (pts < minPtsInPool) minPtsInPool = pts;
      }

      // Candidate pool: strictly families whose points are within minimum
      const candidateFamilies = pool.filter(f => {
        const pts = familyPointsMap.get(f.id) || 0;
        return pts <= minPtsInPool + 0.01;
      });

      let bestCandidate = candidateFamilies[0];
      let bestCandidateScore = -Infinity;

      for (const fam of candidateFamilies) {
        const assigned = familyShiftsMap.get(fam.id) || [];
        const currentPoints = familyPointsMap.get(fam.id) || 0;
        const targetPts = targetPointsMap.get(fam.id) || 1;

        const sameDay = assigned.some(s => s.date === shift.date);
        const sameDayPenalty = sameDay ? 300 : 0;

        const pointsDeficit = (targetPts - currentPoints);

        const wish = fullWishes[fam.id];
        const currentOfType = assigned.filter(s => s.shiftTypeId === shift.shiftTypeId).length;
        const desiredRatio = (wish.typeRatios[shift.shiftTypeId] ?? 0) / 100;
        const idealTypeCount = Math.max(0, desiredRatio * (assigned.length + 1));
        const typeBonus = (idealTypeCount - currentOfType) * 20;

        let spacingBonus = 0;
        if (assigned.length > 0 && wish.spacingPreference !== 'neutral') {
          const shiftDateMs = parseLocalDate(shift.date).getTime();
          const nearestDiffDays = Math.min(...assigned.map(s => Math.abs(shiftDateMs - parseLocalDate(s.date).getTime()) / (24 * 3600 * 1000)));

          if (wish.spacingPreference === 'spread') {
            if (nearestDiffDays < 7) spacingBonus -= 40;
            else if (nearestDiffDays > 14) spacingBonus += 15;
          } else if (wish.spacingPreference === 'grouped') {
            if (nearestDiffDays <= 14) spacingBonus += 30;
            else spacingBonus -= 20;
          }
        }

        const candidateScore = (pointsDeficit * 100) + typeBonus + spacingBonus - sameDayPenalty + Math.random() * 2;

        if (candidateScore > bestCandidateScore) {
          bestCandidateScore = candidateScore;
          bestCandidate = fam;
        }
      }

      currentAssignments.set(shift.id, bestCandidate.id);
      familyShiftsMap.get(bestCandidate.id)!.push(shift);
      familyPointsMap.set(bestCandidate.id, (familyPointsMap.get(bestCandidate.id) || 0) + shiftWeight);
    }

    // Local Search Swaps to maximize Maximin satisfaction while keeping strict point balance
    const MAX_SWAP_ITERATIONS = 400;
    for (let iter = 0; iter < MAX_SWAP_ITERATIONS; iter++) {
      const idxA = Math.floor(Math.random() * activeShifts.length);
      const idxB = Math.floor(Math.random() * activeShifts.length);
      if (idxA === idxB) continue;

      const sA = activeShifts[idxA];
      const sB = activeShifts[idxB];
      const famAId = currentAssignments.get(sA.id)!;
      const famBId = currentAssignments.get(sB.id)!;
      if (famAId === famBId) continue;

      const weightA = typeMap.get(sA.shiftTypeId)?.weight ?? 1.0;
      const weightB = typeMap.get(sB.shiftTypeId)?.weight ?? 1.0;

      // Only allow swap if weights match or if point gap does not widen
      if (Math.abs(weightA - weightB) > 0.01) continue;

      const wishA = fullWishes[famAId];
      const wishB = fullWishes[famBId];

      const aBlockedForB = wishA.blockedDates.includes(sB.date) || wishA.blockedShiftIds.includes(sB.id);
      const bBlockedForA = wishB.blockedDates.includes(sA.date) || wishB.blockedShiftIds.includes(sA.id);
      if (aBlockedForB || bBlockedForA) continue;

      const currentShiftsA = familyShiftsMap.get(famAId)!;
      const currentShiftsB = familyShiftsMap.get(famBId)!;

      const famA = families.find(f => f.id === famAId)!;
      const famB = families.find(f => f.id === famBId)!;

      const satABefore = evaluateFamilySatisfaction(famA, currentShiftsA, wishA, shiftTypes, semesterDaysSpan).satisfactionScore;
      const satBBefore = evaluateFamilySatisfaction(famB, currentShiftsB, wishB, shiftTypes, semesterDaysSpan).satisfactionScore;
      const minBefore = Math.min(satABefore, satBBefore);

      const newShiftsA = currentShiftsA.map(s => s.id === sA.id ? sB : s);
      const newShiftsB = currentShiftsB.map(s => s.id === sB.id ? sA : s);

      const satAAfter = evaluateFamilySatisfaction(famA, newShiftsA, wishA, shiftTypes, semesterDaysSpan).satisfactionScore;
      const satBAfter = evaluateFamilySatisfaction(famB, newShiftsB, wishB, shiftTypes, semesterDaysSpan).satisfactionScore;
      const minAfter = Math.min(satAAfter, satBAfter);

      if (minAfter > minBefore || (minAfter === minBefore && (satAAfter + satBAfter > satABefore + satBBefore))) {
        currentAssignments.set(sA.id, famBId);
        currentAssignments.set(sB.id, famAId);
        familyShiftsMap.set(famAId, newShiftsA);
        familyShiftsMap.set(famBId, newShiftsB);
      }
    }

    // Evaluate solution
    const allPoints = Array.from(familyPointsMap.values());
    const minPoints = Math.min(...allPoints);
    const maxPoints = Math.max(...allPoints);
    const pointDisparity = maxPoints - minPoints;

    const evaluations: Record<string, ReturnType<typeof evaluateFamilySatisfaction> & { familyName: string; totalShifts: number; familyId: string }> = {};
    let minSat = 100;
    let worstName = '';
    let totalSat = 0;
    let totalBlockedConflicts = 0;

    for (const f of families) {
      const assigned = familyShiftsMap.get(f.id) || [];
      const evalResult = evaluateFamilySatisfaction(f, assigned, fullWishes[f.id], shiftTypes, semesterDaysSpan);

      evaluations[f.id] = {
        ...evalResult,
        familyId: f.id,
        familyName: f.name,
        totalShifts: assigned.length,
      };

      totalSat += evalResult.satisfactionScore;
      if (evalResult.blockedConflict) totalBlockedConflicts++;

      if (evalResult.satisfactionScore < minSat) {
        minSat = evalResult.satisfactionScore;
        worstName = f.name;
      }
    }

    const avgSat = Math.round(totalSat / families.length);
    const fairnessScore = Math.max(0, Math.min(100, Math.round(minSat * 0.7 + avgSat * 0.3)));

    // Wish-Compensation Metric: When point disparity exists (e.g. some families have minPoints, some have minPoints + 1):
    // Families with lower satisfaction score SHOULD receive the lower point amount.
    // Families who received higher points but had lower satisfaction receive a penalty.
    let compensationScore = 0;
    if (pointDisparity > 0) {
      for (const f of families) {
        const pts = evaluations[f.id].totalPoints;
        const sat = evaluations[f.id].satisfactionScore;
        if (pts > minPoints) {
          // Extra point family: reward if high satisfaction, penalize if low satisfaction
          compensationScore += (sat - avgSat);
        } else {
          // Lower point family: reward if lower satisfaction (compensated)
          compensationScore += (avgSat - sat);
        }
      }
    }

    const candidateMetrics: FairnessMetrics = {
      fairnessScore,
      worstSatisfaction: minSat,
      worstFamilyName: worstName,
      averageSatisfaction: avgSat,
      blockedConflictsCount: totalBlockedConflicts,
      familyEvaluations: evaluations,
    };

    // Prioritize 1) zero blocked conflicts, 2) minimal point disparity, 3) wish-compensation correlation, 4) maximin satisfaction
    const isBetter =
      totalBlockedConflicts < (bestMetrics?.blockedConflictsCount ?? Infinity) ||
      (totalBlockedConflicts === (bestMetrics?.blockedConflictsCount ?? Infinity) &&
        pointDisparity < bestPointDisparity) ||
      (totalBlockedConflicts === (bestMetrics?.blockedConflictsCount ?? Infinity) &&
        pointDisparity === bestPointDisparity &&
        compensationScore > bestCompensationScore + 5) ||
      (totalBlockedConflicts === (bestMetrics?.blockedConflictsCount ?? Infinity) &&
        pointDisparity === bestPointDisparity &&
        Math.abs(compensationScore - bestCompensationScore) <= 5 &&
        minSat > bestMinSatisfaction) ||
      (totalBlockedConflicts === (bestMetrics?.blockedConflictsCount ?? Infinity) &&
        pointDisparity === bestPointDisparity &&
        minSat === bestMinSatisfaction &&
        avgSat > bestAvgSatisfaction);

    if (isBetter) {
      bestPointDisparity = pointDisparity;
      bestCompensationScore = compensationScore;
      bestMinSatisfaction = minSat;
      bestAvgSatisfaction = avgSat;
      bestAssignmentMap = new Map(currentAssignments);
      bestMetrics = candidateMetrics;
    }
  }

  // Recalculate true final metrics based on the winning assignments to ensure 100% genuine and verified metrics
  const finalAssignments: { shiftId: string; familyId: string }[] = [];
  bestAssignmentMap.forEach((famId, shiftId) => {
    finalAssignments.push({ shiftId, familyId: famId });
  });

  const verifiedEvaluations: Record<string, ReturnType<typeof evaluateFamilySatisfaction> & { familyName: string; totalShifts: number; familyId: string }> = {};
  let trueMinSat = 100;
  let trueWorstName = '';
  let trueTotalSat = 0;
  let trueBlockedConflicts = 0;

  for (const f of families) {
    const famAssignedShifts = activeShifts.filter(s => bestAssignmentMap.get(s.id) === f.id);
    const evalRes = evaluateFamilySatisfaction(f, famAssignedShifts, fullWishes[f.id], shiftTypes, semesterDaysSpan);

    verifiedEvaluations[f.id] = {
      ...evalRes,
      familyId: f.id,
      familyName: f.name,
      totalShifts: famAssignedShifts.length,
    };

    trueTotalSat += evalRes.satisfactionScore;
    if (evalRes.blockedConflict) trueBlockedConflicts++;

    if (evalRes.satisfactionScore < trueMinSat) {
      trueMinSat = evalRes.satisfactionScore;
      trueWorstName = f.name;
    }
  }

  const trueAvgSat = Math.round(trueTotalSat / families.length);
  const trueFairnessScore = Math.max(0, Math.min(100, Math.round(trueMinSat * 0.7 + trueAvgSat * 0.3)));

  const finalVerifiedMetrics: FairnessMetrics = {
    fairnessScore: trueFairnessScore,
    worstSatisfaction: trueMinSat,
    worstFamilyName: trueWorstName,
    averageSatisfaction: trueAvgSat,
    blockedConflictsCount: trueBlockedConflicts,
    familyEvaluations: verifiedEvaluations,
  };

  return {
    assignments: finalAssignments,
    metrics: finalVerifiedMetrics,
  };
}

export function generateIcsCalendar(
  shifts: Shift[],
  shiftTypes: ShiftType[],
  termName: string,
  familyName?: string
): string {
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kooperativet Schema//SE',
    `X-WR-CALNAME:${termName}${familyName ? ` - ${familyName}` : ''}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const s of shifts) {
    if (s.isCancelled) continue;
    const sType = typeMap.get(s.shiftTypeId);
    const dateClean = s.date.replace(/-/g, '');
    const startClean = s.startTime.replace(/:/g, '') + '00';
    const endClean = s.endTime.replace(/:/g, '') + '00';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shift-${s.id}@kooperativet.se`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
    lines.push(`DTSTART:${dateClean}T${startClean}`);
    lines.push(`DTEND:${dateClean}T${endClean}`);
    lines.push(`SUMMARY:${sType?.name || s.name}`);
    lines.push(`DESCRIPTION:${sType?.description || 'Pass på föräldrakooperativet'}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
