import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Download, Film, HelpCircle, Loader2, Play, Search, Settings, Star, X } from 'lucide-react';
import { CatalogBrowser } from './components/CatalogBrowser';
import { CommandSearch } from './components/CommandSearch';
import { ContinueWatchingRow } from './components/ContinueWatchingRow';
import { DetailsModal } from './components/DetailsModal';
import { DownloadsView } from './components/DownloadsView';
import { HeroSection } from './components/HeroSection';
import { MediaCard } from './components/MediaCard';
import { MediaRow } from './components/MediaRow';
import { Navigation, type NavTab } from './components/Navigation';
import { OnboardingGuide } from './components/OnboardingGuide';
import { SettingsModal } from './components/SettingsModal';
import { VideoPlayer } from './components/VideoPlayer';
import { useIsDesktop } from './hooks/useIsDesktop';
import {
  deleteDownloadJob,
  fetchDownloads,
  pauseDownloadJob,
  resumeDownloadJob,
  startDownloadJob,
  type DownloadItem,
  type StartDownloadPayload,
} from './services/playerApi';
import {
  getMediaKey,
  usePlayHubStorage,
  type WatchHistoryEntry,
} from './services/storage';
import {
  discoverMedia,
  getActiveTmdbKey,
  getMediaDetails,
  getPopularMovies,
  getPopularTv,
  getTrending,
  setTmdbLanguage,
  type DiscoverSortBy,
} from './services/tmdb';
import {
  checkForAppUpdate,
  FALLBACK_APP_VERSION,
  getCurrentAppVersion,
  installAppUpdate,
  type AppUpdate,
  type UpdateDownloadProgress,
} from './services/updater';
import type { MediaItem, MediaType, PlayRequest } from './types/media';
import { installExternalLinkInterceptor, isTauriRuntime } from './utils/externalLink';
import { resolveLanguageConfig } from './utils/locale';

interface ActivePlayerSession {
  item: MediaItem;
  req: PlayRequest;
  initialTimeSeconds?: number;
  initialProgressPercent?: number;
}

function mergeUniqueMedia(...lists: MediaItem[][]): MediaItem[] {
  const map = new Map<string, MediaItem>();
  for (const list of lists) {
    for (const item of list) {
      const key = getMediaKey(item);
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
  }
  return Array.from(map.values());
}

export default function App() {
  const isDesktop = useIsDesktop(768);
  const {
    tmdbApiKey,
    setTmdbApiKey,
    configHydrated,
    ratings,
    setRating,
    watchlist,
    toggleWatchlist,
    watchHistory,
    recordWatch,
    removeFromHistory,
    addons,
    addAddon,
    installDirectoryAddon,
    removeAddon,
    addonListUrls,
    addAddonListUrl,
    removeAddonListUrl,
    syncAddonListsNow,
    preferences,
    setTheme,
    setLanguage,
    setDownloadDir,
    updatePlaybackPreference,
    updateSourcePreference,
    exportBackupJson,
    importBackupJson,
  } = usePlayHubStorage();

  const languageConfig = useMemo(
    () => resolveLanguageConfig(preferences.language),
    [preferences.language]
  );

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [movieInitialSort, setMovieInitialSort] = useState<DiscoverSortBy>('popularity.desc');
  const [tvInitialSort, setTvInitialSort] = useState<DiscoverSortBy>('popularity.desc');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const autoOpenedGuideRef = useRef(false);

  const [trending, setTrending] = useState<MediaItem[]>([]);
  const [popularMovies, setPopularMovies] = useState<MediaItem[]>([]);
  const [popularTv, setPopularTv] = useState<MediaItem[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<MediaItem[]>([]);
  const [newReleases, setNewReleases] = useState<MediaItem[]>([]);
  const [ratedExtras, setRatedExtras] = useState<Record<string, MediaItem>>({});

  const [loading, setLoading] = useState(true);
  const [attemptedRatedKeys, setAttemptedRatedKeys] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);
  const [catalogReloadSeq, setCatalogReloadSeq] = useState(0);

  const handleSaveTmdbKey = useCallback(
    (key: string) => {
      setTmdbApiKey(key);
      if (key.trim()) {
        setError(null);
        setCatalogReloadSeq((seq) => seq + 1);
      }
    },
    [setTmdbApiKey]
  );

  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [activeSession, setActiveSession] = useState<ActivePlayerSession | null>(null);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [resolvedDownloadDir, setResolvedDownloadDir] = useState('');

  // Auto-updater nativo (Tauri v2)
  const [appVersion, setAppVersion] = useState<string>(FALLBACK_APP_VERSION);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null);
  const [updateToastDismissed, setUpdateToastDismissed] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(null);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentAppVersion().then((v) => {
      if (active) setAppVersion(v);
    });
    return () => {
      active = false;
    };
  }, []);

  // Checagem silenciosa de atualização 4 segundos após abrir o app Desktop
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void checkForAppUpdate()
        .then((update) => {
          if (!active || !update) return;
          setAvailableUpdate(update);
          setUpdateToastDismissed(false);
          setUpdateStatusText(`Nova versão v${update.version} disponível.`);
        })
        .catch(() => {
          // Checagem silenciosa não exibe erro no boot
        });
    }, 4000);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const handleCheckForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) {
      setUpdateStatusText('Atualizações automáticas estão disponíveis no app Desktop Windows.');
      return;
    }
    if (checkingUpdate || installingUpdate) return;
    setCheckingUpdate(true);
    setUpdateStatusText(null);
    try {
      const update = await checkForAppUpdate();
      if (update) {
        setAvailableUpdate(update);
        setUpdateToastDismissed(false);
        setUpdateStatusText(`Nova versão v${update.version} disponível.`);
      } else {
        setAvailableUpdate(null);
        setUpdateStatusText(`Você já está na versão mais recente (v${appVersion}).`);
      }
    } catch {
      setUpdateStatusText('Não foi possível verificar atualizações agora.');
    } finally {
      setCheckingUpdate(false);
    }
  }, [appVersion, checkingUpdate, installingUpdate]);

  const handleInstallUpdate = useCallback(async () => {
    if (!availableUpdate || installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateProgress({ downloaded: 0, contentLength: null, percent: 0 });
    setUpdateStatusText(`Baixando v${availableUpdate.version}...`);
    try {
      await installAppUpdate(availableUpdate, (progress) => {
        setUpdateProgress(progress);
        if (progress.percent === 100) {
          setUpdateStatusText('Instalando atualização e reiniciando...');
        }
      });
    } catch {
      setInstallingUpdate(false);
      setUpdateProgress(null);
      setUpdateStatusText('Falha ao baixar ou instalar a atualização. Tente novamente.');
    }
  }, [availableUpdate, installingUpdate]);

  const refreshDownloads = useCallback(async () => {
    try {
      const data = await fetchDownloads();
      setDownloads(data.downloads);
      if (data.downloadDir) setResolvedDownloadDir(data.downloadDir);
    } catch {
      // Backend local pode estar offline
    }
  }, []);

  const activeDownloadsCount = useMemo(
    () =>
      downloads.filter((d) => d.status === 'downloading' || d.status === 'queued').length,
    [downloads]
  );

  // Carrega lista inicial de downloads ao abrir o app
  useEffect(() => {
    void refreshDownloads();
  }, [refreshDownloads]);

  // Polling leve a cada 2s apenas quando há downloads ativos ou a aba Downloads está aberta
  useEffect(() => {
    if (activeTab !== 'downloads' && activeDownloadsCount === 0) return;
    void refreshDownloads();
    const timer = window.setInterval(() => {
      void refreshDownloads();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeTab, activeDownloadsCount, refreshDownloads]);

  const handleStartDownload = useCallback(
    async (payload: StartDownloadPayload) => {
      await startDownloadJob(payload);
      await refreshDownloads();
    },
    [refreshDownloads]
  );

  const handlePauseDownload = useCallback(
    (id: string) => {
      void pauseDownloadJob(id).then(() => refreshDownloads());
    },
    [refreshDownloads]
  );

  const handleResumeDownload = useCallback(
    (id: string) => {
      void resumeDownloadJob(id).then(() => refreshDownloads());
    },
    [refreshDownloads]
  );

  const handleDeleteDownload = useCallback(
    (id: string, deleteFiles: boolean) => {
      void deleteDownloadJob(id, deleteFiles).then(() => refreshDownloads());
    },
    [refreshDownloads]
  );

  const handlePlayOffline = useCallback((dl: DownloadItem) => {
    const mediaItem: MediaItem = {
      id: dl.tmdbId,
      media_type: dl.mediaType,
      title: dl.mediaType === 'movie' ? dl.title : undefined,
      name: dl.mediaType === 'tv' ? dl.title : undefined,
      overview: '',
      poster_path: dl.posterPath,
      backdrop_path: dl.backdropPath,
      vote_average: 0,
      vote_count: 0,
    };
    setSelected(null);
    setActiveSession({
      item: mediaItem,
      req: {
        tmdbId: dl.tmdbId,
        imdbId: dl.imdbId,
        type: dl.mediaType,
        title: dl.title,
        ...(dl.mediaType === 'tv' ? { season: dl.season ?? 1, episode: dl.episode ?? 1 } : {}),
        offlineDownloadId: dl.id,
        offlineHasSubtitle: Boolean(dl.subtitlePath),
        offlineFileName: dl.fileName,
      },
    });
  }, []);

  // Interceptador global: abre links externos http(s) no navegador padrão do sistema (Tauri / Web)
  useEffect(() => installExternalLinkInterceptor(), []);

  // Atalho global Ctrl+K / Cmd+K para abrir a busca Spotlight (desabilitado com o player aberto)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeSession) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSession]);

  // Abre o Onboarding automaticamente no Passo 1 se nenhuma chave TMDB estiver ativa após hidratar /api/config
  useEffect(() => {
    if (!configHydrated || autoOpenedGuideRef.current) return;
    autoOpenedGuideRef.current = true;
    if (!getActiveTmdbKey()) {
      const timer = window.setTimeout(() => setGuideOpen(true), 120);
      return () => window.clearTimeout(timer);
    }
  }, [configHydrated]);

  // Carregamento dos trilhos editoriais da Home no idioma configurado (recarrega automaticamente ao salvar chave TMDB)
  useEffect(() => {
    let active = true;
    setTmdbLanguage(languageConfig.tmdbLang);
    setError(null);
    setLoading(true);

    Promise.all([
      getTrending('all'),
      getPopularMovies(),
      getPopularTv(),
      discoverMedia({
        type: 'movie',
        page: 1,
        sortBy: 'vote_average.desc',
        lang: languageConfig.tmdbLang,
      }),
      discoverMedia({
        type: 'movie',
        page: 1,
        sortBy: 'primary_release_date.desc',
        lang: languageConfig.tmdbLang,
      }),
    ])
      .then(([allTrending, popMovies, popTv, topRatedRes, newRelRes]) => {
        if (!active) return;
        setTrending(allTrending);
        setPopularMovies(popMovies);
        setPopularTv(popTv);
        setTopRatedMovies(topRatedRes.results);
        setNewReleases(newRelRes.results);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(
          err.message === 'MISSING_API_KEY'
            ? 'Nenhuma chave do TMDB configurada. Abra o Tutorial ou Configurações para conectar sua chave gratuita.'
            : 'Não foi possível carregar o catálogo.'
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [languageConfig.tmdbLang, tmdbApiKey, catalogReloadSeq]);

  const addonUrls = useMemo(() => addons.map((a) => a.url), [addons]);

  const watchlistKeys = useMemo(
    () => new Set(watchlist.map((item) => getMediaKey(item))),
    [watchlist]
  );

  // Índice em memória de todos os itens carregados (para resolver itens avaliados)
  const knownItemsMap = useMemo(() => {
    const map = new Map<string, MediaItem>();
    const all = mergeUniqueMedia(
      trending,
      popularMovies,
      popularTv,
      topRatedMovies,
      newReleases,
      watchlist,
      watchHistory.map((h) => h.item),
      Object.values(ratedExtras)
    );
    for (const item of all) {
      map.set(getMediaKey(item), item);
    }
    return map;
  }, [
    trending,
    popularMovies,
    popularTv,
    topRatedMovies,
    newReleases,
    watchlist,
    watchHistory,
    ratedExtras,
  ]);

  const ratedEntries = useMemo(
    () =>
      Object.entries(ratings)
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1]),
    [ratings]
  );

  const missingRatedKeys = useMemo(
    () =>
      ratedEntries
        .map(([key]) => key)
        .filter((key) => !knownItemsMap.has(key) && !attemptedRatedKeys[key]),
    [ratedEntries, knownItemsMap, attemptedRatedKeys]
  );

  const loadingRated = activeTab === 'rated' && missingRatedKeys.length > 0;

  // Resolve títulos avaliados que não vieram nos trilhos iniciais
  useEffect(() => {
    if (activeTab !== 'rated' || missingRatedKeys.length === 0) return;

    let active = true;

    Promise.allSettled(
      missingRatedKeys.map(async (key) => {
        const [rawType, rawId] = key.split('-');
        const type = rawType as MediaType;
        const id = Number(rawId);
        if ((type !== 'movie' && type !== 'tv') || Number.isNaN(id)) return null;
        const details = await getMediaDetails(type, id);
        return { key, item: details as MediaItem };
      })
    ).then((results) => {
      if (!active) return;
      const fetched: Record<string, MediaItem> = {};
      const attempted: Record<string, true> = {};
      for (const key of missingRatedKeys) {
        attempted[key] = true;
      }
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value) {
          fetched[res.value.key] = res.value.item;
        }
      }
      setAttemptedRatedKeys((prev) => ({ ...prev, ...attempted }));
      if (Object.keys(fetched).length > 0) {
        setRatedExtras((prev) => ({ ...prev, ...fetched }));
      }
    });

    return () => {
      active = false;
    };
  }, [activeTab, missingRatedKeys]);

  const handleSelectItem = useCallback((item: MediaItem) => {
    const key = getMediaKey(item);
    setRatedExtras((prev) => (prev[key] ? prev : { ...prev, [key]: item }));
    setSelected(item);
  }, []);

  const handlePlay = useCallback(
    (item: MediaItem, req: PlayRequest) => {
      const key = getMediaKey(item);
      const existing = watchHistory.find((entry) => entry.key === key);
      const sameEpisode =
        item.media_type !== 'tv' ||
        (existing?.season === req.season && existing?.episode === req.episode);

      setSelected(null);
      setActiveSession({
        item,
        req,
        ...(sameEpisode && existing
          ? {
              initialTimeSeconds: existing.currentTimeSeconds,
              initialProgressPercent: existing.progressPercent,
            }
          : {}),
      });
    },
    [watchHistory]
  );

  const handleResumeHistory = useCallback(
    (entry: WatchHistoryEntry, req: PlayRequest) => {
      setSelected(null);
      setActiveSession({
        item: entry.item,
        req,
        initialTimeSeconds: entry.currentTimeSeconds,
        initialProgressPercent: entry.progressPercent,
      });
    },
    []
  );

  const handleSaveProgress = useCallback(
    (
      item: MediaItem,
      req: PlayRequest,
      progressPercent: number,
      currentTime: number,
      duration: number
    ) => {
      recordWatch(item, req, progressPercent, currentTime, duration);
    },
    [recordWatch]
  );

  const handleNextEpisode = useCallback(() => {
    setActiveSession((prev) => {
      if (!prev || prev.req.type !== 'tv') return prev;
      const nextEp = (prev.req.episode ?? 1) + 1;
      const nextReq: PlayRequest = {
        ...prev.req,
        season: prev.req.season ?? 1,
        episode: nextEp,
      };
      return {
        item: prev.item,
        req: nextReq,
        initialTimeSeconds: 0,
        initialProgressPercent: 0,
      };
    });
  }, []);

  const handleTabChange = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openFilteredCatalog = useCallback(
    (type: MediaType, sortBy: DiscoverSortBy) => {
      if (type === 'movie') {
        setMovieInitialSort(sortBy);
        handleTabChange('movie');
      } else {
        setTvInitialSort(sortBy);
        handleTabChange('tv');
      }
    },
    [handleTabChange]
  );

  const heroItems = useMemo(() => {
    const withBackdrop = trending.filter((item) => Boolean(item.backdrop_path));
    return (withBackdrop.length > 0 ? withBackdrop : trending).slice(0, 5);
  }, [trending]);

  const ratedGrid = useMemo(() => {
    const list: MediaItem[] = [];
    for (const [key] of ratedEntries) {
      const found = knownItemsMap.get(key);
      if (found) list.push(found);
    }
    return list;
  }, [ratedEntries, knownItemsMap]);

  return (
    <div className="min-h-screen bg-[var(--ph-bg)] text-[var(--ph-text)]">
      {/* Navegação responsiva: Sidebar Desktop + Dock Mobile */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={handleTabChange}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        watchlistCount={watchlist.length}
        ratedCount={ratedEntries.length}
        activeDownloadsCount={activeDownloadsCount}
      />

      {/* Área principal */}
      <motion.main
        initial={false}
        animate={{ paddingLeft: isDesktop ? (sidebarCollapsed ? 76 : 228) : 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        className="min-h-screen pb-28 md:pb-16"
      >
        {/* Topbar minimalista no Mobile (logo + busca + configurações) */}
        {!isDesktop && (
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--ph-border)] bg-[var(--ph-topbar)] px-5 py-3.5 pt-[calc(var(--safe-top)+12px)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => handleTabChange('home')}
              className="flex items-center gap-2.5"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ph-btn-primary-bg)] text-[var(--ph-btn-primary-fg)]">
                <Play className="h-3 w-3 translate-x-[0.5px] fill-current" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-[var(--ph-text)]">
                PlayHub
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Abrir busca"
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                aria-label="Abrir tutorial"
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Abrir configurações"
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </header>
        )}

        {/* Erro global */}
        {error && (
          <div className="px-5 pt-8 sm:px-10 lg:px-14">
            <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] p-6 text-sm text-[var(--ph-text-muted)]">
              <p className="font-medium text-[var(--ph-text)]">Não foi possível carregar</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Transição animada entre abas */}
        <AnimatePresence mode="wait">
          {activeTab === 'home' && (
            <motion.div
              key="tab-home"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {loading ? (
                <div>
                  <div className="h-[66vh] w-full animate-pulse bg-[var(--ph-surface)] sm:h-[74vh]" />
                  <div className="mt-10 space-y-10 px-5 sm:px-10 lg:px-14">
                    {[0, 1].map((row) => (
                      <div key={row}>
                        <div className="mb-4 h-5 w-40 animate-pulse rounded-md bg-[var(--ph-surface-2)]" />
                        <div className="flex gap-4 overflow-hidden">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div
                              key={i}
                              className="aspect-[2/3] w-[144px] shrink-0 animate-pulse rounded-xl bg-[var(--ph-surface)] ring-1 ring-[var(--ph-border)] sm:w-[168px] lg:w-[184px]"
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {heroItems.length > 0 && (
                    <HeroSection
                      items={heroItems}
                      onOpenDetails={handleSelectItem}
                      onPlay={handlePlay}
                    />
                  )}

                  <div className="relative z-10 -mt-4 space-y-11 sm:space-y-12">
                    {/* Continuar Assistindo (somente se houver histórico) */}
                    <ContinueWatchingRow
                      entries={watchHistory}
                      onResume={handleResumeHistory}
                      onOpenDetails={handleSelectItem}
                      onRemove={removeFromHistory}
                    />

                    <MediaRow
                      title="Em Alta"
                      items={trending}
                      ratings={ratings}
                      watchlistKeys={watchlistKeys}
                      onToggleWatchlist={toggleWatchlist}
                      onSelect={handleSelectItem}
                      onViewAll={() => openFilteredCatalog('movie', 'popularity.desc')}
                    />

                    <MediaRow
                      title="Filmes Populares"
                      items={popularMovies}
                      ratings={ratings}
                      watchlistKeys={watchlistKeys}
                      onToggleWatchlist={toggleWatchlist}
                      onSelect={handleSelectItem}
                      onViewAll={() => openFilteredCatalog('movie', 'popularity.desc')}
                    />

                    <MediaRow
                      title="Séries em Destaque"
                      items={popularTv}
                      ratings={ratings}
                      watchlistKeys={watchlistKeys}
                      onToggleWatchlist={toggleWatchlist}
                      onSelect={handleSelectItem}
                      onViewAll={() => openFilteredCatalog('tv', 'popularity.desc')}
                    />

                    <MediaRow
                      title="Mais Bem Avaliados"
                      items={topRatedMovies}
                      ratings={ratings}
                      watchlistKeys={watchlistKeys}
                      onToggleWatchlist={toggleWatchlist}
                      onSelect={handleSelectItem}
                      onViewAll={() => openFilteredCatalog('movie', 'vote_average.desc')}
                    />

                    <MediaRow
                      title="Lançamentos"
                      items={newReleases}
                      ratings={ratings}
                      watchlistKeys={watchlistKeys}
                      onToggleWatchlist={toggleWatchlist}
                      onSelect={handleSelectItem}
                      onViewAll={() => openFilteredCatalog('movie', 'primary_release_date.desc')}
                    />
                  </div>
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'movie' && (
            <CatalogBrowser
              key={`tab-movie-${movieInitialSort}-${languageConfig.tmdbLang}`}
              type="movie"
              title="Filmes"
              tmdbLang={languageConfig.tmdbLang}
              initialSortBy={movieInitialSort}
              ratings={ratings}
              watchlistKeys={watchlistKeys}
              onToggleWatchlist={toggleWatchlist}
              onSelect={handleSelectItem}
            />
          )}

          {activeTab === 'tv' && (
            <CatalogBrowser
              key={`tab-tv-${tvInitialSort}-${languageConfig.tmdbLang}`}
              type="tv"
              title="Séries"
              tmdbLang={languageConfig.tmdbLang}
              initialSortBy={tvInitialSort}
              ratings={ratings}
              watchlistKeys={watchlistKeys}
              onToggleWatchlist={toggleWatchlist}
              onSelect={handleSelectItem}
            />
          )}

          {activeTab === 'watchlist' && (
            <motion.section
              key="tab-watchlist"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="px-5 pt-8 sm:px-10 sm:pt-12 lg:px-14"
            >
              <SectionHeader eyebrow="Sua coleção" title="Minha Lista" count={watchlist.length} />

              {watchlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-6 py-20 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)]">
                    <Bookmark className="h-5 w-5 text-[var(--ph-text)]" />
                  </div>
                  <h2 className="mt-4 text-base font-medium text-[var(--ph-text)]">
                    Sua lista está vazia
                  </h2>
                  <p className="mt-1.5 max-w-sm text-sm text-[var(--ph-text-muted)]">
                    Salve filmes e séries para assistir depois clicando no ícone de marcador nos cards ou nos detalhes.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleTabChange('home')}
                    className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--ph-btn-primary-bg)] px-5 text-sm font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
                  >
                    <Film className="h-4 w-4" />
                    Voltar ao catálogo
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {watchlist.map((item, idx) => {
                    const key = getMediaKey(item);
                    return (
                      <MediaCard
                        key={key}
                        item={item}
                        index={idx}
                        userRating={ratings[key]}
                        inWatchlist
                        onToggleWatchlist={toggleWatchlist}
                        onSelect={handleSelectItem}
                      />
                    );
                  })}
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'rated' && (
            <motion.section
              key="tab-rated"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="px-5 pt-8 sm:px-10 sm:pt-12 lg:px-14"
            >
              <SectionHeader
                eyebrow="Sua coleção"
                title="Avaliados"
                count={ratedEntries.length}
              />

              {loadingRated && ratedGrid.length === 0 ? (
                <GridSkeleton />
              ) : ratedGrid.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-6 py-20 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)]">
                    <Star className="h-5 w-5 text-[#E5A93C]" />
                  </div>
                  <h2 className="mt-4 text-base font-medium text-[var(--ph-text)]">
                    Nenhuma avaliação ainda
                  </h2>
                  <p className="mt-1.5 max-w-sm text-sm text-[var(--ph-text-muted)]">
                    Avalie filmes e séries no painel de detalhes para construir sua lista pessoal.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleTabChange('home')}
                    className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--ph-btn-primary-bg)] px-5 text-sm font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
                  >
                    <Film className="h-4 w-4" />
                    Explorar catálogo
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {ratedGrid.map((item, idx) => {
                    const key = getMediaKey(item);
                    return (
                      <MediaCard
                        key={key}
                        item={item}
                        index={idx}
                        userRating={ratings[key]}
                        inWatchlist={watchlistKeys.has(key)}
                        onToggleWatchlist={toggleWatchlist}
                        onSelect={handleSelectItem}
                      />
                    );
                  })}
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'downloads' && (
            <motion.section
              key="tab-downloads"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="px-5 pt-8 sm:px-10 sm:pt-12 lg:px-14"
            >
              <SectionHeader
                eyebrow="Modo Offline"
                title="Downloads"
                count={downloads.length}
              />

              <DownloadsView
                downloads={downloads}
                downloadDir={preferences.downloadDir || resolvedDownloadDir}
                onPause={handlePauseDownload}
                onResume={handleResumeDownload}
                onDelete={handleDeleteDownload}
                onPlayOffline={handlePlayOffline}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </motion.section>
          )}
        </AnimatePresence>
      </motion.main>

      {/* Busca Spotlight (Ctrl+K) */}
      <CommandSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSelectItem}
      />

      {/* Configurações (TMDB + Tema + Idioma + Reprodução + Fontes/Add-ons + Backup) */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tmdbApiKey={tmdbApiKey}
        onSaveTmdbKey={handleSaveTmdbKey}
        onOpenGuide={() => setGuideOpen(true)}
        preferences={preferences}
        addons={addons}
        addonListUrls={addonListUrls}
        onAddAddon={addAddon}
        onInstallDirectoryAddon={installDirectoryAddon}
        onRemoveAddon={removeAddon}
        onAddAddonListUrl={addAddonListUrl}
        onRemoveAddonListUrl={removeAddonListUrl}
        onSyncAddonLists={syncAddonListsNow}
        onChangeTheme={setTheme}
        onChangeLanguage={setLanguage}
        onChangePlayback={updatePlaybackPreference}
        onChangeSource={updateSourcePreference}
        resolvedDownloadDir={resolvedDownloadDir}
        onChangeDownloadDir={(dir) => {
          setDownloadDir(dir);
          window.setTimeout(() => void refreshDownloads(), 700);
        }}
        onExportBackup={exportBackupJson}
        onImportBackup={importBackupJson}
        appVersion={appVersion}
        availableUpdateVersion={availableUpdate?.version ?? null}
        checkingUpdate={checkingUpdate}
        installingUpdate={installingUpdate}
        updateProgress={updateProgress}
        updateStatusText={updateStatusText}
        onCheckForUpdate={handleCheckForUpdate}
        onInstallUpdate={handleInstallUpdate}
      />

      {/* Painel Cinematográfico de Detalhes */}
      <DetailsModal
        item={selected}
        userRating={selected ? ratings[getMediaKey(selected)] : 0}
        inWatchlist={selected ? watchlistKeys.has(getMediaKey(selected)) : false}
        onToggleWatchlist={toggleWatchlist}
        onRate={setRating}
        onClose={() => setSelected(null)}
        onPlay={handlePlay}
        onSelectRelated={handleSelectItem}
        downloads={downloads}
        addons={addonUrls}
        sourcePreferences={preferences.sources}
        languageConfig={languageConfig}
        onStartDownload={handleStartDownload}
      />

      {/* Tutorial / Onboarding Interativo */}
      <OnboardingGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        tmdbApiKey={tmdbApiKey}
        onSaveTmdbKey={handleSaveTmdbKey}
      />

      {/* Toast Editorial Minimalista de Nova Versão (Tauri Updater) */}
      <AnimatePresence>
        {availableUpdate && !updateToastDismissed && !activeSession && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            role="status"
            aria-live="polite"
            className="fixed bottom-5 right-5 z-40 w-[340px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-[var(--ph-border-strong)] bg-[var(--ph-surface)]/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                  Atualização do PlayHub
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--ph-text)] tabular-nums">
                  Nova versão v{availableUpdate.version} disponível
                </p>
              </div>
              {!installingUpdate && (
                <button
                  type="button"
                  onClick={() => setUpdateToastDismissed(true)}
                  aria-label="Dispensar aviso de atualização"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {installingUpdate ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--ph-text-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ph-text)]" />
                    {updateProgress?.percent === 100
                      ? 'Instalando e reiniciando...'
                      : 'Baixando atualização...'}
                  </span>
                  {updateProgress?.percent !== null && updateProgress?.percent !== undefined && (
                    <span className="font-medium text-[var(--ph-text)] tabular-nums">
                      {updateProgress.percent}%
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ph-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--ph-btn-primary-bg)] transition-all duration-200"
                    style={{ width: `${updateProgress?.percent ?? 15}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleInstallUpdate()}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-3.5 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Atualizar agora</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUpdateToastDismissed(true)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3.5 text-xs font-medium text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                >
                  Depois
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player de Vídeo Editorial em Tela Cheia */}
      <AnimatePresence>
        {activeSession && (
          <VideoPlayer
            key={`${activeSession.req.imdbId}-${activeSession.req.season ?? 0}-${activeSession.req.episode ?? 0}`}
            item={activeSession.item}
            request={activeSession.req}
            addons={addonUrls}
            preferences={preferences.playback}
            sourcePreferences={preferences.sources}
            languageConfig={languageConfig}
            initialTimeSeconds={activeSession.initialTimeSeconds}
            initialProgressPercent={activeSession.initialProgressPercent}
            onClose={() => setActiveSession(null)}
            onOpenSettings={() => {
              setActiveSession(null);
              setSettingsOpen(true);
            }}
            onSaveProgress={handleSaveProgress}
            onChangeSubtitleSize={(size) => updatePlaybackPreference('subtitleSize', size)}
            onStartDownload={handleStartDownload}
            onNextEpisode={
              activeSession.req.type === 'tv' ? handleNextEpisode : undefined
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  count,
}: {
  eyebrow: string;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-8 flex items-end justify-between border-b border-[var(--ph-border)] pb-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ph-text-muted)]">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--ph-text)] sm:text-4xl">
          {title}
        </h1>
      </div>
      <span className="text-xs text-[var(--ph-text-muted)] tabular-nums">
        {count} {count === 1 ? 'título' : 'títulos'}
      </span>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="space-y-2.5">
          <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-[var(--ph-surface)] ring-1 ring-[var(--ph-border)]" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--ph-surface-2)]" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--ph-surface)]" />
        </div>
      ))}
    </div>
  );
}
