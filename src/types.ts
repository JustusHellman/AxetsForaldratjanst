export interface ShiftType {
  id: string;
  name: string;
  color: string; // Tailwind color token or hex
  weight: number; // Duty points/value, default 1.0 (e.g. 1.0, 1.5, 2.0)
  defaultStartTime: string;
  defaultEndTime: string;
  description?: string;
}

export interface TemplateShift {
  id: string;
  dayOfWeek: number; // 1 = Monday, 2 = Tuesday, ... 7 = Sunday
  shiftTypeId: string;
  startTime: string;
  endTime: string;
  slots: number; // How many people needed, default 1
}

export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 1-7
  shiftTypeId: string;
  startTime: string;
  endTime: string;
  name: string;
  assignedFamilyId: string | null;
  isCancelled?: boolean;
  notes?: string;
}

export interface Family {
  id: string;
  name: string;
  pointsMultiplier?: number; // e.g. 1.0 for normal, 0.5 for half semester, 2.0 for 2 kids etc.
}

export type SpacingPreference = 'spread' | 'grouped' | 'neutral';

/** How much of a shift type a family wants (question 2). */
export type TypePreferenceLevel = 'none' | 'little' | 'medium' | 'mostly' | 'only';

export interface FamilyWish {
  familyId: string;
  spacingPreference: SpacingPreference;
  typeRatios: Record<string, number>; // percentage target for each shiftTypeId, e.g. { "cleaning": 75, "childcare": 25 } (derived from typeLevels)
  typeLevels?: Record<string, TypePreferenceLevel>; // what the family picked per shift type
  typeFlexible?: boolean; // "Spelar ingen roll": the type mix doesn't count towards satisfaction
  blockedDates: string[]; // YYYY-MM-DD
  blockedShiftIds: string[]; // specific shift IDs
  submittedAt: string;
  notes?: string;
}

export interface FamilyEvaluation {
  familyId: string;
  familyName: string;
  totalShifts: number;
  totalPoints: number;
  satisfactionScore: number; // 0 - 100%
  typeSatisfaction: number; // 0 - 100%
  spacingSatisfaction: number; // 0 - 100%
  blockedConflict: boolean;
  shiftsByType: Record<string, number>;
}

export interface FairnessMetrics {
  fairnessScore: number; // 0 - 100
  worstSatisfaction: number; // Maximin metric
  worstFamilyName: string;
  averageSatisfaction: number;
  blockedConflictsCount: number;
  familyEvaluations: Record<string, FamilyEvaluation>;
}

export type TermStatus = 'setup' | 'collecting' | 'published' | 'completed';

export interface CoopConfig {
  id: string;
  termName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  adminPin: string;
  shiftTypes: ShiftType[];
  weeklyTemplate: TemplateShift[];
  shifts: Shift[];
  families: Family[];
  status: TermStatus;
  shareToken: string;
  updatedAt: string;
}

export interface CoopWishesDoc {
  id: string;
  wishes: Record<string, FamilyWish>;
  updatedAt: string;
}

export interface CoopScheduleDoc {
  id: string;
  assignments: { shiftId: string; familyId: string }[];
  metrics: FairnessMetrics | null;
  isFinalized: boolean;
  updatedAt: string;
}

export interface TermSummary {
  id: string;
  name: string;
  status: TermStatus;
  startDate: string;
  endDate: string;
  updatedAt: string;
}
