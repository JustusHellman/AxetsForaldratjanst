import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  FolderPlus,
  HelpCircle,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Unlock,
  User,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  createNewTerm,
  deleteTerm,
  fetchCoopConfig,
  fetchGlobalAdminPin,
  fetchTermsIndex,
  guessNextTermDefaults,
  saveGlobalAdminPin,
} from '../dbService';
import {
  calculateDefaultShiftRatios,
  calculateSemesterTargetPoints,
  generateShiftsFromTemplate,
  parseLocalDate,
} from '../scheduler';
import { runOptimizer } from '../runOptimizer';
import { safeGet, safeSet } from '../safeStorage';
import { findScheduleWarnings } from '../scheduleWarnings';
import { WishResultSummary } from './WishResultSummary';
import { Language, translations } from '../translations';
import {
  CoopConfig,
  CoopScheduleDoc,
  Family,
  FamilyWish,
  FairnessMetrics,
  Shift,
  ShiftType,
  TemplateShift,
  TermStatus,
  TermSummary,
} from '../types';
import { CalendarMonth } from './CalendarMonth';
import { ShiftBadge } from './ShiftBadge';

interface AdminViewProps {
  config: CoopConfig;
  wishes: Record<string, FamilyWish>;
  scheduleDoc: CoopScheduleDoc;
  onSaveConfig: (newConfig: CoopConfig) => Promise<void>;
  onSaveSchedule: (newSchedule: CoopScheduleDoc) => Promise<void>;
  /** Re-reads wishes from the database (so late submissions are included). */
  onReloadWishes?: () => Promise<Record<string, FamilyWish>>;
  /** Called when the correct PIN has been entered. */
  onAuthenticated?: () => void;
  onSwitchTerm?: (termId: string) => Promise<void>;
  onSwitchToParentView?: () => void;
  showChangePinModalExternal?: boolean;
  onCloseChangePinModal?: () => void;
  showNewTermModalExternal?: boolean;
  onCloseNewTermModal?: () => void;
  lang: Language;
}

export const AdminView: React.FC<AdminViewProps> = ({
  config,
  wishes,
  scheduleDoc,
  onSaveConfig,
  onSaveSchedule,
  onReloadWishes,
  onAuthenticated,
  onSwitchTerm,
  onSwitchToParentView,
  showChangePinModalExternal = false,
  onCloseChangePinModal,
  showNewTermModalExternal = false,
  onCloseNewTermModal,
  lang,
}) => {
  const t = translations[lang];

  // Persistent PIN authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return safeGet('coop_admin_logged_in', 'sessionStorage') === 'true';
  });
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<boolean>(false);
  // null until the PIN has been loaded; login is not possible before that (fail closed)
  const [storedGlobalPin, setStoredGlobalPin] = useState<string | null>(null);
  const [pinLoadError, setPinLoadError] = useState<boolean>(false);

  // Change PIN modal state
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [newPinValue, setNewPinValue] = useState('');

  // Delete term confirmation modal state
  const [showDeleteTermModal, setShowDeleteTermModal] = useState(false);
  const [isDeletingTerm, setIsDeletingTerm] = useState(false);

  // Active admin step
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isGeneratingShifts, setIsGeneratingShifts] = useState<boolean>(false);
  const [shiftsGeneratedDone, setShiftsGeneratedDone] = useState<boolean>(() => (config.shifts?.length || 0) > 0);
  const [optimizerDone, setOptimizerDone] = useState<boolean>(() => Boolean(scheduleDoc?.metrics));
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string>('');
  const [activeAdminMonthIdx, setActiveAdminMonthIdx] = useState<number>(0);

  // Working copy of config
  const [termName, setTermName] = useState(config.termName);
  const [startDate, setStartDate] = useState(config.startDate);
  const [endDate, setEndDate] = useState(config.endDate);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>(config.shiftTypes);
  const [weeklyTemplate, setWeeklyTemplate] = useState<TemplateShift[]>(config.weeklyTemplate);
  const [shifts, setShifts] = useState<Shift[]>(config.shifts);
  const [families, setFamilies] = useState<Family[]>(config.families);

  // Compute months spanning the semester
  const semesterMonths = React.useMemo(() => {
    const startD = parseLocalDate(startDate || '2026-08-17');
    const endD = parseLocalDate(endDate || '2026-12-18');
    const months: { year: number; month: number }[] = [];
    const cur = new Date(startD.getFullYear(), startD.getMonth(), 1, 12, 0, 0);
    const endLimit = new Date(endD.getFullYear(), endD.getMonth(), 1, 12, 0, 0);
    while (cur <= endLimit) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.length > 0 ? months : [{ year: startD.getFullYear(), month: startD.getMonth() }];
  }, [startDate, endDate]);

  // Terms archive state
  const [termsList, setTermsList] = useState<TermSummary[]>([]);
  const [showNewTermModal, setShowNewTermModal] = useState(false);
  
  // Intelligent guessed dates for new term creation
  const initialGuessed = guessNextTermDefaults();
  const [newTermNameInput, setNewTermNameInput] = useState(initialGuessed.termName);
  const [newTermStartInput, setNewTermStartInput] = useState(initialGuessed.startDate);
  const [newTermEndInput, setNewTermEndInput] = useState(initialGuessed.endDate);
  const [selectedCopyTermId, setSelectedCopyTermId] = useState<string>(config.id);

  // Share link modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  // Bulk add families state
  const [bulkFamiliesText, setBulkFamiliesText] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');

  // Individual shift edit modal
  const [selectedShiftForEdit, setSelectedShiftForEdit] = useState<Shift | null>(null);

  // Shift type weights editing helper
  const [typeWeightInputs, setTypeWeightInputs] = useState<Record<string, string>>({});

  // New shift type form
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeWeight, setNewTypeWeight] = useState('1.0');
  const [newTypeColor, setNewTypeColor] = useState('blue');
  const [newTypeStart, setNewTypeStart] = useState('18:00');
  const [newTypeEnd, setNewTypeEnd] = useState('20:30');

  // Single shift add modal
  const [showAddSingleModal, setShowAddSingleModal] = useState(false);
  const [newShiftDate, setNewShiftDate] = useState(config.startDate || '2026-08-17');
  const [newShiftTypeId, setNewShiftTypeId] = useState(config.shiftTypes[0]?.id || '');
  const [newShiftStart, setNewShiftStart] = useState(config.shiftTypes[0]?.defaultStartTime || '18:00');
  const [newShiftEnd, setNewShiftEnd] = useState(config.shiftTypes[0]?.defaultEndTime || '20:30');

  // Which family's "wished vs. got" row is open in the results table
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null);

  // Solver metrics
  const [metrics, setMetrics] = useState<FairnessMetrics | null>(scheduleDoc.metrics);

  const isTermLocked = config.status === 'published' || config.status === 'completed';

  // Sync external PIN modal prop
  useEffect(() => {
    if (showChangePinModalExternal) {
      setShowChangePinModal(true);
    }
  }, [showChangePinModalExternal]);

  // Sync metrics and assignedFamilyId when scheduleDoc updates
  useEffect(() => {
    if (scheduleDoc?.metrics) {
      setMetrics(scheduleDoc.metrics);
      setOptimizerDone(true);
    } else {
      setOptimizerDone(false);
    }
    if (scheduleDoc?.assignments && scheduleDoc.assignments.length > 0) {
      const assignmentMap = new Map(scheduleDoc.assignments.map(a => [a.shiftId, a.familyId]));
      setShifts(prev =>
        prev.map(s => {
          const assigned = assignmentMap.get(s.id);
          return assigned ? { ...s, assignedFamilyId: assigned } : s;
        })
      );
    }
  }, [scheduleDoc]);

  // Clamp activeAdminMonthIdx if semesterMonths length changes
  useEffect(() => {
    if (activeAdminMonthIdx >= semesterMonths.length) {
      setActiveAdminMonthIdx(Math.max(0, semesterMonths.length - 1));
    }
  }, [semesterMonths, activeAdminMonthIdx]);

  // Sync external New Term modal prop
  useEffect(() => {
    if (showNewTermModalExternal) {
      openNewTermModal();
    }
  }, [showNewTermModalExternal]);

  // Fetch global PIN from Firebase
  useEffect(() => {
    fetchGlobalAdminPin()
      .then(pin => {
        if (pin) setStoredGlobalPin(pin);
      })
      .catch(err => {
        console.error('Failed to load global admin PIN:', err);
        setPinLoadError(true);
      });
  }, []);

  // Sync state when incoming config changes
  useEffect(() => {
    setTermName(config.termName);
    setStartDate(config.startDate);
    setEndDate(config.endDate);
    setShiftTypes(config.shiftTypes || []);
    setWeeklyTemplate(config.weeklyTemplate || []);
    setShifts(config.shifts || []);
    setShiftsGeneratedDone((config.shifts || []).length > 0);
    
    // Sort families alphabetically in Swedish locale
    const sortedFams = [...(config.families || [])].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    setFamilies(sortedFams);

    const initialInputs: Record<string, string> = {};
    (config.shiftTypes || []).forEach(st => {
      initialInputs[st.id] = String(st.weight || 1.0);
    });
    setTypeWeightInputs(initialInputs);
  }, [config]);

  // Load terms index with revalidation
  useEffect(() => {
    fetchTermsIndex(true)
      .then(terms => {
        if (terms) setTermsList(terms);
      })
      .catch(err => console.error('Failed to fetch terms list:', err));
  }, [config.id]);

  // Reset new term defaults based on current date whenever modal opens
  const openNewTermModal = () => {
    const guessed = guessNextTermDefaults();
    setNewTermNameInput(guessed.termName);
    setNewTermStartInput(guessed.startDate);
    setNewTermEndInput(guessed.endDate);
    setSelectedCopyTermId(config.id);
    setShowNewTermModal(true);
  };

  const closeNewTermModal = () => {
    setShowNewTermModal(false);
    if (onCloseNewTermModal) onCloseNewTermModal();
  };

  // Instant scroll to top on step switch
  const goToStep = (stepNumber: number) => {
    setActiveStep(stepNumber);
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  };

  const flashSuccess = (msg: string) => {
    setSaveSuccessMsg(msg);
    setTimeout(() => setSaveSuccessMsg(''), 3500);
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storedGlobalPin) {
      setPinError(true);
      return;
    }
    if (pinInput.trim() === storedGlobalPin) {
      setIsAuthenticated(true);
      if (onAuthenticated) onAuthenticated();
      setPinError(false);
      safeSet('coop_admin_logged_in', 'true', 'sessionStorage');
    } else {
      setPinError(true);
    }
  };

  const handleChangePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPinValue.trim().length < 4) return;
    try {
      await saveGlobalAdminPin(newPinValue.trim());
      setStoredGlobalPin(newPinValue.trim());
      setShowChangePinModal(false);
      if (onCloseChangePinModal) onCloseChangePinModal();
      setNewPinValue('');
      flashSuccess(t.admin.pinUpdatedSuccess);
    } catch (err) {
      console.error('Failed to save new PIN:', err);
    }
  };

  const handlePersistConfig = async (customOverrides: Partial<CoopConfig> = {}) => {
    setIsSaving(true);
    try {
      const updatedConfig: CoopConfig = {
        ...config,
        termName,
        startDate,
        endDate,
        shiftTypes,
        weeklyTemplate,
        shifts,
        families,
        ...customOverrides,
      };
      await onSaveConfig(updatedConfig);
      flashSuccess(t.app.savedNotice);
      return updatedConfig;
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateAllShifts = async () => {
    if (isTermLocked) return;
    const hasAssignments = shifts.some(s => s.assignedFamilyId) || Boolean(scheduleDoc?.metrics);
    if (shifts.length > 0 && typeof window !== 'undefined' && !window.confirm(t.admin.regenerateConfirm)) return;
    setIsGeneratingShifts(true);
    try {
      // IDs are stable (date + template row + slot), so parents' blocked shifts keep matching.
      // Manually added single shifts inside the term are kept.
      const fromTemplate = generateShiftsFromTemplate(startDate, endDate, weeklyTemplate, shiftTypes);
      const singles = shifts
        .filter(s => s.id.startsWith('shift-single-') && s.date >= startDate && s.date <= endDate)
        .map(s => ({ ...s, assignedFamilyId: null }));
      const generated = [...fromTemplate, ...singles].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      setShifts(generated);
      await handlePersistConfig({ shifts: generated });
      if (hasAssignments) {
        // The old schedule no longer matches the shifts: clear it
        await onSaveSchedule({ id: config.id, assignments: [], metrics: null, isFinalized: false, updatedAt: new Date().toISOString() });
        setMetrics(null);
        setOptimizerDone(false);
      }
      setShiftsGeneratedDone(true);
      flashSuccess(`${generated.length} ${t.admin.shiftsGenerated}`);
    } finally {
      setTimeout(() => setIsGeneratingShifts(false), 200);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (isTermLocked) return;
    const updated = shifts.filter(s => s.id !== shiftId);
    setShifts(updated);
    setSelectedShiftForEdit(null);
    await handlePersistConfig({ shifts: updated });
    flashSuccess(t.app.savedNotice);
  };

  const handleAddIndividualShift = async () => {
    if (isTermLocked) return;
    const dateObj = parseLocalDate(newShiftDate);
    const jsDay = dateObj.getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;
    const sType = shiftTypes.find(t => t.id === newShiftTypeId);

    const newShift: Shift = {
      id: `shift-single-${newShiftDate}-${Date.now()}`,
      date: newShiftDate,
      dayOfWeek,
      shiftTypeId: newShiftTypeId,
      startTime: newShiftStart,
      endTime: newShiftEnd,
      name: sType?.name || 'Pass',
      assignedFamilyId: null,
    };

    const updated = [...shifts, newShift].sort((a, b) => a.date.localeCompare(b.date));
    setShifts(updated);
    setShowAddSingleModal(false);
    await handlePersistConfig({ shifts: updated });
    flashSuccess(t.app.savedNotice);
  };

  const handleAddShiftType = () => {
    if (!newTypeName.trim()) return;
    const id = `type-${Date.now()}`;
    const weightVal = parseFloat(newTypeWeight) || 1.0;
    const newType: ShiftType = {
      id,
      name: newTypeName.trim(),
      color: newTypeColor,
      weight: weightVal,
      defaultStartTime: newTypeStart,
      defaultEndTime: newTypeEnd,
    };
    const updatedTypes = [...shiftTypes, newType];
    setShiftTypes(updatedTypes);
    setTypeWeightInputs(prev => ({ ...prev, [id]: String(weightVal) }));
    setNewTypeName('');
  };

  const handleDeleteShiftType = (typeId: string) => {
    if (shiftTypes.length <= 1) return;
    setShiftTypes(shiftTypes.filter(t => t.id !== typeId));
    setWeeklyTemplate(weeklyTemplate.filter(t => t.shiftTypeId !== typeId));
  };

  const handleAddTemplateShift = (dayOfWeek: number) => {
    if (shiftTypes.length === 0) return;
    const firstType = shiftTypes[0];
    const newT: TemplateShift = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dayOfWeek,
      shiftTypeId: firstType.id,
      startTime: firstType.defaultStartTime || '18:00',
      endTime: firstType.defaultEndTime || '20:30',
      slots: 1,
    };
    setWeeklyTemplate([...weeklyTemplate, newT]);
  };

  const handleRemoveTemplateShift = (templateId: string) => {
    setWeeklyTemplate(weeklyTemplate.filter(t => t.id !== templateId));
  };

  const handleAddFamily = () => {
    if (!newFamilyName.trim()) return;
    const clean = newFamilyName.trim();
    if (families.some(f => f.name.toLowerCase() === clean.toLowerCase())) {
      setNewFamilyName('');
      return;
    }
    const id = `fam-${Date.now()}`;
    const newFam: Family = {
      id,
      name: clean,
      pointsMultiplier: 1.0,
    };
    const updated = [...families, newFam].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    setFamilies(updated);
    setNewFamilyName('');
  };

  const handleBulkAddFamilies = () => {
    const lines = bulkFamiliesText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    if (lines.length === 0) return;

    const existingNames = new Set(families.map(f => f.name.toLowerCase()));
    const newFams: Family[] = [];

    lines.forEach((name, idx) => {
      if (!existingNames.has(name.toLowerCase())) {
        existingNames.add(name.toLowerCase());
        newFams.push({
          id: `fam-bulk-${Date.now()}-${idx}`,
          name,
          pointsMultiplier: 1.0,
        });
      }
    });

    const updated = [...families, ...newFams].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    setFamilies(updated);
    setBulkFamiliesText('');
    setShowBulkModal(false);
  };

  const handleRemoveFamily = (familyId: string) => {
    setFamilies(families.filter(f => f.id !== familyId));
    // Their shifts become unassigned instead of pointing at a family that no longer exists
    setShifts(prev => prev.map(s => (s.assignedFamilyId === familyId ? { ...s, assignedFamilyId: null } : s)));
  };

  // Immediate visual feedback with async tick before heavy optimization
  const handleRunOptimizer = async () => {
    if (isTermLocked || families.length === 0) return;
    setIsOptimizing(true);

    // Yield control to React so the loader/spinner renders immediately on screen
    await new Promise(resolve => setTimeout(resolve, 80));

    try {
      // Re-read wishes so families who answered after this page was opened are included
      let latestWishes = wishes;
      if (onReloadWishes) {
        try {
          latestWishes = await onReloadWishes();
        } catch (err) {
          console.error('Could not reload wishes, using the ones already loaded:', err);
        }
      }
      // Only wishes from current families count
      const familyIds = new Set(families.map(f => f.id));
      const currentWishes = Object.fromEntries(Object.entries(latestWishes).filter(([id]) => familyIds.has(id)));

      const { assignments, metrics: solverMetrics } = await runOptimizer({
        shifts,
        families,
        shiftTypes,
        wishes: currentWishes,
        startDate,
        endDate,
      });

      const assignmentMap = new Map(assignments.map(a => [a.shiftId, a.familyId]));
      const updatedShifts = shifts.map(s => ({
        ...s,
        assignedFamilyId: assignmentMap.get(s.id) || null,
      }));

      setShifts(updatedShifts);
      setMetrics(solverMetrics);

      const newScheduleDoc: CoopScheduleDoc = {
        id: config.id,
        assignments,
        metrics: solverMetrics,
        isFinalized: false,
        updatedAt: new Date().toISOString(),
      };
      await onSaveSchedule(newScheduleDoc);
      await handlePersistConfig({ shifts: updatedShifts });

      setOptimizerDone(true);
      flashSuccess(t.admin.schemaOptimizedSuccess);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleTogglePublish = async (publish: boolean) => {
    const newStatus: TermStatus = publish ? 'published' : 'collecting';
    await handlePersistConfig({ status: newStatus });
    if (scheduleDoc) {
      await onSaveSchedule({
        ...scheduleDoc,
        isFinalized: publish,
      });
    }
    flashSuccess(publish ? t.admin.publishedBanner : t.admin.schemaUnpublished);
  };

  const handleToggleComplete = async (complete: boolean) => {
    const newStatus: TermStatus = complete ? 'completed' : 'published';
    await handlePersistConfig({ status: newStatus });
    flashSuccess(complete ? t.admin.termCompletedBanner : t.admin.publishedBanner);
  };

  const handleUpdateShiftDetails = async (editedShift: Shift) => {
    if (isTermLocked) return;
    // Keep weekday in sync if the date was changed
    const jsDay = parseLocalDate(editedShift.date).getDay();
    const updatedShift = { ...editedShift, dayOfWeek: jsDay === 0 ? 7 : jsDay };
    const updated = shifts.map(s => (s.id === updatedShift.id ? updatedShift : s));
    setShifts(updated);
    setSelectedShiftForEdit(null);
    await handlePersistConfig({ shifts: updated });
    // Keep the saved schedule in sync, otherwise the old assignment comes back after publishing
    if (scheduleDoc?.assignments?.length) {
      const assignments = updated
        .filter(s => !s.isCancelled && s.assignedFamilyId)
        .map(s => ({ shiftId: s.id, familyId: s.assignedFamilyId as string }));
      await onSaveSchedule({ ...scheduleDoc, assignments });
    }
    flashSuccess(t.app.savedNotice);
  };

  const handleCreateNewTermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTermNameInput.trim()) return;

    const baseSlug = newTermNameInput
      .trim()
      .toLowerCase()
      .replace(/å/g, 'a')
      .replace(/ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]/g, '_')
      .slice(0, 16);
    const autoId = `${baseSlug || 'term'}_${Date.now().toString(36).slice(-4)}`;

    let sourceConfig: CoopConfig | undefined = undefined;
    if (selectedCopyTermId !== 'none') {
      if (selectedCopyTermId === config.id) {
        sourceConfig = config;
      } else {
        try {
          sourceConfig = (await fetchCoopConfig(selectedCopyTermId)) ?? config;
        } catch {
          sourceConfig = config;
        }
      }
    }

    await createNewTerm(
      autoId,
      newTermNameInput.trim(),
      newTermStartInput,
      newTermEndInput,
      sourceConfig
    );

    closeNewTermModal();
    setNewTermNameInput('');

    if (onSwitchTerm) {
      await onSwitchTerm(autoId);
    }
  };

  const handleDeleteCurrentTerm = async () => {
    if (termsList.length <= 1) return;
    setIsDeletingTerm(true);
    try {
      const remainingTerms = await deleteTerm(config.id);
      setShowDeleteTermModal(false);
      if (remainingTerms.length > 0 && onSwitchTerm) {
        await onSwitchTerm(remainingTerms[0].id);
      }
      flashSuccess(t.admin.termDeletedSuccess);
    } finally {
      setIsDeletingTerm(false);
    }
  };

  const getParentShareUrl = () => {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    return `${origin}${pathname}#/?term=${encodeURIComponent(config.id)}`;
  };

  const handleCopyShareLink = () => {
    navigator.clipboard.writeText(getParentShareUrl()).then(() => {
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2500);
    });
  };

  const handleStartCollectingAndShare = async () => {
    await handlePersistConfig({ status: 'collecting' });
    handleCopyShareLink();
    setShowShareModal(true);
    flashSuccess(t.admin.shareLinkCopied);
  };

  const getStatusBadge = () => {
    switch (config.status) {
      case 'published':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
            {t.app.statusPublished}
          </span>
        );
      case 'collecting':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-ping" />
            {t.app.statusCollecting}
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700">
            <CheckCircle2 className="w-3.5 h-3.5 text-stone-500" />
            {t.app.statusCompleted}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700">
            {t.app.statusSetup}
          </span>
        );
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'published':
        return t.app.statusPublished;
      case 'collecting':
        return t.app.statusCollecting;
      case 'completed':
        return t.app.statusCompleted;
      default:
        return t.app.statusSetup;
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 sm:py-16">
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 sm:p-8 shadow-xs text-center space-y-6">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
            <Lock className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-900 dark:text-stone-100">
              {t.admin.loginTitle}
            </h2>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 mt-1">
              {t.admin.loginSubtitle}
            </p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                maxLength={8}
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                placeholder={t.admin.pinPlaceholder}
                className="w-full text-center tracking-widest text-xl sm:text-2xl font-bold px-4 py-3 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900 dark:text-stone-100"
                autoFocus
              />
              {pinError && !pinLoadError && (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-2">
                  {t.admin.invalidPin}
                </p>
              )}
              {pinLoadError && (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-2">
                  {t.admin.pinLoadError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold rounded-xl shadow-xs transition-colors text-sm sm:text-base cursor-pointer"
            >
              {t.admin.loginButton}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const activeShiftsCount = shifts.length;
  const answeredFamiliesCount = Object.keys(wishes).length;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8 w-full max-w-full">
      {/* Admin Subheader with Term Switcher, Term Status Pill & Step Navigation */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200 dark:border-stone-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg sm:text-2xl font-bold text-stone-900 dark:text-stone-100">
                {termName}
              </h2>
              
              {/* Term Status Pill in Term Overview */}
              {getStatusBadge()}

              {/* Term switcher dropdown with localized status */}
              {termsList.length > 1 && onSwitchTerm && (
                <select
                  value={config.id}
                  onChange={e => onSwitchTerm(e.target.value)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 cursor-pointer"
                >
                  {termsList.map(tm => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name} ({getStatusLabel(tm.status)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">
              {activeShiftsCount} {lang === 'sv' ? 'pass' : 'shifts'} • {families.length} {t.admin.familiesTitle.toLowerCase()} • {answeredFamiliesCount} {t.admin.responsesTitle.toLowerCase()}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* 1. Share link button */}
            <button
              onClick={() => setShowShareModal(true)}
              className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              title={t.app.copyLink}
            >
              <Copy className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t.app.copyLink}</span>
            </button>

            {saveSuccessMsg && (
              <span className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 font-bold flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {saveSuccessMsg}
              </span>
            )}

            {/* 2. Save changes button */}
            <button
              onClick={() => handlePersistConfig()}
              disabled={isSaving}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {isSaving ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>{t.app.saveChanges}</span>
            </button>

            {/* 3. Delete term button in overview bar (last of copy-save-delete) */}
            {termsList.length > 1 && (
              <button
                type="button"
                onClick={() => setShowDeleteTermModal(true)}
                className="px-2.5 py-1.5 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                title={t.admin.deleteTerm}
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>{t.admin.deleteTerm}</span>
              </button>
            )}
          </div>
        </div>

        {/* Term Locked Banner if published or completed */}
        {isTermLocked && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/50 rounded-xl border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{t.admin.termIsLockedNotice}</span>
            </div>
            <button
              onClick={() => handleTogglePublish(false)}
              className="px-2.5 py-1 bg-white dark:bg-stone-800 hover:bg-stone-100 text-stone-800 dark:text-stone-200 font-bold rounded-lg border border-stone-300 dark:border-stone-600 text-xs cursor-pointer flex items-center gap-1 shrink-0"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>{t.admin.reopenCollection}</span>
            </button>
          </div>
        )}

        {/* Step buttons */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs sm:text-sm font-semibold scrollbar-thin">
          {[
            { step: 1, label: t.admin.step1 },
            { step: 2, label: t.admin.step2 },
            { step: 3, label: t.admin.step3 },
            { step: 4, label: t.admin.step4 },
            { step: 5, label: t.admin.step5 },
            { step: 6, label: t.admin.step6 },
            { step: 7, label: t.admin.step7 },
          ].map(s => (
            <button
              key={s.step}
              onClick={() => goToStep(s.step)}
              className={`px-3 py-2 rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeStep === s.step
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* STEP 1: Term & Dates */}
      {activeStep === 1 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-4">
            <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.step1}</h3>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">
              {t.admin.step1Desc}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-2xl">
            <div className="sm:col-span-2">
              <label className="block text-xs sm:text-sm font-bold text-stone-800 dark:text-stone-200 mb-1">
                {t.admin.termName}
              </label>
              <input
                type="text"
                value={termName}
                onChange={e => setTermName(e.target.value)}
                placeholder={t.admin.termNamePlaceholder}
                className="w-full px-3.5 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl font-medium text-stone-900 dark:text-stone-100 focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-bold text-stone-800 dark:text-stone-200 mb-1">
                {t.admin.startDate}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl font-medium text-stone-900 dark:text-stone-100 focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-bold text-stone-800 dark:text-stone-200 mb-1">
                {t.admin.endDate}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl font-medium text-stone-900 dark:text-stone-100 focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base"
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between gap-2 border-t border-stone-200 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-xs sm:text-sm font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.app.copyLink}</span>
            </button>

            <button
              onClick={() => goToStep(2)}
              className="px-4 py-2.5 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
            >
              {t.admin.nextShiftTypes}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Shift Types & Point Weighting */}
      {activeStep === 2 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-4 space-y-1">
            <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.shiftTypesTitle}</h3>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">{t.admin.shiftTypesDesc}</p>
            <p className="text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 flex items-start gap-2 mt-2">
              <HelpCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>{t.admin.weightExplanation}</span>
            </p>
          </div>

          <div className="space-y-3">
            {shiftTypes.length === 0 ? (
              <div className="p-6 text-center bg-stone-50 dark:bg-stone-800 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 text-stone-500 dark:text-stone-400">
                <p className="text-sm font-semibold">Inga passtyper tillagda ännu. Lägg till er första passtyp nedan!</p>
              </div>
            ) : (
              shiftTypes.map(st => (
                <div
                  key={st.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800"
                >
                  <div className="flex items-center gap-3">
                    <ShiftBadge shiftType={st} size="lg" />
                    <div>
                      <h4 className="font-bold text-stone-900 dark:text-stone-100 text-sm sm:text-base">{st.name}</h4>
                      <span className="text-xs text-stone-500 dark:text-stone-400">
                        {t.admin.defaultTimeLabel} {st.defaultStartTime} - {st.defaultEndTime}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-white dark:bg-stone-900 px-3 py-1.5 rounded-xl border border-stone-200 dark:border-stone-700">
                      <label className="text-xs font-semibold text-stone-600 dark:text-stone-400">
                        {t.admin.typeWeight}:
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="10"
                        value={typeWeightInputs[st.id] !== undefined ? typeWeightInputs[st.id] : String(st.weight || 1.0)}
                        onChange={e => {
                          const rawVal = e.target.value;
                          setTypeWeightInputs(prev => ({ ...prev, [st.id]: rawVal }));
                          const parsed = parseFloat(rawVal);
                          const weight = isNaN(parsed) ? 1.0 : parsed;
                          setShiftTypes(shiftTypes.map(t => (t.id === st.id ? { ...t, weight } : t)));
                        }}
                        onBlur={() => {
                          const val = parseFloat(typeWeightInputs[st.id]);
                          if (isNaN(val) || val <= 0) {
                            setTypeWeightInputs(prev => ({ ...prev, [st.id]: '1.0' }));
                            setShiftTypes(shiftTypes.map(t => (t.id === st.id ? { ...t, weight: 1.0 } : t)));
                          }
                        }}
                        className="w-16 px-2 py-0.5 border border-stone-300 dark:border-stone-700 rounded-lg text-xs font-bold text-stone-900 dark:text-stone-100 text-center bg-stone-50 dark:bg-stone-800"
                      />
                      <span className="text-xs text-stone-500 dark:text-stone-400 font-medium">
                        {t.admin.points}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDeleteShiftType(st.id)}
                      className="p-2 text-stone-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add new shift type form */}
          <div className="p-4 bg-stone-50 dark:bg-stone-800/60 rounded-xl border border-stone-200 dark:border-stone-800 space-y-3">
            <h4 className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100">{t.admin.addShiftType}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder={t.admin.typeNamePlaceholder}
                value={newTypeName}
                onChange={e => setNewTypeName(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
              />

              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={newTypeStart}
                  onChange={e => setNewTypeStart(e.target.value)}
                  className="w-full px-2 py-2 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs font-medium text-stone-900 dark:text-stone-100"
                />
                <span>-</span>
                <input
                  type="time"
                  value={newTypeEnd}
                  onChange={e => setNewTypeEnd(e.target.value)}
                  className="w-full px-2 py-2 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs font-medium text-stone-900 dark:text-stone-100"
                />
              </div>

              <select
                value={newTypeColor}
                onChange={e => setNewTypeColor(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs font-medium text-stone-900 dark:text-stone-100 cursor-pointer"
              >
                <option value="emerald">{t.admin.colorEmerald}</option>
                <option value="amber">{t.admin.colorAmber}</option>
                <option value="blue">{t.admin.colorBlue}</option>
                <option value="purple">{t.admin.colorPurple}</option>
                <option value="rose">{t.admin.colorRose}</option>
                <option value="indigo">{t.admin.colorIndigo}</option>
              </select>

              <button
                onClick={handleAddShiftType}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t.admin.addShiftType}</span>
              </button>
            </div>
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => goToStep(1)}
              className="px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {t.common.back}
            </button>
            <button
              onClick={() => goToStep(3)}
              className="px-4 py-2.5 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
            >
              {t.common.next}: {t.admin.step3} →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Weekly Recurring Template */}
      {activeStep === 3 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-4 space-y-1">
            <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.weeklyTemplateTitle}</h3>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">{t.admin.weeklyTemplateDesc}</p>
          </div>

          {shiftTypes.length === 0 ? (
            <div className="p-8 text-center bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 space-y-3">
              <p className="font-semibold">Skapa minst en passtyp i Steg 2 först innan du lägger till pass i veckomallen.</p>
              <button
                onClick={() => goToStep(2)}
                className="px-4 py-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-bold rounded-xl cursor-pointer"
              >
                Gå till Steg 2
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map(dayNum => {
                const dayShifts = weeklyTemplate.filter(t => t.dayOfWeek === dayNum);
                const dayName = t.daysFull[dayNum - 1] || t.daysShort[dayNum - 1];

                return (
                  <div
                    key={dayNum}
                    className="bg-stone-50 dark:bg-stone-800 rounded-xl p-3 border border-stone-200 dark:border-stone-700 space-y-2.5 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700 pb-1.5">
                        <span className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
                          {dayName}
                        </span>
                        <span className="text-[10px] text-stone-500 dark:text-stone-400 font-semibold">
                          {dayShifts.length} {lang === 'sv' ? 'pass' : 'shifts'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {dayShifts.map(ts => {
                          const sType = shiftTypes.find(t => t.id === ts.shiftTypeId);
                          return (
                            <div
                              key={ts.id}
                              className="bg-white dark:bg-stone-900 p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 space-y-2 relative group shadow-2xs"
                            >
                              <div className="flex items-center justify-between">
                                <ShiftBadge shiftType={sType} size="sm" />
                                <button
                                  onClick={() => handleRemoveTemplateShift(ts.id)}
                                  className="text-stone-400 hover:text-rose-600 p-0.5 cursor-pointer"
                                  title={t.common.delete}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <select
                                value={ts.shiftTypeId}
                                onChange={e => {
                                  const newId = e.target.value;
                                  const nType = shiftTypes.find(t => t.id === newId);
                                  setWeeklyTemplate(
                                    weeklyTemplate.map(t =>
                                      t.id === ts.id
                                        ? {
                                            ...t,
                                            shiftTypeId: newId,
                                            startTime: nType?.defaultStartTime || t.startTime,
                                            endTime: nType?.defaultEndTime || t.endTime,
                                          }
                                        : t
                                    )
                                  );
                                }}
                                className="w-full text-xs font-semibold p-1 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-900 dark:text-stone-100 cursor-pointer"
                              >
                                {shiftTypes.map(st => (
                                  <option key={st.id} value={st.id}>
                                    {st.name}
                                  </option>
                                ))}
                              </select>

                              {/* Editable Start & End Time Inputs */}
                              <div className="flex items-center gap-1">
                                <input
                                  type="time"
                                  value={ts.startTime}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setWeeklyTemplate(
                                      weeklyTemplate.map(t => (t.id === ts.id ? { ...t, startTime: val } : t))
                                    );
                                  }}
                                  className="w-full px-1.5 py-0.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded font-medium text-stone-800 dark:text-stone-200"
                                  title={t.admin.startTime}
                                />
                                <span className="text-stone-400 text-xs">-</span>
                                <input
                                  type="time"
                                  value={ts.endTime}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setWeeklyTemplate(
                                      weeklyTemplate.map(t => (t.id === ts.id ? { ...t, endTime: val } : t))
                                    );
                                  }}
                                  className="w-full px-1.5 py-0.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded font-medium text-stone-800 dark:text-stone-200"
                                  title={t.admin.endTime}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      onClick={() => handleAddTemplateShift(dayNum)}
                      className="w-full py-1.5 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-750 text-stone-700 dark:text-stone-300 border border-dashed border-stone-300 dark:border-stone-600 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer mt-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t.admin.addShiftToDay}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Prominent Action Button to Generate All Shifts */}
          <div className="p-4 sm:p-6 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-emerald-950 dark:text-emerald-100 text-sm sm:text-base">
                {t.admin.generateSemesterShifts}
              </h4>
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                {t.admin.generateWarning}
              </p>
            </div>

            <button
              onClick={handleGenerateAllShifts}
              disabled={isGeneratingShifts || isTermLocked || shiftTypes.length === 0}
              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {isGeneratingShifts ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{t.admin.generatingShifts}</span>
                </>
              ) : shiftsGeneratedDone ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>{t.common.done}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{t.admin.generateSemesterShifts}</span>
                </>
              )}
            </button>
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => goToStep(2)}
              className="px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {t.common.back}
            </button>
            <button
              onClick={() => goToStep(4)}
              className="px-4 py-2.5 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
            >
              {t.common.next}: {t.admin.step4} →
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Individual Shifts & Full Calendar Grid */}
      {activeStep === 4 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.individualShiftsTitle}</h3>
              <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">
                {t.admin.individualShiftsDesc}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowAddSingleModal(true)}
                disabled={isTermLocked || shiftTypes.length === 0}
                className="px-3.5 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{t.admin.addIndividualShift}</span>
              </button>
            </div>
          </div>

          {/* Month Calendar Component for Admin */}
          <div className="space-y-4">
            {shifts.length === 0 ? (
              <div className="p-8 text-center bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 space-y-3">
                <Calendar className="w-10 h-10 mx-auto text-stone-400" />
                <p className="font-semibold">{t.schedule.emptySemester}</p>
                <button
                  onClick={handleGenerateAllShifts}
                  disabled={isTermLocked || shiftTypes.length === 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {t.admin.generateSemesterShifts}
                </button>
              </div>
            ) : (
              <>
                {/* Month switcher navigation tabs */}
                <div className="flex items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 pb-2 flex-wrap">
                  <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
                    {semesterMonths.map((m, idx) => {
                      const prefix = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
                      const count = shifts.filter(s => s.date.startsWith(prefix)).length;
                      return (
                        <button
                          key={`${m.year}-${m.month}`}
                          type="button"
                          onClick={() => setActiveAdminMonthIdx(idx)}
                          className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                            activeAdminMonthIdx === idx
                              ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
                          }`}
                        >
                          <span>{t.monthsShort[m.month]} {m.year}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                            activeAdminMonthIdx === idx
                              ? 'bg-emerald-500 text-white'
                              : 'bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                          }`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={activeAdminMonthIdx === 0}
                      onClick={() => setActiveAdminMonthIdx(prev => Math.max(0, prev - 1))}
                      className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      title={t.parent.prevMonth}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 px-1">
                      {activeAdminMonthIdx + 1} / {semesterMonths.length}
                    </span>
                    <button
                      type="button"
                      disabled={activeAdminMonthIdx >= semesterMonths.length - 1}
                      onClick={() => setActiveAdminMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
                      className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      title={t.parent.nextMonth}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <CalendarMonth
                  year={semesterMonths[activeAdminMonthIdx]?.year ?? parseLocalDate(startDate).getFullYear()}
                  month={semesterMonths[activeAdminMonthIdx]?.month ?? parseLocalDate(startDate).getMonth()}
                  shifts={shifts}
                  shiftTypes={shiftTypes}
                  families={families}
                  mode={isTermLocked ? "view_schedule" : "admin_edit"}
                  onSelectShift={shift => {
                    if (!isTermLocked) setSelectedShiftForEdit(shift);
                  }}
                  onAddShiftOnDate={dateStr => {
                    if (!isTermLocked && shiftTypes.length > 0) {
                      setNewShiftDate(dateStr);
                      setShowAddSingleModal(true);
                    }
                  }}
                  onDeleteShift={handleDeleteShift}
                  lang={lang}
                  onPrevMonth={() => setActiveAdminMonthIdx(prev => Math.max(0, prev - 1))}
                  onNextMonth={() => setActiveAdminMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
                  hasPrevMonth={activeAdminMonthIdx > 0}
                  hasNextMonth={activeAdminMonthIdx < semesterMonths.length - 1}
                />
              </>
            )}
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => goToStep(3)}
              className="px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {t.common.back}
            </button>
            <button
              onClick={() => goToStep(5)}
              className="px-4 py-2.5 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
            >
              {t.common.next}: {t.admin.step5} →
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Families List */}
      {activeStep === 5 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.familiesTitle}</h3>
              <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">
                {t.admin.familiesDesc}
              </p>
            </div>

            <button
              onClick={() => setShowBulkModal(true)}
              className="px-3 py-1.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>{t.admin.bulkAddFamilies}</span>
            </button>
          </div>

          {/* Add family input - Mobile responsive without overflow */}
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-md">
            <input
              type="text"
              placeholder={t.admin.familyNamePlaceholder}
              value={newFamilyName}
              onChange={e => setNewFamilyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddFamily()}
              className="w-full sm:flex-1 px-3.5 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl font-medium text-stone-900 dark:text-stone-100 text-xs sm:text-sm"
            />
            <button
              onClick={handleAddFamily}
              className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>{t.admin.addFamily}</span>
            </button>
          </div>

          {/* Families list grid - Alphabetically sorted */}
          {families.length === 0 ? (
            <div className="p-8 text-center bg-stone-50 dark:bg-stone-800 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 text-stone-500 dark:text-stone-400">
              <p className="font-semibold">Inga familjer tillagda ännu. Lägg till familjerna ovan!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {families.map(fam => {
                const hasSubmitted = Boolean(wishes[fam.id]);
                return (
                  <div
                    key={fam.id}
                    className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm truncate block">
                        {fam.name}
                      </span>
                      <span className="text-[11px] text-stone-500 dark:text-stone-400 flex items-center gap-1 mt-0.5">
                        {hasSubmitted ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {t.admin.wishSubmittedBadge}
                          </span>
                        ) : (
                          <span>{t.admin.waitingFor}</span>
                        )}
                      </span>
                    </div>

                    <button
                      onClick={() => handleRemoveFamily(fam.id)}
                      className="p-1.5 text-stone-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer shrink-0"
                      title={t.common.delete}
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 5 Footer - If 'setup', primary action is "Spara och dela länk" without duplicate copy button */}
          <div className="pt-6 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-2">
            <button
              onClick={() => goToStep(4)}
              className="px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {t.common.back}
            </button>

            {config.status === 'setup' ? (
              <button
                type="button"
                onClick={handleStartCollectingAndShare}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <Copy className="w-4 h-4" />
                <span>{t.admin.saveAndStartCollecting}</span>
              </button>
            ) : (
              <button
                onClick={() => goToStep(6)}
                className="px-4 py-2.5 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
              >
                {t.common.next}: {t.admin.step6} →
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 6: Compact, Elegant Responses & Solver Results */}
      {activeStep === 6 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-7 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-3">
            <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.responsesTitle}</h3>
            <p className="text-xs text-stone-500 dark:text-stone-400">{t.admin.responsesDesc}</p>
          </div>

          {/* 1. Solver Generation Box (Order of Operations: Placed ABOVE the 4 result boxes) */}
          <div className="p-4 sm:p-6 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm sm:text-base font-bold text-emerald-950 dark:text-emerald-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.admin.strictOptimizerTitle}</span>
                </h4>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 max-w-xl">
                  {t.admin.optimizationAlgorithmInfo}
                </p>
              </div>

              <button
                onClick={handleRunOptimizer}
                disabled={isOptimizing || isTermLocked || families.length === 0}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                {isOptimizing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{t.admin.generating}</span>
                  </>
                ) : optimizerDone ? (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>{t.common.done}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>{t.admin.closeAndGenerate}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Things no schedule can fully solve – shown before generating */}
          {(() => {
            const warnings = findScheduleWarnings(shifts, families, shiftTypes, wishes);
            if (warnings.length === 0) return null;
            return (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl space-y-1.5">
                <h4 className="text-sm font-bold text-amber-950 dark:text-amber-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>{t.admin.warningsTitle}</span>
                </h4>
                <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm text-amber-900 dark:text-amber-200">
                  {warnings.map((w, i) => (
                    <li key={i}>
                      {w.kind === 'familyTooBlocked'
                        ? t.admin.warningTooBlocked
                            .replace('{family}', w.familyName)
                            .replace('{available}', String(w.availablePoints))
                            .replace('{target}', String(w.targetPoints))
                        : t.admin.warningOverlap
                            .replace('{date}', w.date)
                            .replace('{count}', String(w.concurrent))
                            .replace('{families}', String(w.families))}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] sm:text-xs text-amber-800 dark:text-amber-300">{t.admin.warningsHelp}</p>
              </div>
            );
          })()}

          {/* 2. Top Summary Metrics (Beneath the generator) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700">
              <span className="text-xs text-stone-500 dark:text-stone-400 block">{t.admin.submittedCount}</span>
              <span className="text-lg sm:text-xl font-bold text-stone-900 dark:text-stone-100">
                {answeredFamiliesCount} / {families.length}
              </span>
            </div>

            <div className="p-3.5 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700">
              <span className="text-xs text-stone-500 dark:text-stone-400 block">{t.admin.targetPointsPerFamily}</span>
              <span className="text-lg sm:text-xl font-bold text-stone-900 dark:text-stone-100">
                {calculateSemesterTargetPoints(shifts, shiftTypes, families).toFixed(1)} {t.admin.points}
              </span>
            </div>

            {/* Fairness Index: Larger display utilizing the full box */}
            <div className="p-3.5 sm:p-4 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/80 flex flex-col justify-between">
              <span className="text-xs text-emerald-900 dark:text-emerald-200 font-bold block mb-1">
                {t.admin.fairnessScore}
              </span>
              <div className="flex items-baseline justify-between gap-1.5 mt-auto">
                <span className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                  {metrics ? `${metrics.fairnessScore}%` : '-'}
                </span>
                {metrics && (
                  <span className="text-[11px] sm:text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    {t.admin.averageSatisfaction}: {metrics.averageSatisfaction}%
                  </span>
                )}
              </div>
            </div>

            <div className="p-3.5 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700">
              <span className="text-xs text-stone-500 dark:text-stone-400 block">{t.admin.blockedViolations}</span>
              <span className={`text-sm sm:text-base font-bold ${
                !metrics || metrics.blockedConflictsCount === 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}>
                {!metrics ? t.admin.respected : metrics.blockedConflictsCount === 0 ? t.admin.noBlockedViolations : `${metrics.blockedConflictsCount} st`}
              </span>
            </div>
          </div>

          {/* ELEGANT RESULTS DASHBOARD */}
          {metrics && (
            <div className="space-y-4 pt-2 border-t border-stone-200 dark:border-stone-800">
              <div className="flex items-center justify-between">
                <h4 className="text-sm sm:text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.admin.resultsOverview}</span>
                </h4>
                <span className="text-xs text-stone-500 font-semibold">
                  {t.admin.avgShort} <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{metrics.averageSatisfaction}%</strong> • {t.admin.worstShort} <strong className="text-stone-800 dark:text-stone-200 font-bold">{metrics.worstSatisfaction}%</strong>
                </span>
              </div>

              {/* Detailed Family Breakdown Table */}
              <div className="w-full overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800 shadow-2xs">
                <table className="w-full text-left text-xs sm:text-sm divide-y divide-stone-200 dark:divide-stone-800 bg-white dark:bg-stone-900">
                  <thead className="bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 font-bold text-xs">
                    <tr>
                      <th className="px-3.5 py-2.5">{t.admin.familyCol}</th>
                      <th className="px-3.5 py-2.5">{t.admin.pointsCol}</th>
                      <th className="px-3.5 py-2.5">{t.admin.shiftsCol}</th>
                      <th className="px-3.5 py-2.5">{t.admin.breakdownCol}</th>
                      <th className="px-3.5 py-2.5">{t.admin.satisfactionCol}</th>
                      <th className="px-3.5 py-2.5">{t.admin.blockedCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                    {families.map(fam => {
                      const evalData = metrics.familyEvaluations?.[fam.id];
                      const famShifts = shifts.filter(s => s.assignedFamilyId === fam.id);
                      const totalPts = evalData?.totalPoints ?? famShifts.reduce((sum, s) => {
                        const st = shiftTypes.find(t => t.id === s.shiftTypeId);
                        return sum + (st?.weight || 1.0);
                      }, 0);
                      const shiftCount = evalData?.totalShifts ?? famShifts.length;

                      const isOpen = expandedFamilyId === fam.id;
                      return (
                        <React.Fragment key={fam.id}>
                        <tr className="hover:bg-stone-50/50 dark:hover:bg-stone-800/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-bold text-stone-900 dark:text-stone-100 whitespace-nowrap">
                            {fam.name}
                          </td>
                          <td className="px-3.5 py-2.5 font-extrabold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                            {totalPts.toFixed(1)} {t.admin.points}
                          </td>
                          <td className="px-3.5 py-2.5 text-stone-700 dark:text-stone-300 whitespace-nowrap">
                            {shiftCount} {t.admin.shiftsUnit}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {shiftTypes.map(st => {
                                const count = evalData?.shiftsByType?.[st.id] ?? famShifts.filter(s => s.shiftTypeId === st.id).length;
                                if (!count || count === 0) return null;
                                return (
                                  <span
                                    key={st.id}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-700"
                                  >
                                    <span>{st.name}:</span>
                                    <span className="font-bold">{count}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setExpandedFamilyId(isOpen ? null : fam.id)}
                              aria-expanded={isOpen}
                              title={t.admin.showWishVsResult}
                              className="inline-flex items-center gap-1 cursor-pointer group"
                            >
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                                {evalData?.satisfactionScore ?? 100}%
                              </span>
                              <ChevronRight className={`w-3.5 h-3.5 text-stone-400 group-hover:text-stone-700 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                            </button>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            {(() => {
                              // How many days/shifts the family blocked, how many were respected, and how
                              // big a share of the term's shift days they blocked
                              const wish = wishes[fam.id];
                              const shiftDays = new Set(shifts.filter(s => !s.isCancelled).map(s => s.date));
                              const bDates = (wish?.blockedDates || []).filter(d => shiftDays.has(d));
                              const bIds = (wish?.blockedShiftIds || []).filter(id => shifts.some(s => s.id === id && !bDates.includes(s.date)));
                              const total = bDates.length + bIds.length;
                              if (total === 0) return <span className="text-stone-500 dark:text-stone-400">{t.admin.noBlocks}</span>;
                              const hitDates = new Set(famShifts.filter(s => bDates.includes(s.date)).map(s => s.date));
                              const hitIds = famShifts.filter(s => bIds.includes(s.id)).length;
                              const hits = hitDates.size + hitIds;
                              const pct = shiftDays.size ? Math.round((100 * bDates.length) / shiftDays.size) : 0;
                              return (
                                <div className="leading-tight">
                                  {hits === 0 ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                      {t.admin.blockedRespectedOf.replace('{ok}', String(total)).replace('{total}', String(total))}
                                    </span>
                                  ) : (
                                    <span className="text-rose-600 dark:text-rose-400 font-bold">
                                      {t.admin.blockedConflictsOf.replace('{n}', String(hits)).replace('{total}', String(total))}
                                    </span>
                                  )}
                                  <span
                                    className={`block text-[11px] mt-0.5 ${
                                      pct >= 30 ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-stone-500 dark:text-stone-400'
                                    }`}
                                  >
                                    {t.admin.blockedShareOfDays.replace('{pct}', String(pct))}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-stone-50/60 dark:bg-stone-800/40">
                            <td colSpan={6} className="px-3 py-3">
                              <WishResultSummary
                                wish={wishes[fam.id]}
                                assignedShifts={famShifts}
                                shiftTypes={shiftTypes}
                                naturalRatios={calculateDefaultShiftRatios(shifts, shiftTypes)}
                                lang={lang}
                              />
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pt-3 flex justify-between">
            <button
              onClick={() => goToStep(5)}
              className="px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {t.common.back}
            </button>
            <button
              onClick={() => goToStep(7)}
              className="px-4 py-2.5 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
            >
              {t.common.next}: {t.admin.step7} →
            </button>
          </div>
        </div>
      )}

      {/* STEP 7: Final Schedule & Publication & Complete State */}
      {activeStep === 7 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-stone-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">{t.admin.step7}</h3>
              <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400">
                {t.admin.step7Desc}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {config.status === 'completed' ? (
                <button
                  onClick={() => handleToggleComplete(false)}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 border border-stone-300 dark:border-stone-600 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>{t.admin.reopenTerm}</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleTogglePublish(config.status !== 'published')}
                    className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-colors cursor-pointer ${
                      config.status === 'published'
                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 hover:bg-amber-200'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                    }`}
                  >
                    {config.status === 'published' ? t.admin.reopenCollection : t.admin.publishSchedule}
                  </button>

                  {config.status === 'published' && (
                    <button
                      onClick={() => handleToggleComplete(true)}
                      className="px-3.5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700 transition-colors cursor-pointer flex items-center gap-1.5"
                      title={t.admin.completeTerm}
                    >
                      <Archive className="w-4 h-4 text-stone-500" />
                      <span>{t.admin.completeTerm}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Month switcher navigation tabs for inspection */}
          <div className="flex items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 pb-2 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
              {semesterMonths.map((m, idx) => {
                const prefix = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
                const count = shifts.filter(s => s.date.startsWith(prefix)).length;
                return (
                  <button
                    key={`step7-${m.year}-${m.month}`}
                    type="button"
                    onClick={() => setActiveAdminMonthIdx(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                      activeAdminMonthIdx === idx
                        ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
                    }`}
                  >
                    <span>{t.monthsShort[m.month]} {m.year}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      activeAdminMonthIdx === idx
                        ? 'bg-emerald-500 text-white'
                        : 'bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={activeAdminMonthIdx === 0}
                onClick={() => setActiveAdminMonthIdx(prev => Math.max(0, prev - 1))}
                className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title={t.parent.prevMonth}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 px-1">
                {activeAdminMonthIdx + 1} / {semesterMonths.length}
              </span>
              <button
                type="button"
                disabled={activeAdminMonthIdx >= semesterMonths.length - 1}
                onClick={() => setActiveAdminMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
                className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title={t.parent.nextMonth}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Full Schedule Month Grid for Inspection */}
          <CalendarMonth
            year={semesterMonths[activeAdminMonthIdx]?.year ?? parseLocalDate(startDate).getFullYear()}
            month={semesterMonths[activeAdminMonthIdx]?.month ?? parseLocalDate(startDate).getMonth()}
            shifts={shifts}
            shiftTypes={shiftTypes}
            families={families}
            mode="view_schedule"
            filterFamilyId={null}
            lang={lang}
            onPrevMonth={() => setActiveAdminMonthIdx(prev => Math.max(0, prev - 1))}
            onNextMonth={() => setActiveAdminMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
            hasPrevMonth={activeAdminMonthIdx > 0}
            hasNextMonth={activeAdminMonthIdx < semesterMonths.length - 1}
          />

          <div className="pt-4 flex justify-between border-t border-stone-200 dark:border-stone-800">
            <button
              onClick={() => goToStep(6)}
              className="px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {t.common.back}
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Change Global Admin PIN */}
      {showChangePinModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                {t.admin.changePin}
              </h3>
              <button
                onClick={() => {
                  setShowChangePinModal(false);
                  if (onCloseChangePinModal) onCloseChangePinModal();
                }}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleChangePinSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">
                  {t.admin.newPinLabel}
                </label>
                <input
                  type="text"
                  maxLength={8}
                  required
                  value={newPinValue}
                  onChange={e => setNewPinValue(e.target.value)}
                  placeholder="t.ex. 5678"
                  className="w-full text-center tracking-widest text-lg font-bold p-3 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl font-mono text-stone-900 dark:text-stone-100"
                  autoFocus
                />
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
                  {t.admin.adminPinHelp}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePinModal(false);
                    if (onCloseChangePinModal) onCloseChangePinModal();
                  }}
                  className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl cursor-pointer"
                >
                  {t.admin.savePin}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Delete Term Confirmation */}
      {showDeleteTermModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                {t.admin.deleteTermConfirmTitle}
              </h3>
            </div>

            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400">
              {t.admin.deleteTermConfirmDesc}
            </p>

            <div className="p-3 bg-stone-50 dark:bg-stone-800 rounded-xl text-xs font-bold text-stone-800 dark:text-stone-200">
              Termin: {config.termName} ({config.startDate} - {config.endDate})
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteTermModal(false)}
                className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleDeleteCurrentTerm}
                disabled={isDeletingTerm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeletingTerm ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>{t.admin.deleteTerm}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Share Link to Parents */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                {t.admin.shareLinkModalTitle}
              </h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-stone-600 dark:text-stone-400">
              {t.admin.shareLinkModalDesc}
            </p>

            {/* Copyable link box */}
            <div className="p-3 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl space-y-2">
              <span className="text-[11px] font-mono text-stone-600 dark:text-stone-300 break-all select-all block">
                {getParentShareUrl()}
              </span>

              <button
                type="button"
                onClick={handleCopyShareLink}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {shareLinkCopied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{t.admin.shareLinkCopied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>{t.app.copyLink}</span>
                  </>
                )}
              </button>
            </div>

            <div className="pt-2 flex justify-between gap-2">
              {onSwitchToParentView && (
                <button
                  type="button"
                  onClick={() => {
                    setShowShareModal(false);
                    onSwitchToParentView();
                  }}
                  className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs font-semibold cursor-pointer"
                >
                  {t.admin.goToParentView}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-bold rounded-xl cursor-pointer ml-auto"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create New Term */}
      {showNewTermModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{t.admin.createTermModalTitle}</h3>
              <button
                onClick={closeNewTermModal}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewTermSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">
                  {t.admin.newTermNameLabel}
                </label>
                <input
                  type="text"
                  required
                  value={newTermNameInput}
                  onChange={e => setNewTermNameInput(e.target.value)}
                  placeholder="t.ex. Vårterminen 2027"
                  className="w-full p-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.startDate}</label>
                  <input
                    type="date"
                    required
                    value={newTermStartInput}
                    onChange={e => setNewTermStartInput(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.endDate}</label>
                  <input
                    type="date"
                    required
                    value={newTermEndInput}
                    onChange={e => setNewTermEndInput(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  />
                </div>
              </div>

              {/* Source term selection - Only if previous terms exist */}
              {termsList.length > 0 ? (
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">
                    {t.admin.copyOptionsLabel}
                  </label>
                  <select
                    value={selectedCopyTermId}
                    onChange={e => setSelectedCopyTermId(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs font-medium text-stone-900 dark:text-stone-100 cursor-pointer"
                  >
                    <option value={config.id}>{config.termName} (Nuvarande)</option>
                    {termsList.filter(tm => tm.id !== config.id).map(tm => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                    <option value="none">{t.admin.dontCopy}</option>
                  </select>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
                    {t.admin.copyOptionsHelp}
                  </p>
                </div>
              ) : (
                <div className="p-2.5 bg-stone-50 dark:bg-stone-800 rounded-xl text-xs text-stone-500 dark:text-stone-400">
                  {t.admin.noPreviousTermsToCopy}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={closeNewTermModal}
                  className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl cursor-pointer"
                >
                  {t.admin.createTermSubmit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Bulk Add Families */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{t.admin.bulkAddFamilies}</h3>
              <button
                onClick={() => setShowBulkModal(false)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {t.admin.bulkAddHelp}
            </p>
            <textarea
              rows={8}
              value={bulkFamiliesText}
              onChange={e => setBulkFamiliesText(e.target.value)}
              placeholder={t.admin.bulkAddPlaceholder}
              className="w-full p-3 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleBulkAddFamilies}
                className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl cursor-pointer"
              >
                {t.admin.bulkAddSubmit}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Full Shift Edit / Delete / Reassign */}
      {selectedShiftForEdit && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{t.admin.reassignModalTitle}</h3>
              <button
                onClick={() => setSelectedShiftForEdit(null)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.shiftDate}</label>
                <input
                  type="date"
                  value={selectedShiftForEdit.date}
                  onChange={e => setSelectedShiftForEdit({ ...selectedShiftForEdit, date: e.target.value })}
                  className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.shiftType}</label>
                <select
                  value={selectedShiftForEdit.shiftTypeId}
                  onChange={e => {
                    const st = shiftTypes.find(t => t.id === e.target.value);
                    setSelectedShiftForEdit({
                      ...selectedShiftForEdit,
                      shiftTypeId: e.target.value,
                      name: st?.name || selectedShiftForEdit.name,
                    });
                  }}
                  className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100 cursor-pointer"
                >
                  {shiftTypes.map(st => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.startTime}</label>
                  <input
                    type="time"
                    value={selectedShiftForEdit.startTime}
                    onChange={e => setSelectedShiftForEdit({ ...selectedShiftForEdit, startTime: e.target.value })}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.endTime}</label>
                  <input
                    type="time"
                    value={selectedShiftForEdit.endTime}
                    onChange={e => setSelectedShiftForEdit({ ...selectedShiftForEdit, endTime: e.target.value })}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">
                  {t.admin.selectFamilyForShift}
                </label>
                <select
                  value={selectedShiftForEdit.assignedFamilyId || ''}
                  onChange={e => setSelectedShiftForEdit({ ...selectedShiftForEdit, assignedFamilyId: e.target.value || null })}
                  className="w-full p-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl font-medium text-stone-900 dark:text-stone-100 text-xs sm:text-sm cursor-pointer"
                >
                  <option value="">{t.admin.unassignedOption}</option>
                  {families.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleDeleteShift(selectedShiftForEdit.id)}
                  className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-900 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900 cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.admin.deleteShift}</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-stone-200 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setSelectedShiftForEdit(null)}
                className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => handleUpdateShiftDetails(selectedShiftForEdit)}
                className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Single Shift */}
      {showAddSingleModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{t.admin.addSingleModalTitle}</h3>
              <button
                onClick={() => setShowAddSingleModal(false)}
                className="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.shiftDate}</label>
                <input
                  type="date"
                  value={newShiftDate}
                  onChange={e => setNewShiftDate(e.target.value)}
                  className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.shiftType}</label>
                <select
                  value={newShiftTypeId}
                  onChange={e => {
                    const stId = e.target.value;
                    setNewShiftTypeId(stId);
                    const st = shiftTypes.find(t => t.id === stId);
                    if (st) {
                      setNewShiftStart(st.defaultStartTime);
                      setNewShiftEnd(st.defaultEndTime);
                    }
                  }}
                  className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100 cursor-pointer"
                >
                  {shiftTypes.map(st => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.startTime}</label>
                  <input
                    type="time"
                    value={newShiftStart}
                    onChange={e => setNewShiftStart(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1">{t.admin.endTime}</label>
                  <input
                    type="time"
                    value={newShiftEnd}
                    onChange={e => setNewShiftEnd(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl text-xs sm:text-sm font-medium text-stone-900 dark:text-stone-100"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-stone-200 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setShowAddSingleModal(false)}
                className="px-3.5 py-2 border border-stone-300 dark:border-stone-700 rounded-xl text-stone-700 dark:text-stone-300 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleAddIndividualShift}
                className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl cursor-pointer"
              >
                {t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
