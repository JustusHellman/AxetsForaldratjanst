import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
  X,
} from 'lucide-react';
import { generateIcsCalendar } from '../calendarExport';
import {
  exportToCsv,
  exportToExcel,
  exportToWordDocx,
  triggerPrintSchedule,
} from '../scheduleExport';
import { Language, translations } from '../translations';
import { CoopConfig, Family, Shift, ShiftType } from '../types';

interface ExportMenuProps {
  config: CoopConfig;
  shifts?: Shift[];
  shiftTypes?: ShiftType[];
  families?: Family[];
  lang: Language;
  selectedFamilyId?: string | null;
  buttonLabel?: string;
  buttonClassName?: string;
  variant?: 'primary' | 'secondary' | 'emerald';
  align?: 'left' | 'right';
  showCalendarIcs?: boolean;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  config,
  shifts = config.shifts,
  shiftTypes = config.shiftTypes,
  families = config.families,
  lang,
  selectedFamilyId = null,
  buttonLabel,
  buttonClassName,
  variant = 'secondary',
  align = 'right',
  showCalendarIcs = false,
}) => {
  const t = translations[lang] || translations.sv;
  const [isOpen, setIsOpen] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const desktopMenuRef = useRef<HTMLDivElement>(null);

  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  // Compute position for desktop anchored dropdown (never overflowing screen)
  const updatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const menuWidth = Math.min(320, vw - 24);
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const openUpwards = spaceBelow < 280 && spaceAbove > spaceBelow;

    let targetLeft: number;
    if (align === 'right') {
      targetLeft = rect.right - menuWidth;
    } else {
      targetLeft = rect.left;
    }

    const clampedLeft = Math.max(12, Math.min(targetLeft, vw - menuWidth - 12));

    const style: React.CSSProperties = {
      position: 'fixed',
      width: `${menuWidth}px`,
      maxWidth: 'calc(100vw - 24px)',
      left: `${clampedLeft}px`,
      zIndex: 50,
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
    };

    if (openUpwards) {
      style.bottom = `${vh - rect.top + 6}px`;
    } else {
      style.top = `${rect.bottom + 6}px`;
    }

    setDropdownStyle(style);
  };

  // Lock body scroll on small screens when modal is open, and close on page scroll on desktop
  useEffect(() => {
    if (!isOpen) return;

    const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 640;

    if (isSmallScreen) {
      // Lock background body scroll so the page doesn't scroll underneath modal
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    } else {
      updatePosition();

      // On desktop, close when scrolling outside the menu
      const handleScroll = (e: Event) => {
        if (
          desktopMenuRef.current &&
          !desktopMenuRef.current.contains(e.target as Node)
        ) {
          setIsOpen(false);
        }
      };

      const handleResize = () => {
        updatePosition();
      };

      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [isOpen, align]);

  const selectedFamily = selectedFamilyId
    ? families.find(f => f.id === selectedFamilyId)
    : null;

  const handleExportWord = async (filterFamily: boolean) => {
    try {
      setIsExportingDocx(true);
      await exportToWordDocx({
        termName: config.termName,
        startDate: config.startDate,
        endDate: config.endDate,
        shifts,
        shiftTypes,
        families,
        filterFamilyId: filterFamily ? selectedFamilyId : null,
        appName: t.app.title,
        lang,
      });
      setExportSuccess(t.schedule.exportSuccess);
      setTimeout(() => setExportSuccess(null), 3000);
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to export Word document:', err);
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportExcel = (filterFamily: boolean) => {
    exportToExcel({
      termName: config.termName,
      startDate: config.startDate,
      endDate: config.endDate,
      shifts,
      shiftTypes,
      families,
      filterFamilyId: filterFamily ? selectedFamilyId : null,
      appName: t.app.title,
      lang,
    });
    setExportSuccess(t.schedule.exportSuccess);
    setTimeout(() => setExportSuccess(null), 3000);
    setIsOpen(false);
  };

  const handleExportCsv = (filterFamily: boolean) => {
    exportToCsv({
      termName: config.termName,
      startDate: config.startDate,
      endDate: config.endDate,
      shifts,
      shiftTypes,
      families,
      filterFamilyId: filterFamily ? selectedFamilyId : null,
      appName: t.app.title,
      lang,
    });
    setExportSuccess(t.schedule.exportSuccess);
    setTimeout(() => setExportSuccess(null), 3000);
    setIsOpen(false);
  };

  const handlePrint = () => {
    setIsOpen(false);
    setTimeout(() => {
      triggerPrintSchedule();
    }, 150);
  };

  const handleDownloadIcs = () => {
    const famShifts = selectedFamilyId
      ? shifts.filter(s => s.assignedFamilyId === selectedFamilyId)
      : shifts;

    const icsContent = generateIcsCalendar(
      famShifts,
      shiftTypes,
      config.termName,
      selectedFamily?.name
    );

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanTerm = config.termName.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
    a.download = selectedFamily
      ? `${cleanTerm}_${selectedFamily.name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_')}.ics`
      : `${cleanTerm}_alla_pass.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setIsOpen(false);
  };

  const defaultClasses = {
    primary:
      'bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 shadow-xs',
    emerald:
      'bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs',
    secondary:
      'bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 border border-stone-300 dark:border-stone-700 shadow-xs',
  };

  const optionsListContent = (
    <div className="space-y-1">
      {/* Word Document Full Schedule */}
      <button
        type="button"
        onClick={() => handleExportWord(false)}
        disabled={isExportingDocx}
        className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 active:bg-stone-200 dark:active:bg-stone-700 transition-colors cursor-pointer group"
      >
        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
          <FileText className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center justify-between gap-1">
            <span className="truncate">
              {selectedFamilyId
                ? t.schedule.exportWordAllShifts
                : t.schedule.exportWord}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 shrink-0">
              .docx
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
            {t.schedule.exportWordDesc}
          </p>
        </div>
      </button>

      {/* Word Document My Shifts (if family selected) */}
      {selectedFamilyId && selectedFamily && (
        <button
          type="button"
          onClick={() => handleExportWord(true)}
          disabled={isExportingDocx}
          className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 active:bg-stone-200 dark:active:bg-stone-700 transition-colors cursor-pointer group"
        >
          <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
            <FileText className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center justify-between gap-1">
              <span className="truncate">{selectedFamily.name}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 shrink-0">
                .docx
              </span>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
              {lang === 'sv'
                ? `Enbart ${selectedFamily.name}s pass för kylskåp & utskrift`
                : `Only shifts for ${selectedFamily.name}`}
            </p>
          </div>
        </button>
      )}

      {/* Excel Workbook (.xlsx) with 100% å, ä, ö support */}
      <button
        type="button"
        onClick={() => handleExportExcel(Boolean(selectedFamilyId))}
        className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 active:bg-stone-200 dark:active:bg-stone-700 transition-colors cursor-pointer group"
      >
        <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
          <FileSpreadsheet className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center justify-between gap-1">
            <span>{t.schedule.exportExcel || 'Excel (.xlsx)'}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 shrink-0">
              .xlsx
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
            {t.schedule.exportExcelDesc || 'Färdigt kalkylblad med fullt stöd för å, ä, ö'}
          </p>
        </div>
      </button>

      {/* Print / Save as PDF */}
      <button
        type="button"
        onClick={handlePrint}
        className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 active:bg-stone-200 dark:active:bg-stone-700 transition-colors cursor-pointer group"
      >
        <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
          <Printer className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center justify-between gap-1">
            <span>{t.schedule.exportPrint}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300 shrink-0">
              PDF
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
            {t.schedule.exportPrintDesc}
          </p>
        </div>
      </button>

      {/* CSV File */}
      <button
        type="button"
        onClick={() => handleExportCsv(Boolean(selectedFamilyId))}
        className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 active:bg-stone-200 dark:active:bg-stone-700 transition-colors cursor-pointer group"
      >
        <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
          <FileSpreadsheet className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center justify-between gap-1">
            <span>{t.schedule.exportCsv}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 shrink-0">
              .csv
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
            {t.schedule.exportCsvDesc}
          </p>
        </div>
      </button>

      {/* Calendar ICS (if requested or family selected) */}
      {(showCalendarIcs || selectedFamilyId) && (
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 active:bg-stone-200 dark:active:bg-stone-700 transition-colors cursor-pointer group"
        >
          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center justify-between gap-1">
              <span>{t.schedule.downloadIcs}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 shrink-0">
                .ics
              </span>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
              {lang === 'sv'
                ? 'För in i mobilkalender (Apple, Google, Outlook)'
                : 'Import into phone calendar (Apple, Google, Outlook)'}
            </p>
          </div>
        </button>
      )}
    </div>
  );

  return (
    <div className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!isOpen) {
            updatePosition();
          }
          setIsOpen(!isOpen);
        }}
        disabled={isExportingDocx}
        className={
          buttonClassName ||
          `inline-flex items-center justify-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all cursor-pointer ${
            defaultClasses[variant]
          }`
        }
        title={t.schedule.exportAs}
      >
        {isExportingDocx ? (
          <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
        ) : exportSuccess ? (
          <Check className="w-4 h-4 text-emerald-500" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span>{buttonLabel || t.schedule.exportAs}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <>
          {/* MOBILE MODAL: When screen is small (< 640px), render as a clean modal dialog with locked background scrolling */}
          <div className="sm:hidden fixed inset-0 z-50 flex items-end justify-center">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-stone-950/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
              onClick={() => setIsOpen(false)}
            />

            {/* Modal Bottom Sheet Card */}
            <div className="relative w-full bg-white dark:bg-stone-900 rounded-t-3xl border-t border-stone-200 dark:border-stone-800 shadow-2xl p-4 pb-8 max-h-[85vh] overflow-y-auto z-50 animate-in slide-in-from-bottom duration-200">
              {/* Drag indicator */}
              <div className="w-12 h-1.5 rounded-full bg-stone-300 dark:bg-stone-700 mx-auto mb-3" />

              {/* Header info */}
              <div className="px-1 py-1 border-b border-stone-100 dark:border-stone-800 mb-3 flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    {t.schedule.exportAs}
                  </p>
                  <p className="text-sm text-stone-900 dark:text-stone-100 font-semibold truncate">
                    {config.termName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-full text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                  aria-label="Stäng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Options list */}
              {optionsListContent}
            </div>
          </div>

          {/* DESKTOP DROPDOWN: Fixed anchored popover for screens >= 640px */}
          <div className="hidden sm:block">
            {/* Backdrop for outside click dismissal */}
            <div
              className="fixed inset-0 z-40 bg-transparent"
              onClick={() => setIsOpen(false)}
            />

            <div
              ref={desktopMenuRef}
              style={dropdownStyle}
              className="rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-100"
            >
              {/* Header info */}
              <div className="px-3 py-2 border-b border-stone-100 dark:border-stone-800 mb-1 flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    {t.schedule.exportAs}
                  </p>
                  <p className="text-xs text-stone-700 dark:text-stone-200 font-semibold truncate">
                    {config.termName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                  aria-label="Stäng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {optionsListContent}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
