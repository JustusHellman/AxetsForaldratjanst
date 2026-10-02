import React from 'react';
import { parseLocalDate } from '../scheduler';
import { Language, translations } from '../translations';
import { FamilyWish, Shift, ShiftType, TypePreferenceLevel } from '../types';
import { ratiosToLevels } from '../typePreference';
import { ShiftBadge } from './ShiftBadge';

interface Props {
  wish?: FamilyWish;
  assignedShifts: Shift[];
  shiftTypes: ShiftType[];
  naturalRatios: Record<string, number>;
  lang: Language;
}

const fmtDate = (d: string, lang: Language) =>
  parseLocalDate(d).toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-GB', { day: 'numeric', month: 'short' });

/** After publishing: a short "what you asked for vs. what you got" for the selected family. */
export const WishResultSummary: React.FC<Props> = ({ wish, assignedShifts, shiftTypes, naturalRatios, lang }) => {
  const t = translations[lang].parent;
  if (assignedShifts.length === 0) return null;

  if (!wish) {
    return (
      <div className="bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 text-xs sm:text-sm text-stone-600 dark:text-stone-400">
        {t.resultNoWish}
      </div>
    );
  }

  const levelLabel: Record<TypePreferenceLevel, string> = {
    none: t.levelNone,
    little: t.levelLittle,
    medium: t.levelMedium,
    mostly: t.levelMostly,
    only: t.levelOnly,
  };

  // Spacing
  const dates = assignedShifts.map(s => s.date).sort();
  const pref = wish.spacingPreference || 'neutral';
  const wantedSpacing = pref === 'spread' ? t.spreadOption : pref === 'grouped' ? t.groupedOption : t.neutralOption;
  // A short, preference-specific summary of when the family's shifts fall
  const dayDiff = (a: string, b: string) => Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 86400000);
  const from = dates.length ? fmtDate(dates[0], lang) : '';
  const to = dates.length ? fmtDate(dates[dates.length - 1], lang) : '';
  let gotSpacing = t.resultSingleShift.replace('{date}', from);
  if (dates.length >= 2) {
    const totalDays = dayDiff(dates[0], dates[dates.length - 1]);
    if (pref === 'spread') {
      let shortest = Infinity;
      for (let i = 1; i < dates.length; i++) shortest = Math.min(shortest, dayDiff(dates[i - 1], dates[i]));
      const avg = String(Math.round(totalDays / (dates.length - 1)));
      gotSpacing = (shortest === 0 ? t.resultSpreadSummarySameDay : t.resultSpreadSummary)
        .replace('{avg}', avg)
        .replace('{min}', String(shortest));
    } else if (pref === 'grouped') {
      const weeks = Math.ceil((totalDays + 1) / 7);
      gotSpacing = t.resultGroupedSummary
        .replace('{n}', String(dates.length))
        .replace('{period}', weeks <= 1 ? t.periodOneWeek : t.periodWeeks.replace('{n}', String(weeks)))
        .replace('{from}', from)
        .replace('{to}', to);
    } else {
      gotSpacing = t.resultNeutralSummary.replace('{n}', String(dates.length)).replace('{from}', from).replace('{to}', to);
    }
  }

  // Types
  const levels = wish.typeLevels ?? ratiosToLevels(shiftTypes, wish.typeRatios || {}, naturalRatios);
  const counts = shiftTypes.map(st => ({ st, n: assignedShifts.filter(s => s.shiftTypeId === st.id).length }));

  // Blocked dates
  const blockedSet = new Set(wish.blockedDates || []);
  const blockedIds = new Set(wish.blockedShiftIds || []);
  const hits = assignedShifts.filter(s => blockedSet.has(s.date) || blockedIds.has(s.id)).length;
  const blockedCount = blockedSet.size + blockedIds.size;
  const gotBlocked =
    hits > 0
      ? t.resultBlockedConflict.replace('{n}', String(hits))
      : blockedCount === 0
        ? t.resultBlockedNone
        : t.resultBlockedOk;
  const wantedBlocked =
    blockedCount === 0
      ? '–'
      : [
          blockedSet.size > 0 ? t.resultBlockedDays.replace('{n}', String(blockedSet.size)) : '',
          blockedIds.size > 0 ? t.resultBlockedShifts.replace('{n}', String(blockedIds.size)) : '',
        ]
          .filter(Boolean)
          .join(', ');

  const Row: React.FC<{ label: string; wanted: React.ReactNode; got: React.ReactNode }> = ({ label, wanted, got }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr_1fr] gap-1 sm:gap-4 py-2.5 border-t border-stone-100 dark:border-stone-800 first:border-t-0 text-xs sm:text-sm">
      <div className="font-bold text-stone-900 dark:text-stone-100">{label}</div>
      <div className="text-stone-600 dark:text-stone-400">
        <span className="sm:hidden font-semibold">{t.resultWanted}: </span>
        {wanted}
      </div>
      <div className="text-stone-900 dark:text-stone-100 font-medium">
        <span className="sm:hidden font-semibold">{t.resultGot}: </span>
        {got}
      </div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 sm:p-5 shadow-xs">
      <h4 className="text-sm sm:text-base font-bold text-stone-900 dark:text-stone-100 mb-1">{t.resultTitle}</h4>
      <div className="hidden sm:grid grid-cols-[9rem_1fr_1fr] gap-4 text-[11px] font-semibold uppercase tracking-wide text-stone-400 pb-1">
        <div />
        <div>{t.resultWanted}</div>
        <div>{t.resultGot}</div>
      </div>
      <Row label={t.resultRowSpacing} wanted={wantedSpacing} got={gotSpacing} />
      {shiftTypes.length > 1 && (
        <Row
          label={t.resultRowTypes}
          wanted={
            wish.typeFlexible ? (
              t.typeFlexibleTitle
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {shiftTypes.map(st => (
                  <span key={st.id}>
                    {st.name}: <b>{levelLabel[levels[st.id] ?? 'medium']}</b>
                  </span>
                ))}
              </span>
            )
          }
          got={
            <span className="flex flex-wrap gap-1.5 items-center">
              {counts.map(({ st, n }) => (
                <span key={st.id} className="inline-flex items-center gap-1">
                  <b>{n}</b> <ShiftBadge shiftType={st} size="sm" />
                </span>
              ))}
            </span>
          }
        />
      )}
      <Row label={t.resultRowBlocked} wanted={wantedBlocked} got={gotBlocked} />
    </div>
  );
};
