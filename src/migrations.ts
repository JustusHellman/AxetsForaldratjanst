import { FamilyWish, Shift } from './types';

// Old shift IDs (before stable IDs): shift-<date>-<shiftTypeId>-<slot>-<running counter>
const OLD_ID = /^shift-(\d{4}-\d{2}-\d{2})-(.+)-(\d+)-(\d+)$/;

/**
 * Blocked single shifts saved with the old shift IDs stop matching once a term's shifts are
 * regenerated (new IDs: shift-<date>-<templateRow>-<slot>). This maps such IDs to the current
 * shift with the same date, shift type and slot. IDs that still exist are left untouched, and IDs
 * that can't be matched are kept as they are (harmless). Nothing is written to the database; a
 * converted wish is saved the next time the family saves.
 */
export function migrateBlockedShiftIds(wish: FamilyWish, shifts: Shift[]): FamilyWish {
  const ids = wish.blockedShiftIds || [];
  if (ids.length === 0) return wish;
  const existing = new Set(shifts.map(s => s.id));
  let changed = false;
  const migrated = ids.map(id => {
    if (existing.has(id)) return id;
    const m = OLD_ID.exec(id);
    if (!m) return id;
    const [, date, typeId, slot] = m;
    const match = shifts.find(s => s.date === date && s.shiftTypeId === typeId && s.id.endsWith(`-${slot}`));
    if (!match) return id;
    changed = true;
    return match.id;
  });
  return changed ? { ...wish, blockedShiftIds: Array.from(new Set(migrated)) } : wish;
}

export function migrateWishes(wishes: Record<string, FamilyWish>, shifts: Shift[]): Record<string, FamilyWish> {
  const out: Record<string, FamilyWish> = {};
  for (const [id, w] of Object.entries(wishes)) out[id] = migrateBlockedShiftIds(w, shifts);
  return out;
}
