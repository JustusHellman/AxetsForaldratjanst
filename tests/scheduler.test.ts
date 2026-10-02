import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFamilySatisfaction, generateShiftsFromTemplate, groupedSpanScore, optimizeSchedule, shiftsOverlap } from '../src/scheduler';
import { makeScenario, rng } from './helpers';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const run = (seed: number, multipliers = false) => {
  const s = makeScenario(seed, { multipliers });
  const res = optimizeSchedule(s.shifts, s.families, s.shiftTypes, s.wishes, s.start, s.end, { random: rng(seed * 7 + 1), maxRestarts: 15, minRestarts: 15 });
  const assign = new Map(res.assignments.map(a => [a.shiftId, a.familyId]));
  return { s, res, assign };
};

test('every shift is assigned to exactly one family', () => {
  for (const seed of SEEDS) {
    const { s, res } = run(seed);
    assert.equal(res.assignments.length, s.shifts.length);
    assert.equal(new Set(res.assignments.map(a => a.shiftId)).size, s.shifts.length);
  }
});

test('no family gets two overlapping shifts', () => {
  for (const seed of SEEDS) {
    const { s, assign } = run(seed);
    for (const a of s.shifts)
      for (const b of s.shifts)
        if (a.id < b.id && assign.get(a.id) === assign.get(b.id)) assert.ok(!shiftsOverlap(a, b), `seed ${seed}: ${a.id} / ${b.id}`);
  }
});

test('blocked dates are respected whenever some family is free', () => {
  for (const seed of SEEDS) {
    const { s, assign } = run(seed);
    for (const sh of s.shifts) {
      const fam = assign.get(sh.id)!;
      const blocked = (id: string) => s.wishes[id]?.blockedDates.includes(sh.date);
      const someoneFree = s.families.some(f => !blocked(f.id));
      if (someoneFree) assert.ok(!blocked(fam), `seed ${seed}: ${sh.id} given to blocked ${fam}`);
    }
  }
});

test('points are shared evenly (within one shift weight)', () => {
  for (const seed of SEEDS) {
    const { s, res } = run(seed);
    const maxWeight = Math.max(...s.shiftTypes.map(t => t.weight));
    const pts = Object.values(res.metrics.familyEvaluations).map(e => e.totalPoints);
    assert.ok(Math.max(...pts) - Math.min(...pts) <= maxWeight + 0.01, `seed ${seed}: ${pts}`);
  }
});

test('points multipliers are respected', () => {
  for (const seed of SEEDS.slice(0, 8)) {
    const { s, res } = run(seed, true);
    const total = s.shifts.reduce((sum, sh) => sum + (s.shiftTypes.find(t => t.id === sh.shiftTypeId)!.weight), 0);
    const totalMult = s.families.reduce((sum, f) => sum + (f.pointsMultiplier ?? 1), 0);
    for (const f of s.families) {
      const target = (total * (f.pointsMultiplier ?? 1)) / totalMult;
      assert.ok(Math.abs(res.metrics.familyEvaluations[f.id].totalPoints - target) <= 2.01, `seed ${seed}: ${f.id}`);
    }
  }
});

test('reported metrics match a fresh evaluation and stay reasonable', () => {
  for (const seed of SEEDS) {
    const { s, res } = run(seed);
    assert.ok(res.metrics.worstSatisfaction >= 40, `seed ${seed}: worst ${res.metrics.worstSatisfaction}`);
    assert.ok(res.metrics.averageSatisfaction >= 75, `seed ${seed}: avg ${res.metrics.averageSatisfaction}`);
    const min = Math.min(...Object.values(res.metrics.familyEvaluations).map(e => e.satisfactionScore));
    assert.equal(res.metrics.worstSatisfaction, min);
  }
});

test('shift IDs are stable when a template row is added', () => {
  const types = [{ id: 'c', name: 'Städ', color: 'emerald', weight: 1, defaultStartTime: '18:00', defaultEndTime: '20:00' }];
  const tpl = [{ id: 'a', dayOfWeek: 1, shiftTypeId: 'c', startTime: '18:00', endTime: '20:00', slots: 2 }];
  const before = generateShiftsFromTemplate('2027-01-11', '2027-03-01', tpl, types);
  const after = generateShiftsFromTemplate('2027-01-11', '2027-03-01', [...tpl, { ...tpl[0], id: 'b', dayOfWeek: 3 }], types);
  const ids = new Set(after.map(s => s.id));
  assert.ok(before.every(s => ids.has(s.id)));
});

test('overlap detection', () => {
  const d = '2027-01-11';
  assert.ok(shiftsOverlap({ date: d, startTime: '08:30', endTime: '15:00' }, { date: d, startTime: '10:00', endTime: '13:00' }));
  assert.ok(!shiftsOverlap({ date: d, startTime: '08:30', endTime: '15:00' }, { date: d, startTime: '15:00', endTime: '18:00' }));
  assert.ok(!shiftsOverlap({ date: d, startTime: '08:30', endTime: '15:00' }, { date: '2027-01-12', startTime: '08:30', endTime: '15:00' }));
});

test('grouped score: compact = 100, whole term = 25', () => {
  assert.equal(groupedSpanScore(8, 8, 60), 100);
  assert.equal(groupedSpanScore(60, 8, 60), 25);
  assert.ok(groupedSpanScore(20, 8, 60) < 100 && groupedSpanScore(20, 8, 60) > 25);
});

test('"Spelar ingen roll" softens the type part to a quarter', () => {
  const types = [
    { id: 'c', name: 'Städ', color: 'emerald', weight: 1, defaultStartTime: '18:00', defaultEndTime: '20:00' },
    { id: 'b', name: 'Barn', color: 'amber', weight: 1, defaultStartTime: '08:00', defaultEndTime: '15:00' },
  ];
  const shifts = generateShiftsFromTemplate('2027-01-11', '2027-02-28', [{ id: 'x', dayOfWeek: 1, shiftTypeId: 'c', startTime: '18:00', endTime: '20:00', slots: 1 }], types).slice(0, 4);
  const base = { familyId: 'f', spacingPreference: 'neutral' as const, typeRatios: { c: 50, b: 50 }, blockedDates: [], blockedShiftIds: [], submittedAt: 'x' };
  const fam = { id: 'f', name: 'F' };
  const strict = evaluateFamilySatisfaction(fam, shifts, base, types, 50).typeSatisfaction;
  const soft = evaluateFamilySatisfaction(fam, shifts, { ...base, typeFlexible: true }, types, 50).typeSatisfaction;
  assert.equal(strict, 50);
  assert.equal(soft, Math.round(100 - 50 * 0.25));
});

test('a family that blocked almost everything still gets its share of points (shown as conflict)', () => {
  const types = [
    { id: 'c', name: 'Städ', color: 'emerald', weight: 1, defaultStartTime: '18:00', defaultEndTime: '20:30' },
    { id: 'b', name: 'Barn', color: 'amber', weight: 1, defaultStartTime: '08:30', defaultEndTime: '15:00' },
  ];
  const tpl = [
    { id: 't1', dayOfWeek: 1, shiftTypeId: 'b', startTime: '08:30', endTime: '15:00', slots: 1 },
    { id: 't2', dayOfWeek: 1, shiftTypeId: 'c', startTime: '18:00', endTime: '20:30', slots: 1 },
    { id: 't3', dayOfWeek: 3, shiftTypeId: 'c', startTime: '18:00', endTime: '20:30', slots: 1 },
  ];
  const shifts = generateShiftsFromTemplate('2027-01-11', '2027-06-11', tpl, types);
  const families = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `F${i}` }));
  const dates = [...new Set(shifts.map(s => s.date))];
  const wishes = { f0: { familyId: 'f0', spacingPreference: 'neutral' as const, typeRatios: { c: 50, b: 50 }, blockedDates: dates.slice(2), blockedShiftIds: [], submittedAt: 'x' } };
  const res = optimizeSchedule(shifts, families, types, wishes, '2027-01-11', '2027-06-11', { random: rng(3), maxRestarts: 10, minRestarts: 10 });
  const pts = Object.values(res.metrics.familyEvaluations).map(e => e.totalPoints);
  assert.ok(Math.max(...pts) - Math.min(...pts) <= 1.01, String(pts));
  assert.ok(res.metrics.familyEvaluations.f0.blockedConflict);
  assert.equal(res.metrics.blockedConflictsCount, 1);
});
