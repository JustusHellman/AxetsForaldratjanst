/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  HashRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { AdminView } from './components/AdminView';
import { Header } from './components/Header';
import { ParentView } from './components/ParentView';
import {
  createInitialConfig,
  fetchCoopConfig,
  fetchSchedule,
  fetchTermsIndex,
  fetchWishes,
  saveCoopConfig,
  saveFamilyWish,
  saveSchedule,
} from './dbService';
import { applyTheme, getInitialTheme } from './theme';
import { safeGet } from './safeStorage';
import { migrateWishes } from './migrations';
import {
  getInitialLanguage,
  Language,
  saveLanguagePreference,
  translations,
} from './translations';
import { CoopConfig, CoopScheduleDoc, FamilyWish } from './types';

function AppContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const isAdmin = location.pathname.startsWith('/admin') || searchParams.get('admin') === 'true';

  const [lang, setLang] = useState<Language>(getInitialLanguage);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [loading, setLoading] = useState<boolean>(true);
  // 'ok' | 'error' (load failed) | 'notFound' (unknown/deleted term). While not 'ok',
  // no admin or parent view is rendered, so nothing can be saved over real data.
  const [loadState, setLoadState] = useState<'ok' | 'error' | 'notFound'>('ok');
  const [currentTermId, setCurrentTermId] = useState<string>('main');
  const [showChangePinModal, setShowChangePinModal] = useState<boolean>(false);
  const [adminAuthenticated, setAdminAuthenticated] = useState<boolean>(
    () => safeGet('coop_admin_logged_in', 'sessionStorage') === 'true'
  );
  const [showNewTermModal, setShowNewTermModal] = useState<boolean>(false);

  // Database state
  const [config, setConfig] = useState<CoopConfig>(() => createInitialConfig('main'));
  const [wishes, setWishes] = useState<Record<string, FamilyWish>>({});
  const [scheduleDoc, setScheduleDoc] = useState<CoopScheduleDoc>({
    id: 'main',
    assignments: [],
    metrics: null,
    isFinalized: false,
    updatedAt: new Date().toISOString(),
  });

  const t = translations[lang];

  // Apply theme class on mount and change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    saveLanguagePreference(newLang);
  };

  // Load term data
  const loadTermData = async (termId: string) => {
    setLoading(true);
    try {
      const [loadedConfig, loadedWishes, loadedSchedule] = await Promise.all([
        fetchCoopConfig(termId),
        fetchWishes(termId),
        fetchSchedule(termId),
      ]);

      if (!loadedConfig) {
        setCurrentTermId(termId);
        setLoadState('notFound');
        return;
      }
      setConfig(loadedConfig);
      // Old blocked-shift IDs are mapped to the current shift IDs (see migrations.ts)
      if (loadedWishes?.wishes) setWishes(migrateWishes(loadedWishes.wishes, loadedConfig.shifts || []));
      else setWishes({});
      if (loadedSchedule) setScheduleDoc(loadedSchedule);
      else {
        setScheduleDoc({
          id: termId,
          assignments: [],
          metrics: null,
          isFinalized: false,
          updatedAt: new Date().toISOString(),
        });
      }

      setCurrentTermId(termId);
      setLoadState('ok');
    } catch (err) {
      // Never fall back to demo data here: saving that would overwrite the real term.
      console.error('Failed to load cooperative data:', err);
      setCurrentTermId(termId);
      setLoadState('error');
    } finally {
      setLoading(false);
    }
  };

  // Load initial data and sync with URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const termParam = searchParams.get('term') || urlParams.get('term');

    // Handle legacy search param ?admin=true redirect to /admin route
    if (urlParams.get('admin') === 'true' && !location.pathname.startsWith('/admin')) {
      navigate('/admin' + (termParam ? `?term=${encodeURIComponent(termParam)}` : ''), { replace: true });
    }

    if (termParam) {
      loadTermData(termParam);
    } else {
      fetchTermsIndex(true)
        .then(terms => {
          if (terms && terms.length > 0) {
            const published = terms.find(t => t.status === 'published');
            const collecting = terms.find(t => t.status === 'collecting');
            const selected = published?.id || collecting?.id || terms[terms.length - 1].id || 'main';
            loadTermData(selected);
          } else {
            loadTermData('main');
          }
        })
        .catch(() => {
          loadTermData('main');
        });
    }
  }, [searchParams.get('term')]);

  const handleSwitchTerm = async (termId: string) => {
    if (searchParams.get('term') === termId) {
      await loadTermData(termId);
      return;
    }
    // Changing ?term triggers the load effect above (no second, duplicate load here)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('term', termId);
      return next;
    });
  };

  const handleToggleAdmin = (admin: boolean) => {
    const currentTerm = searchParams.get('term') || currentTermId;
    const termQuery = currentTerm ? `?term=${encodeURIComponent(currentTerm)}` : '';
    if (admin) {
      navigate(`/admin${termQuery}`);
    } else {
      navigate(`/${termQuery}`);
    }
  };

  const handleSaveConfig = async (newConfig: CoopConfig) => {
    setConfig(newConfig);
    try {
      await saveCoopConfig(newConfig);
    } catch (err) {
      console.error('Failed to save config to database:', err);
    }
  };

  const handleSaveWish = async (wish: FamilyWish) => {
    // Let errors reach ParentView so the family sees that the save failed
    await saveFamilyWish(config.id, wish);
    setWishes(prev => ({
      ...prev,
      [wish.familyId]: wish,
    }));
  };

  /** Fresh wishes from the database, used right before generating a schedule. */
  const handleReloadWishes = async (): Promise<Record<string, FamilyWish>> => {
    const doc = await fetchWishes(config.id);
    const fresh = migrateWishes(doc?.wishes || {}, config.shifts || []);
    setWishes(fresh);
    return fresh;
  };

  const handleSaveSchedule = async (newSchedule: CoopScheduleDoc) => {
    setScheduleDoc(newSchedule);
    try {
      await saveSchedule(newSchedule);
    } catch (err) {
      console.error('Failed to save schedule to database:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-100/60 dark:bg-stone-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-stone-600 dark:text-stone-300">
            {t.app.loading}
          </p>
        </div>
      </div>
    );
  }

  const statusScreen =
    loadState === 'ok' ? null : (
      <div className="max-w-md mx-auto px-4 py-12 sm:py-16">
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 sm:p-8 shadow-xs text-center space-y-4">
          <h2 className="text-lg sm:text-xl font-bold text-stone-900 dark:text-stone-100">
            {loadState === 'error' ? t.app.loadErrorTitle : t.app.termNotFoundTitle}
          </h2>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {loadState === 'error' ? t.app.loadErrorDesc : t.app.termNotFoundDesc}
          </p>
          <button
            type="button"
            onClick={() => {
              if (loadState === 'error') {
                loadTermData(currentTermId);
              } else {
                navigate(isAdmin ? '/admin' : '/', { replace: true });
              }
            }}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl cursor-pointer"
          >
            {loadState === 'error' ? t.app.retry : t.app.goToCurrentTerm}
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col font-sans selection:bg-emerald-200 dark:selection:bg-emerald-800 transition-colors">
      {/* Top Header */}
      <Header
        lang={lang}
        onLanguageChange={handleLanguageChange}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        isAdmin={isAdmin}
        onToggleAdmin={handleToggleAdmin}
        status={config.status}
        termName={config.termName}
        onOpenChangePin={() => setShowChangePinModal(true)}
        onOpenNewTerm={() => setShowNewTermModal(true)}
        isAdminAuthenticated={adminAuthenticated}
        currentTermId={currentTermId}
      />

      {/* Main Content Area with HashRouter routes */}
      <main className="flex-1 pb-16 w-full max-w-full overflow-x-hidden">
        {statusScreen ? statusScreen : (
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminView
                config={config}
                wishes={wishes}
                scheduleDoc={scheduleDoc}
                onSaveConfig={handleSaveConfig}
                onSaveSchedule={handleSaveSchedule}
                onReloadWishes={handleReloadWishes}
                onAuthenticated={() => setAdminAuthenticated(true)}
                onSwitchTerm={handleSwitchTerm}
                onSwitchToParentView={() => handleToggleAdmin(false)}
                showChangePinModalExternal={showChangePinModal}
                onCloseChangePinModal={() => setShowChangePinModal(false)}
                showNewTermModalExternal={showNewTermModal}
                onCloseNewTermModal={() => setShowNewTermModal(false)}
                lang={lang}
              />
            }
          />
          <Route
            path="*"
            element={
              isAdmin ? (
                <AdminView
                  config={config}
                  wishes={wishes}
                  scheduleDoc={scheduleDoc}
                  onSaveConfig={handleSaveConfig}
                  onSaveSchedule={handleSaveSchedule}
                  onReloadWishes={handleReloadWishes}
                  onAuthenticated={() => setAdminAuthenticated(true)}
                  onSwitchTerm={handleSwitchTerm}
                  onSwitchToParentView={() => handleToggleAdmin(false)}
                  showChangePinModalExternal={showChangePinModal}
                  onCloseChangePinModal={() => setShowChangePinModal(false)}
                  showNewTermModalExternal={showNewTermModal}
                  onCloseNewTermModal={() => setShowNewTermModal(false)}
                  lang={lang}
                />
              ) : (
                <ParentView
                  config={config}
                  wishes={wishes}
                  onSaveWish={handleSaveWish}
                  lang={lang}
                />
              )
            }
          />
        </Routes>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
