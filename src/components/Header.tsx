import React, { useState } from 'react';
import { Calendar, Check, Copy, FolderPlus, Globe, KeyRound, Lock, Moon, Sun, Users } from 'lucide-react';
import { Language, translations } from '../translations';
import { TermStatus } from '../types';

interface HeaderProps {
  lang: Language;
  onLanguageChange: (lang: Language) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  isAdmin: boolean;
  onToggleAdmin: (admin: boolean) => void;
  status: TermStatus;
  termName: string;
  onOpenChangePin?: () => void;
  onOpenNewTerm?: () => void;
  /** True once the admin has entered the PIN; admin-only buttons stay hidden until then. */
  isAdminAuthenticated?: boolean;
  /** The term currently shown, used by "Kopiera länk" when the URL has no ?term= */
  currentTermId?: string;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  onLanguageChange,
  theme,
  onToggleTheme,
  isAdmin,
  onToggleAdmin,
  termName,
  onOpenChangePin,
  onOpenNewTerm,
  isAdminAuthenticated = false,
  currentTermId,
}) => {
  const t = translations[lang];
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const hash = window.location.hash;
    const hashQuery = hash.includes('?') ? hash.substring(hash.indexOf('?')) : '';
    const hashParams = new URLSearchParams(hashQuery);
    const searchParams = new URLSearchParams(window.location.search);
    const term = hashParams.get('term') || searchParams.get('term') || currentTermId || '';
    const query = term ? `?term=${encodeURIComponent(term)}` : '';
    const url = `${origin}${pathname}#/${query}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <header className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 sticky top-0 z-30 shadow-xs transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2.5 sm:py-0 sm:min-h-16 gap-2.5 sm:gap-4">
          {/* Logo & Term Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-xl bg-linear-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-xs shrink-0">
              <Calendar className="w-4 h-4 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-bold text-stone-900 dark:text-stone-100 tracking-tight truncate">
                {t.app.title}
              </h1>
              <p className="text-[11px] sm:text-xs text-stone-500 dark:text-stone-400 font-medium truncate">
                {isAdmin ? t.app.subtitle : (termName || t.app.subtitle)}
              </p>
            </div>
          </div>

          {/* Action buttons in Toolbar */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-start sm:justify-end">
            {/* Create new term button (visible in Header when Admin is logged in) */}
            {isAdmin && isAdminAuthenticated && onOpenNewTerm && (
              <button
                onClick={onOpenNewTerm}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer"
                title={t.app.newTerm}
              >
                <FolderPlus className="w-3.5 h-3.5 text-stone-600 dark:text-stone-300 shrink-0" />
                <span>{t.app.newTerm}</span>
              </button>
            )}

            {/* Share link button (only visible in parent view; admin view has its dedicated share button in subheader) */}
            {!isAdmin && (
              <button
                onClick={handleCopyLink}
                title={t.app.copyLink}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-emerald-700 dark:text-emerald-300 font-bold">{t.app.linkCopied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400 shrink-0" />
                    <span>{t.app.copyLink}</span>
                  </>
                )}
              </button>
            )}

            {/* Change PIN button (only visible when in admin mode) */}
            {isAdmin && isAdminAuthenticated && onOpenChangePin && (
              <button
                onClick={onOpenChangePin}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/70 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-300 dark:border-amber-800 transition-colors cursor-pointer"
                title={t.admin.changePin}
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>{t.admin.changePin}</span>
              </button>
            )}

            {/* Dark mode toggle (icon-only by design) */}
            <button
              onClick={onToggleTheme}
              className="p-1.5 text-xs font-semibold rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer"
              title={t.app.themeToggle}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-stone-600" />
              )}
            </button>

            {/* Language switcher */}
            <button
              onClick={() => onLanguageChange(lang === 'sv' ? 'en' : 'sv')}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-lg text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer"
              title={t.app.switchLanguage}
            >
              <Globe className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <span>{lang === 'sv' ? 'SV' : 'EN'}</span>
            </button>

            {/* Admin Switch / Logout / Switch to parent */}
            {isAdmin ? (
              <button
                onClick={() => onToggleAdmin(false)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors cursor-pointer"
                title={t.app.switchToParent}
              >
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span>{t.app.switchToParent}</span>
              </button>
            ) : (
              <button
                onClick={() => onToggleAdmin(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-white text-white dark:text-stone-900 shadow-xs transition-colors cursor-pointer"
                title={t.app.switchToAdmin}
              >
                <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300 dark:text-amber-600 shrink-0" />
                <span>{t.app.switchToAdmin}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
