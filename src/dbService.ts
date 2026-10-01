import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { generateShiftsFromTemplate } from './scheduler';
import {
  CoopConfig,
  CoopScheduleDoc,
  CoopWishesDoc,
  Family,
  FamilyWish,
  ShiftType,
  TemplateShift,
  TermSummary,
} from './types';

export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  {
    id: 'cleaning',
    name: 'Städpass (kväll)',
    color: 'emerald',
    weight: 1.0,
    defaultStartTime: '18:00',
    defaultEndTime: '20:30',
    description: 'Städning av lokaler, toaletter, kök och sopkärl efter stängning.',
  },
  {
    id: 'childcare',
    name: 'Barngrupp (dagtid)',
    color: 'amber',
    weight: 1.0,
    defaultStartTime: '08:30',
    defaultEndTime: '15:00',
    description: 'Föräldrainsats i barngruppen till stöd för ordinarie pedagoger.',
  },
];

export const DEFAULT_WEEKLY_TEMPLATE: TemplateShift[] = [
  { id: 't1', dayOfWeek: 1, shiftTypeId: 'childcare', startTime: '08:30', endTime: '15:00', slots: 1 },
  { id: 't2', dayOfWeek: 1, shiftTypeId: 'cleaning', startTime: '18:00', endTime: '20:30', slots: 1 },
  { id: 't3', dayOfWeek: 3, shiftTypeId: 'childcare', startTime: '08:30', endTime: '15:00', slots: 1 },
  { id: 't4', dayOfWeek: 3, shiftTypeId: 'cleaning', startTime: '18:00', endTime: '20:30', slots: 1 },
  { id: 't5', dayOfWeek: 5, shiftTypeId: 'cleaning', startTime: '18:00', endTime: '20:30', slots: 1 },
];

export const DEFAULT_FAMILIES: Family[] = [
  { id: 'fam-andersson', name: 'Familjen Andersson', pointsMultiplier: 1.0 },
  { id: 'fam-bergstrom', name: 'Familjen Bergström', pointsMultiplier: 1.0 },
  { id: 'fam-carlsson', name: 'Familjen Carlsson', pointsMultiplier: 1.0 },
  { id: 'fam-dahlberg', name: 'Familjen Dahlberg', pointsMultiplier: 1.0 },
  { id: 'fam-ekholm', name: 'Familjen Ekholm', pointsMultiplier: 1.0 },
  { id: 'fam-forsberg', name: 'Familjen Forsberg', pointsMultiplier: 1.0 },
  { id: 'fam-gustafsson', name: 'Familjen Gustafsson', pointsMultiplier: 1.0 },
  { id: 'fam-hellstrom', name: 'Familjen Hellström', pointsMultiplier: 1.0 },
  { id: 'fam-isaksson', name: 'Familjen Isaksson', pointsMultiplier: 1.0 },
  { id: 'fam-jansson', name: 'Familjen Jansson', pointsMultiplier: 1.0 },
  { id: 'fam-karlsson', name: 'Familjen Karlsson', pointsMultiplier: 1.0 },
  { id: 'fam-lindqvist', name: 'Familjen Lindqvist', pointsMultiplier: 1.0 },
];

/**
 * Intelligent term dates guesser based on current date
 * Sweden semester rhythms:
 * - Spring (Jan - Jun): Suggests Autumn semester (mid August to mid December)
 * - Autumn (Jul - Dec): Suggests Spring semester of next year (mid January to mid June)
 */
export function guessNextTermDefaults(now = new Date()): {
  termName: string;
  startDate: string;
  endDate: string;
} {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  if (month >= 1 && month <= 6) {
    return {
      termName: `Höstterminen ${year}`,
      startDate: `${year}-08-17`,
      endDate: `${year}-12-18`,
    };
  } else {
    return {
      termName: `Vårterminen ${year + 1}`,
      startDate: `${year + 1}-01-11`,
      endDate: `${year + 1}-06-11`,
    };
  }
}

// In-memory caches to reduce Firestore reads/writes gratis
let _cachedGlobalAdminPin: string | null = null;
let _cachedTermsIndex: TermSummary[] | null = null;

export async function fetchGlobalAdminPin(): Promise<string> {
  if (_cachedGlobalAdminPin) return _cachedGlobalAdminPin;
  try {
    const snap = await getDoc(doc(db, 'coop', '_settings'));
    if (snap.exists() && snap.data()?.adminPin) {
      _cachedGlobalAdminPin = String(snap.data().adminPin);
      return _cachedGlobalAdminPin;
    }
    await setDoc(doc(db, 'coop', '_settings'), { adminPin: '1234', updatedAt: new Date().toISOString() });
    _cachedGlobalAdminPin = '1234';
    return '1234';
  } catch {
    return '1234';
  }
}

export async function saveGlobalAdminPin(pin: string): Promise<void> {
  const path = 'coop/_settings';
  _cachedGlobalAdminPin = pin;
  try {
    await setDoc(doc(db, 'coop', '_settings'), { adminPin: pin, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function createInitialConfig(coopId = 'main', name = 'Höstterminen 2026', startDate = '2026-08-17', endDate = '2026-12-18'): CoopConfig {
  const shifts = generateShiftsFromTemplate(startDate, endDate, DEFAULT_WEEKLY_TEMPLATE, DEFAULT_SHIFT_TYPES);

  return {
    id: coopId,
    termName: name,
    startDate,
    endDate,
    adminPin: '1234',
    shiftTypes: DEFAULT_SHIFT_TYPES,
    weeklyTemplate: DEFAULT_WEEKLY_TEMPLATE,
    shifts,
    families: DEFAULT_FAMILIES,
    status: 'collecting',
    shareToken: coopId,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchTermsIndex(forceRefresh = false): Promise<TermSummary[]> {
  if (!forceRefresh && _cachedTermsIndex) {
    return _cachedTermsIndex;
  }

  const path = 'coop/_index';
  try {
    const snap = await getDoc(doc(db, 'coop', '_index'));
    if (snap.exists() && snap.data()?.terms) {
      _cachedTermsIndex = snap.data().terms as TermSummary[];
      return _cachedTermsIndex;
    }
    const initial: TermSummary[] = [
      {
        id: 'main',
        name: 'Höstterminen 2026',
        status: 'collecting',
        startDate: '2026-08-17',
        endDate: '2026-12-18',
        updatedAt: new Date().toISOString(),
      },
    ];
    await setDoc(doc(db, 'coop', '_index'), { id: '_index', terms: initial });
    _cachedTermsIndex = initial;
    return initial;
  } catch (error) {
    return (
      _cachedTermsIndex || [
        {
          id: 'main',
          name: 'Höstterminen 2026',
          status: 'collecting',
          startDate: '2026-08-17',
          endDate: '2026-12-18',
          updatedAt: new Date().toISOString(),
        },
      ]
    );
  }
}

export async function saveTermsIndex(terms: TermSummary[]): Promise<void> {
  const path = 'coop/_index';
  _cachedTermsIndex = terms;
  try {
    await setDoc(doc(db, 'coop', '_index'), { id: '_index', terms });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchCoopConfig(coopId = 'main'): Promise<CoopConfig> {
  const path = `coop_configs/${coopId}`;
  try {
    const snap = await getDoc(doc(db, 'coop_configs', coopId));
    if (snap.exists()) {
      return snap.data() as CoopConfig;
    }
    const initial = createInitialConfig(coopId);
    await setDoc(doc(db, 'coop_configs', coopId), initial);
    return initial;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveCoopConfig(config: CoopConfig): Promise<void> {
  const path = `coop_configs/${config.id}`;
  try {
    const toSave: CoopConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'coop_configs', config.id), toSave);

    // Keep term summary index in sync efficiently using cached index
    const terms = await fetchTermsIndex();
    const existingIdx = terms.findIndex(t => t.id === config.id);
    const summary: TermSummary = {
      id: config.id,
      name: config.termName,
      status: config.status,
      startDate: config.startDate,
      endDate: config.endDate,
      updatedAt: new Date().toISOString(),
    };

    let updatedTerms: TermSummary[];
    if (existingIdx >= 0) {
      updatedTerms = [...terms];
      updatedTerms[existingIdx] = summary;
    } else {
      updatedTerms = [...terms, summary];
    }
    await saveTermsIndex(updatedTerms);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTerm(termId: string): Promise<TermSummary[]> {
  const path = `coop_configs/${termId}`;
  try {
    await deleteDoc(doc(db, 'coop_configs', termId));
    await deleteDoc(doc(db, 'wishes', termId));
    await deleteDoc(doc(db, 'schedules', termId));

    const currentTerms = await fetchTermsIndex();
    const updatedTerms = currentTerms.filter(t => t.id !== termId);
    await saveTermsIndex(updatedTerms);
    return updatedTerms;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    return [];
  }
}

export async function createNewTerm(
  newTermId: string,
  termName: string,
  startDate: string,
  endDate: string,
  copyFromConfig?: CoopConfig
): Promise<CoopConfig> {
  // If copyFromConfig is provided, copy its setup and ensure deduplicated families
  let shiftTypes: ShiftType[] = [];
  let weeklyTemplate: TemplateShift[] = [];
  let families: Family[] = [];
  let shifts: any[] = [];

  if (copyFromConfig) {
    shiftTypes = copyFromConfig.shiftTypes ? JSON.parse(JSON.stringify(copyFromConfig.shiftTypes)) : [];
    weeklyTemplate = copyFromConfig.weeklyTemplate ? JSON.parse(JSON.stringify(copyFromConfig.weeklyTemplate)) : [];
    
    // Deduplicate families by name & ID
    const famMap = new Map<string, Family>();
    (copyFromConfig.families || []).forEach(f => {
      const cleanName = f.name.trim();
      if (cleanName && !famMap.has(cleanName.toLowerCase())) {
        famMap.set(cleanName.toLowerCase(), {
          id: f.id || `fam-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          pointsMultiplier: f.pointsMultiplier || 1.0,
        });
      }
    });
    families = Array.from(famMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    // Generate fresh shifts for the new date range from the weekly template
    if (weeklyTemplate.length > 0 && shiftTypes.length > 0) {
      shifts = generateShiftsFromTemplate(startDate, endDate, weeklyTemplate, shiftTypes);
    }
  }

  const newConfig: CoopConfig = {
    id: newTermId,
    termName,
    startDate,
    endDate,
    adminPin: '1234',
    shiftTypes,
    weeklyTemplate,
    shifts,
    families,
    status: 'setup',
    shareToken: newTermId,
    updatedAt: new Date().toISOString(),
  };

  await saveCoopConfig(newConfig);

  // Initialize empty wishes and schedule docs for the new term
  await setDoc(doc(db, 'wishes', newTermId), { id: newTermId, wishes: {}, updatedAt: new Date().toISOString() });
  await setDoc(doc(db, 'schedules', newTermId), { id: newTermId, assignments: [], metrics: null, isFinalized: false, updatedAt: new Date().toISOString() });

  return newConfig;
}

export async function fetchWishes(coopId = 'main'): Promise<CoopWishesDoc> {
  const path = `wishes/${coopId}`;
  try {
    const snap = await getDoc(doc(db, 'wishes', coopId));
    if (snap.exists()) {
      return snap.data() as CoopWishesDoc;
    }
    const initial: CoopWishesDoc = {
      id: coopId,
      wishes: {},
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'wishes', coopId), initial);
    return initial;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveFamilyWish(coopId: string, wish: FamilyWish): Promise<void> {
  const path = `wishes/${coopId}`;
  try {
    const current = await fetchWishes(coopId);
    const updated: CoopWishesDoc = {
      id: coopId,
      wishes: {
        ...current.wishes,
        [wish.familyId]: wish,
      },
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'wishes', coopId), updated);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchSchedule(coopId = 'main'): Promise<CoopScheduleDoc> {
  const path = `schedules/${coopId}`;
  try {
    const snap = await getDoc(doc(db, 'schedules', coopId));
    if (snap.exists()) {
      return snap.data() as CoopScheduleDoc;
    }
    const initial: CoopScheduleDoc = {
      id: coopId,
      assignments: [],
      metrics: null,
      isFinalized: false,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'schedules', coopId), initial);
    return initial;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveSchedule(schedule: CoopScheduleDoc): Promise<void> {
  const path = `schedules/${schedule.id}`;
  try {
    const toSave: CoopScheduleDoc = {
      ...schedule,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'schedules', schedule.id), toSave);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
