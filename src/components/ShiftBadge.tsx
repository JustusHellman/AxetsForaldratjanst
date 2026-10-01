import React from 'react';
import { themeTokens } from '../theme';
import { ShiftType } from '../types';

interface ShiftBadgeProps {
  shiftType?: ShiftType;
  fallbackName?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const ShiftBadge: React.FC<ShiftBadgeProps> = ({
  shiftType,
  fallbackName = 'Pass',
  size = 'md',
  className = '',
}) => {
  const colorKey = (shiftType?.color || 'emerald') as keyof typeof themeTokens.shiftColors;
  const token = themeTokens.shiftColors[colorKey] || themeTokens.shiftColors.emerald;
  const name = shiftType?.name || fallbackName;

  const sizeClasses = {
    sm: 'text-[11px] px-1.5 py-0.5 gap-1',
    md: 'text-xs sm:text-sm px-2.5 py-1 gap-1.5',
    lg: 'text-xs sm:text-sm md:text-base px-3 py-1.5 gap-2',
  }[size];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-md border ${token.light.bg} ${token.light.text} ${token.light.border} ${token.dark.bg} ${token.dark.text} ${token.dark.border} ${sizeClasses} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${token.light.dot} ${token.dark.dot}`} />
      <span className="truncate">{name}</span>
    </span>
  );
};
