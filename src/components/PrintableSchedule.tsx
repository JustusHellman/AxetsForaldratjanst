import React from 'react';
import { getIsoWeek } from '../scheduleExport';
import { parseLocalDate } from '../scheduler';
import { Language, translations } from '../translations';
import { CoopConfig } from '../types';

interface PrintableScheduleProps {
  config: CoopConfig;
  lang: Language;
}

export const PrintableSchedule: React.FC<PrintableScheduleProps> = ({
  config,
  lang,
}) => {
  const t = translations[lang] || translations.sv;
  const familyMap = new Map(config.families.map(f => [f.id, f]));
  const typeMap = new Map(config.shiftTypes.map(st => [st.id, st]));

  const activeShifts = [...config.shifts]
    .filter(s => !s.isCancelled)
    .sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

  return (
    <div className="hidden print:block w-full text-black bg-white">
      {/* Document Header */}
      <div className="border-b-2 border-stone-800 pb-3 mb-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            {t.app.title}
          </h1>
          <span className="text-xs text-stone-500">
            {lang === 'sv' ? 'Utskriftsversion' : 'Printable version'}
          </span>
        </div>
        <h2 className="text-base font-semibold text-stone-700 mt-1">
          {config.termName} — {lang === 'sv' ? 'Arbetsschema & Städning' : 'Duty Schedule'}
        </h2>
        <div className="flex items-center gap-3 text-xs text-stone-600 mt-1.5 flex-wrap">
          <span>
            <strong>{lang === 'sv' ? 'Period' : 'Period'}:</strong> {config.startDate} – {config.endDate}
          </span>
          <span>•</span>
          <span>
            <strong>{lang === 'sv' ? 'Totalt antal pass' : 'Total shifts'}:</strong> {activeShifts.length} st
          </span>
          <span>•</span>
          <span>
            <strong>{lang === 'sv' ? 'Antal familjer' : 'Families'}:</strong> {config.families.length} st
          </span>
        </div>
      </div>

      {/* Main Schedule Table */}
      <table className="w-full text-left text-xs border-collapse border border-stone-300 mb-6">
        <thead>
          <tr className="bg-stone-800 text-white font-semibold">
            <th className="border border-stone-400 px-2 py-1.5 text-center w-12">
              {lang === 'sv' ? 'Vecka' : 'Week'}
            </th>
            <th className="border border-stone-400 px-2.5 py-1.5 w-44">
              {lang === 'sv' ? 'Datum & Veckodag' : 'Date & Day'}
            </th>
            <th className="border border-stone-400 px-2.5 py-1.5 w-28">
              {lang === 'sv' ? 'Tid' : 'Time'}
            </th>
            <th className="border border-stone-400 px-2.5 py-1.5 w-36">
              {lang === 'sv' ? 'Passtyp' : 'Shift Type'}
            </th>
            <th className="border border-stone-400 px-2.5 py-1.5">
              {lang === 'sv' ? 'Tilldelad familj' : 'Assigned Family'}
            </th>
            <th className="border border-stone-400 px-2 py-1.5 text-center w-20">
              {lang === 'sv' ? 'Signatur' : 'Signature'}
            </th>
          </tr>
        </thead>
        <tbody>
          {activeShifts.map((shift, idx) => {
            const sType = typeMap.get(shift.shiftTypeId);
            const family = shift.assignedFamilyId
              ? familyMap.get(shift.assignedFamilyId)
              : null;
            const dateObj = parseLocalDate(shift.date);
            const weekday = t.weekdays[dateObj.getDay()] || '';
            const isoWeek = getIsoWeek(shift.date);
            const isEven = idx % 2 === 0;

            return (
              <tr
                key={shift.id}
                className={isEven ? 'bg-white' : 'bg-stone-50'}
              >
                <td className="border border-stone-300 px-2 py-1.5 text-center font-bold text-stone-700">
                  v. {isoWeek}
                </td>
                <td className="border border-stone-300 px-2.5 py-1.5 font-medium text-stone-900">
                  {weekday} {dateObj.getDate()} {t.monthsShort[dateObj.getMonth()]}
                  <span className="text-[10px] text-stone-500 ml-1">
                    ({shift.date})
                  </span>
                </td>
                <td className="border border-stone-300 px-2.5 py-1.5 text-stone-700">
                  {shift.startTime || '—'} – {shift.endTime || '—'}
                </td>
                <td className="border border-stone-300 px-2.5 py-1.5 font-semibold text-stone-800">
                  {sType?.name || shift.name}
                </td>
                <td className="border border-stone-300 px-2.5 py-1.5 font-bold text-stone-900">
                  {family ? family.name : (
                    <span className="text-rose-600 font-normal italic">
                      {lang === 'sv' ? 'Ej tilldelad' : 'Unassigned'}
                    </span>
                  )}
                </td>
                <td className="border border-stone-300 px-2 py-1.5 text-center">
                  <div className="w-4 h-4 border border-stone-400 rounded-xs mx-auto" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary per family */}
      {config.families.length > 0 && (
        <div className="print-avoid-break mt-6">
          <h3 className="text-sm font-bold text-stone-800 border-b border-stone-300 pb-1 mb-2">
            {lang === 'sv' ? 'Sammanställning per familj' : 'Summary per family'}
          </h3>
          <table className="w-full text-left text-xs border-collapse border border-stone-300">
            <thead>
              <tr className="bg-stone-100 text-stone-800 font-semibold">
                <th className="border border-stone-300 px-2.5 py-1 w-48">
                  {lang === 'sv' ? 'Familj' : 'Family'}
                </th>
                <th className="border border-stone-300 px-2.5 py-1 text-center w-24">
                  {lang === 'sv' ? 'Antal pass' : 'Total shifts'}
                </th>
                <th className="border border-stone-300 px-2.5 py-1">
                  {lang === 'sv' ? 'Tilldelade datum' : 'Assigned dates'}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...config.families]
                .sort((a, b) => a.name.localeCompare(b.name, lang))
                .map((fam, fIdx) => {
                  const famShifts = activeShifts.filter(
                    s => s.assignedFamilyId === fam.id
                  );
                  const isEven = fIdx % 2 === 0;

                  return (
                    <tr
                      key={fam.id}
                      className={isEven ? 'bg-white' : 'bg-stone-50'}
                    >
                      <td className="border border-stone-300 px-2.5 py-1 font-bold text-stone-900">
                        {fam.name}
                      </td>
                      <td className="border border-stone-300 px-2.5 py-1 text-center font-bold text-emerald-800">
                        {famShifts.length} st
                      </td>
                      <td className="border border-stone-300 px-2.5 py-1 text-stone-700">
                        {famShifts.length > 0
                          ? famShifts
                              .map(s => {
                                const d = parseLocalDate(s.date);
                                const st = typeMap.get(s.shiftTypeId);
                                return `${d.getDate()} ${t.monthsShort[d.getMonth()]} (${st?.name || s.name})`;
                              })
                              .join(', ')
                          : lang === 'sv'
                          ? 'Inga pass'
                          : 'No shifts'}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Print footer */}
      <div className="mt-6 pt-3 border-t border-stone-300 flex justify-between text-[10px] text-stone-500">
        <span>{t.app.title} • {config.termName}</span>
        <span>
          {lang === 'sv' ? 'Utskrivet' : 'Printed'}: {new Date().toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-US')}
        </span>
      </div>
    </div>
  );
};
