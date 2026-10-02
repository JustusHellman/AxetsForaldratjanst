import React from 'react';
import { Check, Shuffle } from 'lucide-react';
import { themeTokens } from '../theme';
import { Language, translations } from '../translations';
import { ShiftType, TypePreferenceLevel } from '../types';
import { applyLevelChange, defaultLevels, LEVELS, levelsToRatios } from '../typePreference';
import { ShiftBadge } from './ShiftBadge';

interface Props {
  shiftTypes: ShiftType[];
  naturalRatios: Record<string, number>;
  levels: Record<string, TypePreferenceLevel>;
  flexible: boolean;
  onChange: (levels: Record<string, TypePreferenceLevel>, flexible: boolean) => void;
  lang: Language;
}

const dotClass = (st: ShiftType) => {
  const key = (st.color || 'emerald') as keyof typeof themeTokens.shiftColors;
  const token = themeTokens.shiftColors[key] || themeTokens.shiftColors.emerald;
  return `${token.light.dot} ${token.dark.dot}`;
};

/**
 * Question 2: one row per shift type with five steps (Inget, Lite, Mellan, Mest, Bara),
 * plus a sixth answer "Spelar ingen roll". Rows adjust each other so the answer always
 * makes sense, and a bar shows roughly what the family's shifts will look like.
 */
export const ShiftTypePreference: React.FC<Props> = ({ shiftTypes, naturalRatios, levels, flexible, onChange, lang }) => {
  const t = translations[lang].parent;
  const levelLabel: Record<TypePreferenceLevel, string> = {
    none: t.levelNone,
    little: t.levelLittle,
    medium: t.levelMedium,
    mostly: t.levelMostly,
    only: t.levelOnly,
  };

  if (shiftTypes.length <= 1) {
    return (
      <div className="p-4 bg-stone-50 dark:bg-stone-800/60 rounded-xl border border-stone-200 dark:border-stone-700 text-xs sm:text-sm text-stone-700 dark:text-stone-300 flex flex-wrap items-center gap-2">
        <span>{t.singleTypeIntro}</span>
        {shiftTypes[0] && <ShiftBadge shiftType={shiftTypes[0]} size="sm" />}
        <span>{t.singleTypeNothingToChoose}</span>
      </div>
    );
  }

  const current = { ...defaultLevels(shiftTypes), ...levels };
  const ratios = levelsToRatios(shiftTypes, current, naturalRatios);
  const naturalText = shiftTypes.map(st => `${naturalRatios[st.id] ?? 0}% ${st.name.toLowerCase()}`).join(', ');

  return (
    <div className="space-y-4">
      {/* One row per shift type */}
      <div className={`space-y-2.5 transition-opacity ${flexible ? 'opacity-45' : ''}`}>
        {shiftTypes.map(st => (
          <div
            key={st.id}
            className="p-2.5 sm:p-3 bg-stone-50 dark:bg-stone-800/60 rounded-xl border border-stone-200 dark:border-stone-700 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
          >
            <div className="sm:w-48 shrink-0">
              <ShiftBadge shiftType={st} size="md" />
            </div>
            <div className="grid grid-cols-5 gap-1 flex-1" role="radiogroup" aria-label={st.name}>
              {LEVELS.map(level => {
                const selected = !flexible && current[st.id] === level;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(applyLevelChange(shiftTypes, current, st.id, level), false)}
                    className={`py-2 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-colors cursor-pointer border ${
                      selected
                        ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 border-stone-900 dark:border-stone-100 shadow-xs'
                        : 'bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    {levelLabel[level]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Roughly what this means */}
      {!flexible && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">{t.levelPreviewTitle}</p>
          <div className="h-6 rounded-lg overflow-hidden flex w-full border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800">
            {shiftTypes.map(st =>
              (ratios[st.id] ?? 0) > 0 ? (
                <div
                  key={st.id}
                  className={`${dotClass(st)} h-full flex items-center justify-center text-[10px] sm:text-[11px] font-bold text-white transition-all duration-300`}
                  style={{ width: `${ratios[st.id]}%` }}
                  title={`${st.name}: ${ratios[st.id]}%`}
                >
                  {ratios[st.id] >= 12 ? `${ratios[st.id]}%` : ''}
                </div>
              ) : null
            )}
          </div>
          <p className="text-[11px] sm:text-xs text-stone-500 dark:text-stone-400">
            {t.levelScaleHelp.replace('{natural}', naturalText)}
          </p>
        </div>
      )}

      {/* Sixth answer: doesn't matter */}
      <button
        type="button"
        onClick={() => onChange(current, !flexible)}
        aria-pressed={flexible}
        className={`w-full text-left p-3.5 sm:p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
          flexible
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 shadow-xs'
            : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600'
        }`}
      >
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            flexible ? 'bg-emerald-600 text-white' : 'bg-stone-100 dark:bg-stone-800 text-stone-500'
          }`}
        >
          {flexible ? <Check className="w-4 h-4" /> : <Shuffle className="w-3.5 h-3.5" />}
        </span>
        <span>
          <span className="block font-bold text-sm sm:text-base text-stone-900 dark:text-stone-100">{t.typeFlexibleTitle}</span>
          <span className="block text-xs sm:text-sm text-stone-600 dark:text-stone-400 mt-0.5">{t.typeFlexibleDesc}</span>
        </span>
      </button>
    </div>
  );
};
