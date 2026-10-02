import { ShiftType, TypePreferenceLevel } from './types';

/**
 * Question 2 ("Vilken sorts pass föredrar ni?") is answered per shift type on a five-step scale.
 * The scale is relative to how common each type is: "Mellan" on every type means the
 * preschool's natural mix, "Mest" means about twice the normal share, "Lite" about half.
 */
export const LEVELS: TypePreferenceLevel[] = ['none', 'little', 'medium', 'mostly', 'only'];

const MULTIPLIER: Record<TypePreferenceLevel, number> = {
  none: 0,
  little: 0.5,
  medium: 1,
  mostly: 2,
  only: 1, // handled separately: all other types become 0
};

/** With two types, picking a level for one fixes the other (Mest städ = Lite barngrupp, ...). */
export const MIRROR: Record<TypePreferenceLevel, TypePreferenceLevel> = {
  none: 'only',
  little: 'mostly',
  medium: 'medium',
  mostly: 'little',
  only: 'none',
};

export function defaultLevels(shiftTypes: ShiftType[]): Record<string, TypePreferenceLevel> {
  return Object.fromEntries(shiftTypes.map(t => [t.id, 'medium' as TypePreferenceLevel]));
}

/**
 * Applies one change and keeps the whole answer consistent:
 *  - two types: the other type mirrors the choice
 *  - "Bara" on one type sets all others to "Inget"
 *  - choosing something else while another type is "Bara" turns that one into "Mest"
 *  - at least one type always stays wanted; if only one is left it becomes "Bara"
 */
export function applyLevelChange(
  shiftTypes: ShiftType[],
  current: Record<string, TypePreferenceLevel>,
  typeId: string,
  level: TypePreferenceLevel
): Record<string, TypePreferenceLevel> {
  const ids = shiftTypes.map(t => t.id);
  const next: Record<string, TypePreferenceLevel> = { ...defaultLevels(shiftTypes), ...current, [typeId]: level };

  if (ids.length === 2) {
    const other = ids.find(id => id !== typeId)!;
    next[other] = MIRROR[level];
    return next;
  }

  if (level === 'only') {
    ids.forEach(id => {
      if (id !== typeId) next[id] = 'none';
    });
    return next;
  }

  ids.forEach(id => {
    if (id !== typeId && next[id] === 'only') next[id] = 'mostly';
  });

  const wanted = ids.filter(id => next[id] !== 'none');
  if (wanted.length === 0) {
    // Can't want nothing at all: the other types go back to "Mellan"
    ids.forEach(id => {
      if (id !== typeId) next[id] = 'medium';
    });
  } else if (wanted.length === 1) {
    next[wanted[0]] = 'only';
  }
  return next;
}

/**
 * Turns the levels into target percentages (what the scheduler aims for), based on each
 * type's natural share of the term's shifts. Percentages are whole numbers summing to 100.
 */
export function levelsToRatios(
  shiftTypes: ShiftType[],
  levels: Record<string, TypePreferenceLevel>,
  naturalRatios: Record<string, number>
): Record<string, number> {
  const ids = shiftTypes.map(t => t.id);
  if (ids.length === 0) return {};
  const only = ids.find(id => levels[id] === 'only');
  const weights = ids.map(id => {
    if (only) return id === only ? 1 : 0;
    const natural = Math.max(naturalRatios[id] ?? 0, 0.0001);
    return natural * MULTIPLIER[levels[id] ?? 'medium'];
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map(w => (w / total) * 100);
  // Largest-remainder rounding so the result sums to exactly 100
  const floored = raw.map(Math.floor);
  let rest = 100 - floored.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (rest > 0) {
        floored[i]++;
        rest--;
      }
    });
  return Object.fromEntries(ids.map((id, i) => [id, floored[i]]));
}

/** Best guess of levels for wishes saved with the old percentage slider. */
export function ratiosToLevels(
  shiftTypes: ShiftType[],
  ratios: Record<string, number>,
  naturalRatios: Record<string, number>
): Record<string, TypePreferenceLevel> {
  const result: Record<string, TypePreferenceLevel> = {};
  shiftTypes.forEach(t => {
    const r = ratios[t.id] ?? 0;
    const natural = Math.max(naturalRatios[t.id] ?? 0, 1);
    const rel = r / natural;
    result[t.id] = r >= 99 ? 'only' : r <= 0 ? 'none' : rel < 0.75 ? 'little' : rel < 1.4 ? 'medium' : 'mostly';
  });
  return result;
}
