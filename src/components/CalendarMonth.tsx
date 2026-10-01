import React, { useState } from 'react';
import {
  Ban,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  List,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { parseLocalDate } from '../scheduler';
import { themeTokens } from '../theme';
import { Language, translations } from '../translations';
import { Family, Shift, ShiftType } from '../types';
import { ShiftBadge } from './ShiftBadge';

interface CalendarMonthProps {
  year: number;
  month: number; // 0-indexed (0=Jan ... 11=Dec)
  shifts: Shift[];
  shiftTypes: ShiftType[];
  families?: Family[];
  mode?: 'view_schedule' | 'admin_edit' | 'parent_wish';
  blockedDates?: string[];
  blockedShiftIds?: string[];
  onToggleBlockDate?: (dateStr: string) => void;
  onToggleBlockShift?: (shiftId: string) => void;
  filterFamilyId?: string | null;
  onSelectShift?: (shift: Shift) => void;
  onAddShiftOnDate?: (dateStr: string) => void;
  onDeleteShift?: (shiftId: string) => void;
  lang: Language;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  hasPrevMonth?: boolean;
  hasNextMonth?: boolean;
}

// ISO Week number helper
function getIsoWeekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

export const CalendarMonth: React.FC<CalendarMonthProps> = ({
  year,
  month,
  shifts,
  shiftTypes,
  families = [],
  mode = 'view_schedule',
  blockedDates = [],
  blockedShiftIds = [],
  onToggleBlockDate,
  onToggleBlockShift,
  filterFamilyId = null,
  onSelectShift,
  onAddShiftOnDate,
  onDeleteShift,
  lang,
  onPrevMonth,
  onNextMonth,
  hasPrevMonth,
  hasNextMonth,
}) => {
  const t = translations[lang];
  const [viewFormat, setViewFormat] = useState<'month' | 'agenda'>('month');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [localFamilyFilter, setLocalFamilyFilter] = useState<string>(filterFamilyId || 'all');
  const [activeShiftDetail, setActiveShiftDetail] = useState<Shift | null>(null);

  const monthName = t.months[month];
  const dayHeaders = t.daysShort;

  const typeMap = new Map(shiftTypes.map(st => [st.id, st]));
  const familyMap = new Map(families.map(f => [f.id, f.name]));

  // Days in month
  const firstDayOfMonth = new Date(year, month, 1, 12, 0, 0);
  const lastDayOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
  const totalDays = lastDayOfMonth.getDate();

  // Day of week of 1st day (1=Mon ... 7=Sun)
  const firstJsDay = firstDayOfMonth.getDay();
  const startDayOffset = firstJsDay === 0 ? 6 : firstJsDay - 1;

  interface DayInfo {
    dayNum: number | null;
    dateStr: string | null;
    isWeekend: boolean;
  }

  const calendarWeeks: DayInfo[][] = [];
  let currentWeek: DayInfo[] = [];

  for (let i = 0; i < startDayOffset; i++) {
    currentWeek.push({ dayNum: null, dateStr: null, isWeekend: i >= 5 });
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeekIdx = (startDayOffset + day - 1) % 7;
    const isWeekend = dayOfWeekIdx >= 5;

    currentWeek.push({
      dayNum: day,
      dateStr,
      isWeekend,
    });

    if (currentWeek.length === 7) {
      calendarWeeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      const idx = currentWeek.length;
      currentWeek.push({ dayNum: null, dateStr: null, isWeekend: idx >= 5 });
    }
    calendarWeeks.push(currentWeek);
  }

  const effectiveFamilyFilter = filterFamilyId !== undefined && filterFamilyId !== null
    ? filterFamilyId
    : (localFamilyFilter !== 'all' ? localFamilyFilter : null);

  // Filter shifts
  const monthShifts = shifts.filter(s => {
    const d = parseLocalDate(s.date);
    const matchesMonth = d.getFullYear() === year && d.getMonth() === month;
    if (!matchesMonth) return false;

    if (selectedTypeFilter !== 'all' && s.shiftTypeId !== selectedTypeFilter) {
      return false;
    }
    if (effectiveFamilyFilter && s.assignedFamilyId !== effectiveFamilyFilter) {
      return false;
    }
    return true;
  });

  const getShiftBoxColors = (colorKey: string) => {
    const token = themeTokens.shiftColors[colorKey as keyof typeof themeTokens.shiftColors] || themeTokens.shiftColors.emerald;
    return `${token.boxLight} ${token.boxDark}`;
  };

  const handleShiftClick = (shift: Shift) => {
    if (onSelectShift) {
      onSelectShift(shift);
    } else {
      setActiveShiftDetail(shift);
    }
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden w-full max-w-full transition-colors space-y-0">
      {/* Top Toolbar: Month Name, Filters, View Switcher */}
      <div className="px-3.5 sm:px-5 py-3 bg-stone-100 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {(onPrevMonth || onNextMonth) && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onPrevMonth}
                disabled={hasPrevMonth === false || !onPrevMonth}
                className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                title={t.parent.prevMonth}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onNextMonth}
                disabled={hasNextMonth === false || !onNextMonth}
                className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                title={t.parent.nextMonth}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <h3 className="font-bold text-stone-900 dark:text-stone-100 text-sm sm:text-base md:text-lg tracking-tight">
            {monthName} {year}
          </h3>
          <span className="text-xs bg-stone-200 dark:bg-stone-700 text-stone-800 dark:text-stone-200 px-2 py-0.5 rounded-md font-semibold">
            {monthShifts.length} {lang === 'sv' ? 'pass' : 'shifts'}
          </span>
        </div>

        {/* Filters & View switcher */}
        <div className="flex items-center gap-2 flex-wrap">
          {shiftTypes.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full">
              <button
                type="button"
                onClick={() => setSelectedTypeFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  selectedTypeFilter === 'all'
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-2xs'
                    : 'bg-stone-200/80 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-600'
                }`}
              >
                {t.common.all}
              </button>
              {shiftTypes.map(st => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedTypeFilter(st.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                    selectedTypeFilter === st.id
                      ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-2xs'
                      : 'bg-stone-200/80 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-600'
                  }`}
                >
                  {st.name}
                </button>
              ))}
            </div>
          )}

          {/* Family filter for schedule view */}
          {mode === 'view_schedule' && filterFamilyId === undefined && families.length > 0 && (
            <select
              value={localFamilyFilter}
              onChange={e => setLocalFamilyFilter(e.target.value)}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-stone-200/80 dark:bg-stone-700 border border-stone-300 dark:border-stone-600 text-stone-800 dark:text-stone-200 cursor-pointer max-w-[140px] truncate"
            >
              <option value="all">{t.schedule.allFamilies}</option>
              {families.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          {/* View Mode Toggle */}
          <div className="inline-flex p-0.5 bg-stone-200 dark:bg-stone-700 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setViewFormat('month')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                viewFormat === 'month'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-2xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.schedule.calendarView}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewFormat('agenda')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                viewFormat === 'agenda'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-2xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.schedule.listView}</span>
            </button>
          </div>
        </div>
      </div>

      {/* AGENDA TIMELINE VIEW */}
      {viewFormat === 'agenda' ? (
        <div className="divide-y divide-stone-200 dark:divide-stone-800 p-3 sm:p-5 space-y-3">
          {monthShifts.length === 0 ? (
            <p className="text-xs text-stone-400 dark:text-stone-500 text-center py-8">
              {t.schedule.emptySemester}
            </p>
          ) : (
            monthShifts.map(s => {
              const sType = typeMap.get(s.shiftTypeId);
              const isDayBlocked = blockedDates.includes(s.date);
              const isShiftBlocked = isDayBlocked || blockedShiftIds.includes(s.id);
              const assignedName = s.assignedFamilyId ? familyMap.get(s.assignedFamilyId) : null;
              const dateObj = parseLocalDate(s.date);
              const weekday = t.weekdays[dateObj.getDay()];
              const weekNo = getIsoWeekNumber(dateObj);
              const boxColors = getShiftBoxColors(sType?.color || 'emerald');

              return (
                <div
                  key={s.id}
                  className={`p-3.5 sm:p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isShiftBlocked
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-900'
                      : boxColors
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 text-stone-800 dark:text-stone-200">
                        {t.parent.weekAbbr} {weekNo}
                      </span>
                      <span className="text-xs sm:text-sm font-bold truncate">
                        {sType?.name || s.name}
                      </span>
                      <span className="text-xs font-semibold opacity-80">
                        {s.date} ({weekday})
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs opacity-80">
                      <span className="flex items-center gap-1 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        {s.startTime} - {s.endTime}
                      </span>
                      {sType?.weight && (
                        <span>• {sType.weight} {t.admin.points}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                    {mode === 'view_schedule' && (
                      <button
                        type="button"
                        onClick={() => handleShiftClick(s)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 hover:bg-white dark:hover:bg-stone-900 cursor-pointer transition-colors"
                      >
                        <User className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                        <span className="text-xs font-bold truncate max-w-[140px]">
                          {assignedName || t.schedule.unassigned}
                        </span>
                      </button>
                    )}

                    {mode === 'parent_wish' && (
                      <button
                        type="button"
                        onClick={() => onToggleBlockShift && onToggleBlockShift(s.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors cursor-pointer ${
                          isShiftBlocked
                            ? 'bg-rose-600 text-white shadow-xs'
                            : 'bg-white/80 dark:bg-stone-900/80 text-stone-800 dark:text-stone-200 hover:bg-rose-100 hover:text-rose-900 dark:hover:bg-rose-950 dark:hover:text-rose-200'
                        }`}
                      >
                        {isShiftBlocked ? t.parent.blockedBadge : t.parent.cantAttend}
                      </button>
                    )}

                    {mode === 'admin_edit' && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onSelectShift && onSelectShift(s)}
                          className="px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 text-xs font-semibold cursor-pointer flex items-center gap-1"
                          title={t.common.edit}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t.common.edit}</span>
                        </button>
                        {onDeleteShift && (
                          <button
                            type="button"
                            onClick={() => onDeleteShift(s.id)}
                            className="p-1.5 text-stone-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title={t.common.delete}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* MODERN MONTH GRID VIEW */
        <div className="w-full overflow-x-auto">
          <div className="grid grid-cols-[36px_repeat(7,minmax(0,1fr))] sm:grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-center text-[10px] sm:text-xs font-bold text-stone-700 dark:text-stone-300 py-2.5">
            <div className="text-stone-400 dark:text-stone-500 font-normal">v.</div>
            {dayHeaders.map((dh, idx) => (
              <div
                key={idx}
                className={`py-0.5 rounded-sm ${
                  idx >= 5
                    ? 'bg-stone-200/50 dark:bg-stone-750/50 text-stone-700 dark:text-stone-300 font-bold'
                    : ''
                }`}
              >
                {dh}
              </div>
            ))}
          </div>

          <div className="divide-y divide-stone-200 dark:divide-stone-800">
            {calendarWeeks.map((week, wIdx) => {
              const sampleDay = week.find(d => d.dateStr !== null);
              const weekNumber = sampleDay ? getIsoWeekNumber(parseLocalDate(sampleDay.dateStr!)) : '';

              return (
                <div
                  key={`week-${wIdx}`}
                  className="grid grid-cols-[36px_repeat(7,minmax(0,1fr))] sm:grid-cols-[44px_repeat(7,minmax(0,1fr))] divide-x divide-stone-200 dark:divide-stone-800"
                >
                  {/* Week number gutter */}
                  <div className="bg-stone-50 dark:bg-stone-900 p-1 flex items-center justify-center text-[10px] sm:text-xs font-bold text-stone-400 dark:text-stone-500 select-none">
                    {weekNumber}
                  </div>

                  {week.map((cell, cIdx) => {
                    if (cell.dayNum === null || !cell.dateStr) {
                      return (
                        <div
                          key={`empty-${cIdx}`}
                          className="min-h-18 sm:min-h-26 md:min-h-32 bg-stone-50/40 dark:bg-stone-950/40 p-1"
                        />
                      );
                    }

                    const dateStr = cell.dateStr;
                    const isWeekend = cell.isWeekend;
                    const dayShifts = shifts.filter(s => s.date === dateStr);
                    const isDayBlocked = blockedDates.includes(dateStr);

                    // Filter shifts for this cell
                    const filteredDayShifts = dayShifts.filter(s => {
                      if (selectedTypeFilter !== 'all' && s.shiftTypeId !== selectedTypeFilter) return false;
                      if (effectiveFamilyFilter && s.assignedFamilyId !== effectiveFamilyFilter) return false;
                      return true;
                    });

                    return (
                      <div
                        key={dateStr}
                        className={`min-h-22 sm:min-h-28 md:min-h-36 p-1 sm:p-1.5 md:p-2 transition-colors relative flex flex-col justify-between overflow-hidden ${
                          isWeekend
                            ? 'bg-stone-100/40 dark:bg-stone-800/40'
                            : 'bg-white dark:bg-stone-900'
                        } ${isDayBlocked ? 'bg-rose-50/90 dark:bg-rose-950/60 ring-2 ring-rose-400 dark:ring-rose-800' : ''}`}
                      >
                        {/* Day header: Number + Large touch-friendly day block button or admin add */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span
                            className={`text-[11px] sm:text-xs md:text-sm font-bold rounded-full w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center shrink-0 ${
                              isDayBlocked
                                ? 'bg-rose-600 text-white'
                                : 'text-stone-900 dark:text-stone-100'
                            }`}
                          >
                            {cell.dayNum}
                          </span>

                          {/* Touch-friendly Block Day Button for parents */}
                          {mode === 'parent_wish' && onToggleBlockDate && (
                            <button
                              type="button"
                              onClick={() => onToggleBlockDate(dateStr)}
                              className={`text-[9px] sm:text-[10px] px-1.5 py-1 sm:px-2 sm:py-1 rounded-md font-bold transition-all shrink-0 cursor-pointer shadow-2xs ${
                                isDayBlocked
                                  ? 'bg-rose-600 text-white hover:bg-rose-700 ring-1 ring-rose-500'
                                  : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-rose-100 hover:text-rose-900 dark:hover:bg-rose-950 dark:hover:text-rose-200 border border-stone-200 dark:border-stone-700'
                              }`}
                              title={isDayBlocked ? t.parent.unblockWholeDay : t.parent.blockWholeDay}
                            >
                              {isDayBlocked ? (
                                <span className="flex items-center gap-1">
                                  <Ban className="w-2.5 h-2.5" />
                                  <span>{t.parent.blockedBadge}</span>
                                </span>
                              ) : (
                                <span>{t.parent.blockWholeDay}</span>
                              )}
                            </button>
                          )}

                          {mode === 'admin_edit' && onAddShiftOnDate && (
                            <button
                              type="button"
                              onClick={() => onAddShiftOnDate(dateStr)}
                              className="text-stone-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 p-1 rounded-md transition-colors cursor-pointer"
                              title={t.admin.addIndividualShift}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Shifts in cell with vibrant full-box background color */}
                        <div className="space-y-1 flex-1 overflow-hidden">
                          {filteredDayShifts.map(s => {
                            const sType = typeMap.get(s.shiftTypeId);
                            const isShiftBlocked = isDayBlocked || blockedShiftIds.includes(s.id);
                            const assignedName = s.assignedFamilyId ? familyMap.get(s.assignedFamilyId) : null;
                            const boxColors = getShiftBoxColors(sType?.color || 'emerald');

                            if (mode === 'parent_wish') {
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => onToggleBlockShift && onToggleBlockShift(s.id)}
                                  className={`w-full text-left p-1 rounded-md text-[10px] sm:text-[11px] border transition-all cursor-pointer ${
                                    isShiftBlocked
                                      ? 'bg-rose-100 dark:bg-rose-950 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 font-bold ring-1 ring-rose-400'
                                      : boxColors
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="truncate font-bold">{sType?.name || s.name}</span>
                                    {isShiftBlocked ? (
                                      <Ban className="w-2.5 h-2.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                    ) : (
                                      <span className="text-[9px] opacity-75 shrink-0 hidden sm:inline">
                                        {s.startTime}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            }

                            if (mode === 'admin_edit') {
                              return (
                                <div
                                  key={s.id}
                                  onClick={() => onSelectShift && onSelectShift(s)}
                                  className={`p-1 rounded-md text-[10px] sm:text-[11px] border cursor-pointer transition-all ${boxColors}`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-bold truncate text-[10px]">
                                      {sType?.name || s.name}
                                    </span>
                                  </div>
                                  <div className="text-[9px] sm:text-[10px] opacity-80 mt-0.5 flex items-center justify-between">
                                    <span>{s.startTime}</span>
                                    {assignedName && (
                                      <span className="font-extrabold truncate max-w-[60px]">
                                        {assignedName.replace('Familjen ', '')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            }

                            // Mode: view_schedule (Full schedule view)
                            return (
                              <div
                                key={s.id}
                                onClick={() => handleShiftClick(s)}
                                className={`p-1 sm:p-1.5 rounded-md text-[10px] sm:text-[11px] border cursor-pointer hover:shadow-xs transition-all ${boxColors} ${
                                  effectiveFamilyFilter && s.assignedFamilyId === effectiveFamilyFilter
                                    ? 'ring-2 ring-emerald-500 font-extrabold'
                                    : ''
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-bold truncate text-[10px]">
                                    {sType?.name || s.name}
                                  </span>
                                  <span className="text-[9px] opacity-75 hidden sm:inline">
                                    {s.startTime}
                                  </span>
                                </div>
                                <div className="mt-0.5 font-semibold truncate text-[10px] sm:text-[11px]">
                                  {assignedName ? (
                                    <span className="font-bold truncate block">
                                      {assignedName}
                                    </span>
                                  ) : (
                                    <span className="opacity-70 italic font-normal block">
                                      {t.schedule.unassigned}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* READ-ONLY SHIFT DETAILS MODAL FOR PARENTS */}
      {activeShiftDetail && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShiftBadge shiftType={typeMap.get(activeShiftDetail.shiftTypeId)} size="lg" />
              </div>
              <button
                onClick={() => setActiveShiftDetail(null)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-1">
              <div className="p-3.5 bg-stone-50 dark:bg-stone-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-stone-500 dark:text-stone-400">{t.common.date}:</span>
                  <span className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100">
                    {activeShiftDetail.date} ({t.weekdays[parseLocalDate(activeShiftDetail.date).getDay()]})
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-stone-500 dark:text-stone-400">{t.common.time}:</span>
                  <span className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-stone-400" />
                    {activeShiftDetail.startTime} - {activeShiftDetail.endTime}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-stone-500 dark:text-stone-400">{t.admin.typeWeight}:</span>
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                    {typeMap.get(activeShiftDetail.shiftTypeId)?.weight || 1.0} {t.admin.points}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-stone-200 dark:border-stone-700">
                  <span className="text-xs text-stone-500 dark:text-stone-400">{t.schedule.assignedTo}:</span>
                  <span className="text-xs sm:text-sm font-extrabold text-emerald-800 dark:text-emerald-300">
                    {activeShiftDetail.assignedFamilyId
                      ? familyMap.get(activeShiftDetail.assignedFamilyId)
                      : t.schedule.unassigned}
                  </span>
                </div>
              </div>

              {typeMap.get(activeShiftDetail.shiftTypeId)?.description && (
                <div className="p-3 bg-stone-50/60 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/80 rounded-xl text-xs text-stone-600 dark:text-stone-300 space-y-1">
                  <span className="font-bold block text-stone-800 dark:text-stone-200">Uppgiftsbeskrivning:</span>
                  <p>{typeMap.get(activeShiftDetail.shiftTypeId)?.description}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setActiveShiftDetail(null)}
                className="px-4 py-2 bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 text-xs sm:text-sm font-bold rounded-xl cursor-pointer"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
