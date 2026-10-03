import React, { useEffect, useState } from 'react';
import {
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
} from 'lucide-react';
import { generateIcsCalendar } from '../calendarExport';
import { calculateDefaultShiftRatios, parseLocalDate } from '../scheduler';
import { Language, translations } from '../translations';
import { CoopConfig, FamilyWish, Shift, SpacingPreference, TypePreferenceLevel } from '../types';
import { defaultLevels, levelsToRatios, ratiosToLevels } from '../typePreference';
import { CalendarMonth } from './CalendarMonth';
import { ShiftTypePreference } from './ShiftTypePreference';
import { WishResultSummary } from './WishResultSummary';
import { ShiftBadge } from './ShiftBadge';
import { ExportMenu } from './ExportMenu';

interface ParentViewProps {
  config: CoopConfig;
  wishes: Record<string, FamilyWish>;
  onSaveWish: (wish: FamilyWish) => Promise<void>;
  lang: Language;
}

export const ParentView: React.FC<ParentViewProps> = ({
  config,
  wishes,
  onSaveWish,
  lang,
}) => {
  const t = translations[lang];

  // Selected family
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const hash = window.location.hash;
    const hashQuery = hash.includes('?') ? hash.substring(hash.indexOf('?')) : '';
    const hashParams = new URLSearchParams(hashQuery);
    const searchParams = new URLSearchParams(window.location.search);
    return hashParams.get('family') || searchParams.get('family') || '';
  });

  // Sync selected family if hash URL changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const hashQuery = hash.includes('?') ? hash.substring(hash.indexOf('?')) : '';
      const hashParams = new URLSearchParams(hashQuery);
      const fam = hashParams.get('family');
      if (fam) setSelectedFamilyId(fam);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // State for 3 choices
  const [spacingPref, setSpacingPref] = useState<SpacingPreference>('neutral');
  const [typeLevels, setTypeLevels] = useState<Record<string, TypePreferenceLevel>>({});
  const [typeFlexible, setTypeFlexible] = useState<boolean>(false);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [blockedShiftIds, setBlockedShiftIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');

  // UI state
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [activeMonthIdx, setActiveMonthIdx] = useState<number>(0);
  const [parentSubView, setParentSubView] = useState<'my_shifts' | 'all_shifts'>('my_shifts');

  const defaultRatios = calculateDefaultShiftRatios(config.shifts, config.shiftTypes);
  // A finished (completed) term still shows the schedule, never the wish form again
  const isPublished = config.status === 'published' || config.status === 'completed';
  const isCollecting = config.status === 'collecting';
  const [saveFailed, setSaveFailed] = useState(false);

  // Load existing wishes when selected family changes
  useEffect(() => {
    if (selectedFamilyId && wishes[selectedFamilyId]) {
      const w = wishes[selectedFamilyId];
      setSpacingPref(w.spacingPreference || 'neutral');
      setTypeLevels(w.typeLevels ?? ratiosToLevels(config.shiftTypes, w.typeRatios || defaultRatios, defaultRatios));
      setTypeFlexible(Boolean(w.typeFlexible));
      setBlockedDates(w.blockedDates || []);
      setBlockedShiftIds(w.blockedShiftIds || []);
      setNotes(w.notes || '');
    } else {
      setSpacingPref('neutral');
      setTypeLevels(defaultLevels(config.shiftTypes));
      setTypeFlexible(false);
      setBlockedDates([]);
      setBlockedShiftIds([]);
      setNotes('');
    }
  }, [selectedFamilyId, wishes]);

  // Compute months spanning the semester
  const startD = parseLocalDate(config.startDate || '2026-08-17');
  const endD = parseLocalDate(config.endDate || '2026-12-18');

  const semesterMonths: { year: number; month: number }[] = [];
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1, 12, 0, 0);
  const endLimit = new Date(endD.getFullYear(), endD.getMonth(), 1, 12, 0, 0);

  while (cur <= endLimit) {
    semesterMonths.push({ year: cur.getFullYear(), month: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }

  // Assigned shifts for selected family
  const assignedShifts: Shift[] = config.shifts.filter(
    s => s.assignedFamilyId === selectedFamilyId
  );

  const handleToggleBlockDate = (dateStr: string) => {
    setBlockedDates(prev => {
      const isBlocked = prev.includes(dateStr);
      if (isBlocked) {
        return prev.filter(d => d !== dateStr);
      } else {
        const shiftsOnDate = config.shifts.filter(s => s.date === dateStr).map(s => s.id);
        setBlockedShiftIds(sPrev => sPrev.filter(id => !shiftsOnDate.includes(id)));
        return [...prev, dateStr];
      }
    });
  };

  const handleToggleBlockShift = (shiftId: string) => {
    setBlockedShiftIds(prev =>
      prev.includes(shiftId) ? prev.filter(id => id !== shiftId) : [...prev, shiftId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId) return;

    setIsSaving(true);
    const wish: FamilyWish = {
      familyId: selectedFamilyId,
      spacingPreference: spacingPref,
      // With only one shift type there is nothing to choose
      // "Spelar ingen roll" aims (softly) for the usual mix
      typeRatios: typeFlexible ? { ...defaultRatios } : levelsToRatios(config.shiftTypes, { ...defaultLevels(config.shiftTypes), ...typeLevels }, defaultRatios),
      typeLevels: { ...defaultLevels(config.shiftTypes), ...typeLevels },
      typeFlexible: config.shiftTypes.length > 1 ? typeFlexible : false,
      blockedDates,
      blockedShiftIds,
      notes,
      submittedAt: new Date().toISOString(),
    };

    setSaveFailed(false);
    try {
      await onSaveWish(wish);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 5000);
    } catch (err) {
      console.error('Failed to save parent wish:', err);
      setSaveFailed(true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadCalendar = () => {
    const selectedFam = config.families.find(f => f.id === selectedFamilyId);
    const famShifts = config.shifts.filter(s => s.assignedFamilyId === selectedFamilyId);
    const icsContent = generateIcsCalendar(
      famShifts,
      config.shiftTypes,
      config.termName,
      selectedFam?.name
    );
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schema-${selectedFam?.name || 'kooperativet'}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const selectedFamily = config.families.find(f => f.id === selectedFamilyId);
  const hasPreviouslySubmitted = Boolean(selectedFamilyId && wishes[selectedFamilyId]);

  // Count blocked items for a specific month
  const getBlockedCountForMonth = (year: number, month: number) => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const blockedDaysInMonth = blockedDates.filter(d => d.startsWith(prefix)).length;
    const blockedShiftsInMonth = config.shifts.filter(
      s => s.date.startsWith(prefix) && blockedShiftIds.includes(s.id) && !blockedDates.includes(s.date)
    ).length;
    return blockedDaysInMonth + blockedShiftsInMonth;
  };

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8 w-full max-w-full">
      {/* Published announcement banner */}
      {isPublished && (
        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-emerald-950 dark:text-emerald-100">
                {t.parent.scheduleIsPublishedNotice}
              </h2>
              <p className="text-xs sm:text-sm text-emerald-800 dark:text-emerald-300">
                {t.parent.publishedHelperText}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <ExportMenu
              config={config}
              shifts={config.shifts}
              shiftTypes={config.shiftTypes}
              families={config.families}
              lang={lang}
              selectedFamilyId={selectedFamilyId || null}
              variant="emerald"
              align="right"
              showCalendarIcs={true}
            />
          </div>
        </div>
      )}

      {/* Main family selection card */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-7 shadow-xs">
        <div className="max-w-xl">
          <label
            htmlFor="family-select"
            className="block text-sm sm:text-base font-bold text-stone-900 dark:text-stone-100 mb-2"
          >
            {t.parent.selectFamilyLabel}
          </label>
          <div className="relative">
            <select
              id="family-select"
              value={selectedFamilyId}
              onChange={e => setSelectedFamilyId(e.target.value)}
              className="w-full text-sm sm:text-base font-medium px-3.5 py-3 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-stone-900 dark:text-stone-100 transition-all cursor-pointer"
            >
              <option value="">{t.parent.selectFamilyPlaceholder}</option>
              {[...config.families]
                .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
                .map(fam => {
                  const hasWish = Boolean(wishes[fam.id]);
                  return (
                    <option key={fam.id} value={fam.id}>
                      {fam.name} {hasWish ? `(${t.admin.wishSubmittedBadge})` : ''}
                    </option>
                  );
                })}
            </select>
          </div>

          {hasPreviouslySubmitted && !isPublished && (
            <p className="mt-3 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{t.parent.alreadySubmittedNotice}</span>
            </p>
          )}
        </div>
      </div>

      {/* When family is selected and schedule IS published */}
      {selectedFamilyId && isPublished && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 border-b border-stone-200 dark:border-stone-800 pb-3 flex-wrap">
            <button
              onClick={() => setParentSubView('my_shifts')}
              className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                parentSubView === 'my_shifts'
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              {t.parent.viewMyShifts} ({assignedShifts.length})
            </button>
            <button
              onClick={() => setParentSubView('all_shifts')}
              className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                parentSubView === 'all_shifts'
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              {t.parent.allShifts}
            </button>
          </div>

          {parentSubView === 'my_shifts' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">
                  {selectedFamily?.name}: {assignedShifts.length} {t.parent.totalAssigned}
                </h3>
                <button
                  onClick={handleDownloadCalendar}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.schedule.downloadIcs}</span>
                </button>
              </div>

              <WishResultSummary
                wish={wishes[selectedFamilyId]}
                assignedShifts={assignedShifts}
                shiftTypes={config.shiftTypes}
                naturalRatios={defaultRatios}
                lang={lang}
              />

              {assignedShifts.length === 0 ? (
                <div className="bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 rounded-xl p-8 text-center text-stone-500 dark:text-stone-400">
                  {t.parent.noShiftsAssignedYet}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {assignedShifts.map(s => {
                    const sType = config.shiftTypes.find(t => t.id === s.shiftTypeId);
                    const dateObj = parseLocalDate(s.date);
                    const weekday = t.weekdays[dateObj.getDay()];

                    return (
                      <div
                        key={s.id}
                        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <ShiftBadge shiftType={sType} />
                          <span className="text-xs font-bold text-stone-500 dark:text-stone-400">
                            {weekday}
                          </span>
                        </div>
                        <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100">
                          {s.date}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm text-stone-600 dark:text-stone-400 mt-1">
                          <Clock className="w-3.5 h-3.5 text-stone-400" />
                          <span>{s.startTime} - {s.endTime}</span>
                        </div>
                        {sType?.description && (
                          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 bg-stone-50 dark:bg-stone-800 p-2 rounded-lg border border-stone-100 dark:border-stone-700">
                            {sType.description}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                {semesterMonths.map((m, idx) => (
                  <button
                    key={`${m.year}-${m.month}`}
                    onClick={() => setActiveMonthIdx(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors shrink-0 cursor-pointer ${
                      activeMonthIdx === idx
                        ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
                    }`}
                  >
                    {t.monthsShort[m.month]} {m.year}
                  </button>
                ))}
              </div>

              {semesterMonths[activeMonthIdx] && (
                <CalendarMonth
                  year={semesterMonths[activeMonthIdx].year}
                  month={semesterMonths[activeMonthIdx].month}
                  shifts={config.shifts}
                  shiftTypes={config.shiftTypes}
                  families={config.families}
                  mode="view_schedule"
                  filterFamilyId={null}
                  lang={lang}
                  onPrevMonth={() => setActiveMonthIdx(prev => Math.max(0, prev - 1))}
                  onNextMonth={() => setActiveMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
                  hasPrevMonth={activeMonthIdx > 0}
                  hasNextMonth={activeMonthIdx < semesterMonths.length - 1}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* When family is selected and schedule is in wishes collection mode: 3-Choice Form */}
      {selectedFamilyId && !isPublished && !isCollecting && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-5 sm:p-6 text-center space-y-1">
          <h2 className="text-base sm:text-lg font-bold text-amber-950 dark:text-amber-100">{t.parent.notOpenYetTitle}</h2>
          <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300">{t.parent.notOpenYetDesc}</p>
        </div>
      )}

      {selectedFamilyId && isCollecting && (
        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
          {/* Choice 1: Spacing Preference */}
          <section className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-7 shadow-xs space-y-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-bold flex items-center justify-center shrink-0">
                  1
                </span>
                <span>{t.parent.step1Title}</span>
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 mt-1">
                {t.parent.step1Desc}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setSpacingPref('spread')}
                className={`text-left p-4 rounded-xl border-2 transition-all flex flex-col justify-between cursor-pointer ${
                  spacingPref === 'spread'
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 bg-white dark:bg-stone-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm sm:text-base font-bold text-stone-900 dark:text-stone-100">
                      {t.parent.spreadOption}
                    </span>
                    {spacingPref === 'spread' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-stone-600 dark:text-stone-400">
                    {t.parent.spreadOptionDesc}
                  </p>
                </div>
                <div className="mt-4 flex gap-1.5 items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="w-6 border-b-2 border-stone-300 dark:border-stone-700" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="w-6 border-b-2 border-stone-300 dark:border-stone-700" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSpacingPref('grouped')}
                className={`text-left p-4 rounded-xl border-2 transition-all flex flex-col justify-between cursor-pointer ${
                  spacingPref === 'grouped'
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 bg-white dark:bg-stone-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm sm:text-base font-bold text-stone-900 dark:text-stone-100">
                      {t.parent.groupedOption}
                    </span>
                    {spacingPref === 'grouped' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-stone-600 dark:text-stone-400">
                    {t.parent.groupedOptionDesc}
                  </p>
                </div>
                <div className="mt-4 flex gap-1 items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSpacingPref('neutral')}
                className={`text-left p-4 rounded-xl border-2 transition-all flex flex-col justify-between cursor-pointer ${
                  spacingPref === 'neutral'
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 bg-white dark:bg-stone-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm sm:text-base font-bold text-stone-900 dark:text-stone-100">
                      {t.parent.neutralOption}
                    </span>
                    {spacingPref === 'neutral' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-stone-600 dark:text-stone-400">
                    {t.parent.neutralOptionDesc}
                  </p>
                </div>
                <div className="mt-4 text-xs text-stone-400 dark:text-stone-500 italic">
                  {t.parent.flexibleBadge}
                </div>
              </button>
            </div>
          </section>

          {/* Choice 2: Shift Type Ratio with Segmented Multi-Slider */}
          <section className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-7 shadow-xs space-y-4 sm:space-y-5">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-bold flex items-center justify-center shrink-0">
                  2
                </span>
                <span>{t.parent.step2Title}</span>
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 mt-1">
                {t.parent.step2Desc}
              </p>
            </div>

            <ShiftTypePreference
              shiftTypes={config.shiftTypes}
              naturalRatios={defaultRatios}
              levels={typeLevels}
              flexible={typeFlexible}
              onChange={(levels, flexible) => {
                setTypeLevels(levels);
                setTypeFlexible(flexible);
              }}
              lang={lang}
            />
          </section>

          {/* Choice 3: Blocked Dates / Shifts with prominent month navigation */}
          <section className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-7 shadow-xs space-y-4 sm:space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                  <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 text-xs sm:text-sm font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span>{t.parent.step3Title}</span>
                </h3>
                <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 mt-1">
                  {t.parent.step3Desc}
                </p>
              </div>

              {/* Total live counter badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200 text-xs font-semibold shrink-0">
                <Ban className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>
                  {blockedDates.length} {t.parent.blockedDaysSummary}
                </span>
              </div>
            </div>

            {/* Multi-Month Helper Callout */}
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{t.parent.calendarHelp}</span>
            </div>

            {/* Month Tabs & Indicator */}
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 pb-2 flex-wrap">
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
                {semesterMonths.map((m, idx) => {
                  const count = getBlockedCountForMonth(m.year, m.month);
                  return (
                    <button
                      key={`${m.year}-${m.month}`}
                      type="button"
                      onClick={() => setActiveMonthIdx(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                        activeMonthIdx === idx
                          ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                          : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
                      }`}
                    >
                      <span>{t.monthsShort[m.month]} {m.year}</span>
                      {count > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          activeMonthIdx === idx
                            ? 'bg-rose-500 text-white'
                            : 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Next / Previous month quick step buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={activeMonthIdx === 0}
                  onClick={() => setActiveMonthIdx(prev => Math.max(0, prev - 1))}
                  className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  title={t.parent.prevMonth}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-semibold text-stone-500 dark:text-stone-400 px-1">
                  {activeMonthIdx + 1} / {semesterMonths.length}
                </span>
                <button
                  type="button"
                  disabled={activeMonthIdx >= semesterMonths.length - 1}
                  onClick={() => setActiveMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
                  className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  title={t.parent.nextMonth}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {semesterMonths[activeMonthIdx] && (
              <CalendarMonth
                year={semesterMonths[activeMonthIdx].year}
                month={semesterMonths[activeMonthIdx].month}
                shifts={config.shifts}
                shiftTypes={config.shiftTypes}
                mode="parent_wish"
                blockedDates={blockedDates}
                blockedShiftIds={blockedShiftIds}
                onToggleBlockDate={handleToggleBlockDate}
                onToggleBlockShift={handleToggleBlockShift}
                lang={lang}
                onPrevMonth={() => setActiveMonthIdx(prev => Math.max(0, prev - 1))}
                onNextMonth={() => setActiveMonthIdx(prev => Math.min(semesterMonths.length - 1, prev + 1))}
                hasPrevMonth={activeMonthIdx > 0}
                hasNextMonth={activeMonthIdx < semesterMonths.length - 1}
              />
            )}
          </section>

          {/* Submission and Confirmation */}
          <div className="bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 text-center sm:text-left">
              {saveFailed ? (
                <span className="text-rose-700 dark:text-rose-400 font-bold">{t.parent.saveFailed}</span>
              ) : savedSuccess ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1.5 justify-center sm:justify-start">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  {t.parent.submissionSuccess}
                </span>
              ) : (
                <span>{t.parent.submissionSuccessDetail}</span>
              )}
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm sm:text-base shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {isSaving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{t.parent.submitting}</span>
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  <span>{t.parent.submitWishes}</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
