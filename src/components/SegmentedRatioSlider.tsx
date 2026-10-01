import React, { useState } from 'react';
import { ShiftType } from '../types';
import { ShiftBadge } from './ShiftBadge';

interface SegmentedRatioSliderProps {
  shiftTypes: ShiftType[];
  ratios: Record<string, number>;
  defaultRatios: Record<string, number>;
  onChange: (newRatios: Record<string, number>) => void;
  lang: 'sv' | 'en';
}

const TYPE_COLORS: Record<string, string> = {
  emerald: '#10b981',
  amber: '#f59e0b',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  rose: '#f43f5e',
  indigo: '#6366f1',
};

export const SegmentedRatioSlider: React.FC<SegmentedRatioSliderProps> = ({
  shiftTypes,
  ratios,
  defaultRatios,
  onChange,
  lang,
}) => {
  const [localInputs, setLocalInputs] = useState<Record<string, string>>({});

  if (shiftTypes.length === 0) return null;

  if (shiftTypes.length === 1) {
    const st = shiftTypes[0];
    return (
      <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 text-xs sm:text-sm text-stone-600 dark:text-stone-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShiftBadge shiftType={st} size="md" />
          <span className="text-xs text-stone-500 dark:text-stone-400">
            ({st.weight || 1.0} {lang === 'sv' ? 'poäng/pass' : 'pts/shift'})
          </span>
          <span>{lang === 'sv' ? 'Enda aktiva passtyp' : 'Only active shift type'}</span>
        </div>
        <span className="font-bold text-stone-900 dark:text-stone-100">100%</span>
      </div>
    );
  }

  // Adjust percentage for a specific shift type
  const handleSetRatio = (typeId: string, rawVal: number) => {
    const targetVal = Math.max(0, Math.min(100, isNaN(rawVal) ? 0 : rawVal));

    if (shiftTypes.length === 2) {
      const otherType = shiftTypes.find(t => t.id !== typeId);
      if (otherType) {
        onChange({
          ...ratios,
          [typeId]: targetVal,
          [otherType.id]: 100 - targetVal,
        });
      }
      return;
    }

    // 3 or more shift types: proportional rebalancing of remaining percentage
    const otherTypes = shiftTypes.filter(st => st.id !== typeId);
    const otherSum = otherTypes.reduce((sum, st) => sum + (ratios[st.id] ?? defaultRatios[st.id] ?? 0), 0);
    const remaining = 100 - targetVal;

    const newR: Record<string, number> = { ...ratios, [typeId]: targetVal };
    if (otherSum === 0) {
      const even = Math.floor(remaining / otherTypes.length);
      otherTypes.forEach((st, idx) => {
        newR[st.id] = idx === otherTypes.length - 1 ? remaining - even * (otherTypes.length - 1) : even;
      });
    } else {
      let allocated = 0;
      otherTypes.forEach((st, idx) => {
        if (idx === otherTypes.length - 1) {
          newR[st.id] = Math.max(0, remaining - allocated);
        } else {
          const share = Math.round(((ratios[st.id] ?? defaultRatios[st.id] ?? 0) / otherSum) * remaining);
          newR[st.id] = share;
          allocated += share;
        }
      });
    }
    onChange(newR);
  };

  const handleStep = (typeId: string, delta: number) => {
    const current = ratios[typeId] ?? defaultRatios[typeId] ?? 0;
    setLocalInputs({});
    handleSetRatio(typeId, current + delta);
  };

  return (
    <div className="space-y-4 pt-1">
      {/* Visual Solid Segmented Bar - NO Gradients, Solid distinct color per pass */}
      <div className="h-5 sm:h-6 rounded-xl overflow-hidden flex w-full border border-stone-200 dark:border-stone-700 shadow-2xs bg-stone-100 dark:bg-stone-800">
        {shiftTypes.map(st => {
          const pct = ratios[st.id] ?? defaultRatios[st.id] ?? 0;
          const solidColor = TYPE_COLORS[st.color] || '#10b981';
          return (
            <div
              key={st.id}
              className="h-full flex items-center justify-center text-[10px] sm:text-xs font-bold text-white transition-all duration-150 relative overflow-hidden"
              style={{
                width: `${pct}%`,
                backgroundColor: solidColor,
              }}
            >
              {pct >= 8 && <span>{pct}%</span>}
            </div>
          );
        })}
      </div>

      {/* Reglage under linjen: Cards with Shift Info, [-] / [+] Steppers and Direct % input */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shiftTypes.map(st => {
          const pct = ratios[st.id] ?? defaultRatios[st.id] ?? 0;
          const solidColor = TYPE_COLORS[st.color] || '#10b981';
          const displayVal = localInputs[st.id] !== undefined ? localInputs[st.id] : String(pct);

          return (
            <div
              key={st.id}
              className="p-3 bg-stone-50 dark:bg-stone-800/90 rounded-xl border border-stone-200 dark:border-stone-700 flex items-center justify-between gap-2 shadow-2xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs"
                  style={{ backgroundColor: solidColor }}
                />
                <div className="min-w-0">
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate block">
                    {st.name}
                  </span>
                  <span className="text-[10px] text-stone-500 dark:text-stone-400 block truncate" title={`1 pass = ${st.weight || 1.0} poäng`}>
                    {st.weight || 1.0} {lang === 'sv' ? 'poäng/pass' : 'pts/shift'}
                  </span>
                </div>
              </div>

              {/* Stepper with [-], number input, and [+] */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleStep(st.id, -5)}
                  disabled={pct <= 0}
                  className="w-7 h-7 rounded-lg bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 font-extrabold text-stone-700 dark:text-stone-200 text-sm flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  -
                </button>
                <div className="flex items-center bg-white dark:bg-stone-900 rounded-lg border border-stone-300 dark:border-stone-700 px-1 py-0.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={displayVal}
                    onChange={e => {
                      const valStr = e.target.value;
                      setLocalInputs(prev => ({ ...prev, [st.id]: valStr }));
                      if (valStr === '') {
                        handleSetRatio(st.id, 0);
                      } else {
                        const parsed = parseInt(valStr, 10);
                        handleSetRatio(st.id, parsed);
                      }
                    }}
                    onBlur={() => {
                      setLocalInputs({});
                    }}
                    className="w-10 text-center text-xs font-bold text-stone-900 dark:text-stone-100 bg-transparent focus:outline-hidden"
                  />
                  <span className="text-xs font-bold text-stone-500 pr-0.5">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleStep(st.id, 5)}
                  disabled={pct >= 100}
                  className="w-7 h-7 rounded-lg bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 font-extrabold text-stone-700 dark:text-stone-200 text-sm flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer with Reset Button and Explanatory text */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-xs">
        <button
          type="button"
          onClick={() => {
            setLocalInputs({});
            onChange({ ...defaultRatios });
          }}
          className="text-emerald-700 dark:text-emerald-400 hover:underline font-semibold cursor-pointer text-left"
        >
          {lang === 'sv' ? 'Återställ till förskolans naturliga fördelning' : 'Reset to natural preschool ratio'}
        </button>

        <span className="text-stone-500 dark:text-stone-400 text-[11px] max-w-sm text-left">
          {lang === 'sv'
            ? 'Poängen visar förhållandet mellan olika pass. Alla familjer får sedan samma mängd poäng i pass.'
            : 'Points reflect the relative workload between duties. All families receive an equal total points score.'}
        </span>
      </div>
    </div>
  );
};
