import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaItem, PlayRequest } from '../types/media';
import type { LanguagePreference } from '../utils/locale';
import {
  PLAYER_API_BASE,
  syncRemoteAddonLists,
  type SyncAddonListsResponse,
} from './playerApi';
import { setRuntimeTmdbKey } from './tmdb';

export type ThemeMode = 'dark' | 'light';
export type DefaultPlayerMode = 'embed' | 'native';

export interface PlaybackPreferences {
  defaultPlayerMode: DefaultPlayerMode;
  prioritizePtBrAudio: boolean;
  autoSubtitlesPtBr: boolean;
  experimentalAiDubbing: boolean;
}

export interface SourcePreferences {
  enableBuiltInProviders: boolean;
  torznabUrl: string;
  torznabApiKey: string;
}

export interface UserPreferences {
  theme: ThemeMode;
  language: LanguagePreference;
  playback: PlaybackPreferences;
  sources: SourcePreferences;
}

export interface AddonEntry {
  url: string;
  name?: string;
}

export interface WatchHistoryEntry {
  key: string;
  item: MediaItem;
  imdbId: string;
  season?: number;
  episode?: number;
  progressPercent: number;
  currentTimeSeconds?: number;
  durationSeconds?: number;
  updatedAt: number;
}

export interface PlayHubBackupPayload {
  version: 1;
  exportedAt: string;
  tmdbApiKey?: string;
  addons: AddonEntry[];
  addonListUrls: string[];
  preferences: UserPreferences;
  watchlist: MediaItem[];
  ratings: Record<string, number>;
  watchHistory: WatchHistoryEntry[];
  torznab: { url: string; apiKey: string };
}

const KEYS = {
  tmdbApiKey: 'playhub_tmdb_api_key',
  ratings: 'playhub_ratings',
  watchlist: 'playhub_watchlist',
  watchHistory: 'playhub_watch_history',
  preferences: 'playhub_preferences',
  addons: 'playhub_addons',
  addonLists: 'playhub_addon_lists',
} as const;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  language: 'auto',
  playback: {
    defaultPlayerMode: 'embed',
    prioritizePtBrAudio: true,
    autoSubtitlesPtBr: true,
    experimentalAiDubbing: false,
  },
  sources: {
    enableBuiltInProviders: true,
    torznabUrl: '',
    torznabApiKey: '',
  },
};

export function getMediaKey(item: Pick<MediaItem, 'media_type' | 'id'>): string {
  return `${item.media_type}-${item.id}`;
}

export function normalizeAddonUrl(rawUrl: string): {
  baseUrl: string;
  manifestUrl: string;
} | null {
  const cleaned = rawUrl
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .replace(/\/manifest\.json\/?$/i, '')
    .replace(/\/+$/, '');

  if (!cleaned) return null;

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const baseUrl = parsed.toString().replace(/\/+$/, '');
    return {
      baseUrl,
      manifestUrl: `${baseUrl}/manifest.json`,
    };
  } catch {
    return null;
  }
}

async function fetchManifestName(manifestUrl: string): Promise<{ ok: boolean; name?: string }> {
  const tryFetch = async (url: string): Promise<{ ok: boolean; name?: string }> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as { name?: unknown };
      const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : undefined;
      return { ok: true, name };
    } catch {
      return { ok: false };
    } finally {
      window.clearTimeout(timer);
    }
  };

  const direct = await tryFetch(manifestUrl);
  if (direct.ok) return direct;

  const proxiedUrl = `${PLAYER_API_BASE}/api/proxy?url=${encodeURIComponent(manifestUrl)}`;
  return tryFetch(proxiedUrl);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignora falhas de quota/modo privado
  }
}

export function loadTmdbApiKey(): string {
  try {
    return (localStorage.getItem(KEYS.tmdbApiKey) || '').trim();
  } catch {
    return '';
  }
}

export function saveTmdbApiKey(key: string): void {
  const cleaned = key.trim();
  setRuntimeTmdbKey(cleaned);
  try {
    if (cleaned) {
      localStorage.setItem(KEYS.tmdbApiKey, cleaned);
    } else {
      localStorage.removeItem(KEYS.tmdbApiKey);
    }
  } catch {
    // Ignora falhas de quota
  }
}

export function loadRatings(): Record<string, number> {
  return readJson<Record<string, number>>(KEYS.ratings, {});
}

export function saveRatings(ratings: Record<string, number>): void {
  writeJson(KEYS.ratings, ratings);
}

export function loadWatchlist(): MediaItem[] {
  const data = readJson<MediaItem[]>(KEYS.watchlist, []);
  return Array.isArray(data) ? data : [];
}

export function saveWatchlist(list: MediaItem[]): void {
  writeJson(KEYS.watchlist, list);
}

export function loadWatchHistory(): WatchHistoryEntry[] {
  const data = readJson<WatchHistoryEntry[]>(KEYS.watchHistory, []);
  return Array.isArray(data) ? data : [];
}

export function saveWatchHistory(history: WatchHistoryEntry[]): void {
  writeJson(KEYS.watchHistory, history);
}

function normalizeAddonList(raw: unknown): AddonEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: AddonEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item === 'string') {
      const normalized = normalizeAddonUrl(item);
      if (normalized && !seen.has(normalized.manifestUrl)) {
        seen.add(normalized.manifestUrl);
        result.push({ url: normalized.manifestUrl });
      }
    } else if (item && typeof item === 'object' && 'url' in item) {
      const entry = item as { url?: unknown; name?: unknown };
      if (typeof entry.url !== 'string') continue;
      const normalized = normalizeAddonUrl(entry.url);
      if (normalized && !seen.has(normalized.manifestUrl)) {
        seen.add(normalized.manifestUrl);
        result.push({
          url: normalized.manifestUrl,
          ...(typeof entry.name === 'string' && entry.name.trim()
            ? { name: entry.name.trim() }
            : {}),
        });
      }
    }
  }
  return result;
}

export function loadAddons(): AddonEntry[] {
  return normalizeAddonList(readJson<unknown[]>(KEYS.addons, []));
}

export function saveAddons(addons: AddonEntry[]): void {
  writeJson(KEYS.addons, addons);
}

export function loadAddonListUrls(): string[] {
  const data = readJson<unknown[]>(KEYS.addonLists, []);
  return Array.isArray(data) ? data.filter((u): u is string => typeof u === 'string') : [];
}

export function saveAddonListUrls(urls: string[]): void {
  writeJson(KEYS.addonLists, urls);
}

const VALID_LANG_PREFS: readonly LanguagePreference[] = [
  'auto',
  'pt-BR',
  'en-US',
  'es-ES',
  'fr-FR',
];

function normalizePreferences(
  saved?: Partial<UserPreferences>,
  torznabFallback?: { url?: string; apiKey?: string }
): UserPreferences {
  const language: LanguagePreference =
    saved?.language && VALID_LANG_PREFS.includes(saved.language) ? saved.language : 'auto';

  return {
    theme: saved?.theme === 'light' ? 'light' : 'dark',
    language,
    playback: {
      defaultPlayerMode:
        saved?.playback?.defaultPlayerMode === 'native' ? 'native' : 'embed',
      prioritizePtBrAudio:
        saved?.playback?.prioritizePtBrAudio ?? DEFAULT_PREFERENCES.playback.prioritizePtBrAudio,
      autoSubtitlesPtBr:
        saved?.playback?.autoSubtitlesPtBr ?? DEFAULT_PREFERENCES.playback.autoSubtitlesPtBr,
      experimentalAiDubbing:
        saved?.playback?.experimentalAiDubbing ??
        DEFAULT_PREFERENCES.playback.experimentalAiDubbing,
    },
    sources: {
      enableBuiltInProviders:
        saved?.sources?.enableBuiltInProviders ??
        DEFAULT_PREFERENCES.sources.enableBuiltInProviders,
      torznabUrl:
        typeof saved?.sources?.torznabUrl === 'string'
          ? saved.sources.torznabUrl
          : (torznabFallback?.url ?? ''),
      torznabApiKey:
        typeof saved?.sources?.torznabApiKey === 'string'
          ? saved.sources.torznabApiKey
          : (torznabFallback?.apiKey ?? ''),
    },
  };
}

export function loadPreferences(): UserPreferences {
  return normalizePreferences(readJson<Partial<UserPreferences>>(KEYS.preferences, {}));
}

export function savePreferences(prefs: UserPreferences): void {
  writeJson(KEYS.preferences, prefs);
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.toggle('dark', theme === 'dark');

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#09090B' : '#F8F8F9');
  }
}

interface RemoteStorePayload {
  tmdbApiKey?: string;
  addons?: AddonEntry[];
  addonListUrls?: string[];
  preferences?: Partial<UserPreferences>;
  watchlist?: MediaItem[];
  ratings?: Record<string, number>;
  watchHistory?: WatchHistoryEntry[];
  torznab?: { url?: string; apiKey?: string };
  updatedAt?: number;
}

function mergeAddons(local: AddonEntry[], remote: AddonEntry[]): AddonEntry[] {
  const map = new Map<string, AddonEntry>();
  for (const entry of [...remote, ...local]) {
    const existing = map.get(entry.url);
    if (!existing || (!existing.name && entry.name)) {
      map.set(entry.url, entry);
    }
  }
  return Array.from(map.values());
}

function mergeWatchlist(local: MediaItem[], remote: MediaItem[]): MediaItem[] {
  const map = new Map<string, MediaItem>();
  for (const item of [...local, ...remote]) {
    if (!item || typeof item.id !== 'number') continue;
    const key = getMediaKey(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function mergeWatchHistory(
  local: WatchHistoryEntry[],
  remote: WatchHistoryEntry[]
): WatchHistoryEntry[] {
  const map = new Map<string, WatchHistoryEntry>();
  for (const entry of [...local, ...remote]) {
    if (!entry || !entry.key) continue;
    const existing = map.get(entry.key);
    if (!existing || (entry.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      map.set(entry.key, entry);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 20);
}

async function pushConfigToServer(payload: {
  tmdbApiKey: string;
  addons: AddonEntry[];
  addonListUrls: string[];
  preferences: UserPreferences;
  watchlist: MediaItem[];
  ratings: Record<string, number>;
  watchHistory: WatchHistoryEntry[];
}): Promise<void> {
  try {
    await fetch(`${PLAYER_API_BASE}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdbApiKey: payload.tmdbApiKey,
        addons: payload.addons,
        addonListUrls: payload.addonListUrls,
        preferences: payload.preferences,
        watchlist: payload.watchlist,
        ratings: payload.ratings,
        watchHistory: payload.watchHistory,
        torznab: {
          url: payload.preferences.sources.torznabUrl,
          apiKey: payload.preferences.sources.torznabApiKey,
        },
      }),
    });
  } catch {
    // Backend pode estar offline; localStorage continua preservado
  }
}

export function usePlayHubStorage() {
  const [tmdbApiKey, setTmdbApiKeyState] = useState<string>(() => {
    const initial = loadTmdbApiKey();
    setRuntimeTmdbKey(initial);
    return initial;
  });
  const [ratings, setRatingsState] = useState<Record<string, number>>(() => loadRatings());
  const [watchlist, setWatchlistState] = useState<MediaItem[]>(() => loadWatchlist());
  const [watchHistory, setWatchHistoryState] = useState<WatchHistoryEntry[]>(() =>
    loadWatchHistory()
  );
  const [preferences, setPreferencesState] = useState<UserPreferences>(() => loadPreferences());
  const [addons, setAddonsState] = useState<AddonEntry[]>(() => loadAddons());
  const [addonListUrls, setAddonListUrlsState] = useState<string[]>(() => loadAddonListUrls());
  const [configHydrated, setConfigHydrated] = useState(false);

  const hydratedFromServerRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    applyThemeToDocument(preferences.theme);
  }, [preferences.theme]);

  // 1. Ao iniciar o app, carrega de GET /api/config e faz merge seguro com localStorage
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetch(`${PLAYER_API_BASE}/api/config`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as RemoteStorePayload;
      })
      .then((remote) => {
        if (!active) return;
        hydratedFromServerRef.current = true;
        if (!remote || !remote.updatedAt) {
          setConfigHydrated(true);
          return;
        }

        if (typeof remote.tmdbApiKey === 'string' && remote.tmdbApiKey.trim()) {
          setTmdbApiKeyState((prev) => {
            if (prev) return prev;
            const nextKey = remote.tmdbApiKey!.trim();
            saveTmdbApiKey(nextKey);
            return nextKey;
          });
        }

        if (Array.isArray(remote.addons) && remote.addons.length > 0) {
          setAddonsState((prev) => {
            const merged = mergeAddons(prev, normalizeAddonList(remote.addons));
            saveAddons(merged);
            return merged;
          });
        }

        if (Array.isArray(remote.addonListUrls) && remote.addonListUrls.length > 0) {
          setAddonListUrlsState((prev) => {
            const merged = Array.from(new Set([...remote.addonListUrls!, ...prev]));
            saveAddonListUrls(merged);
            return merged;
          });
        }

        if (Array.isArray(remote.watchlist) && remote.watchlist.length > 0) {
          setWatchlistState((prev) => {
            const merged = mergeWatchlist(prev, remote.watchlist!);
            saveWatchlist(merged);
            return merged;
          });
        }

        if (remote.ratings && Object.keys(remote.ratings).length > 0) {
          setRatingsState((prev) => {
            const merged = { ...remote.ratings, ...prev };
            saveRatings(merged);
            return merged;
          });
        }

        if (Array.isArray(remote.watchHistory) && remote.watchHistory.length > 0) {
          setWatchHistoryState((prev) => {
            const merged = mergeWatchHistory(prev, remote.watchHistory!);
            saveWatchHistory(merged);
            return merged;
          });
        }

        if (remote.preferences && Object.keys(remote.preferences).length > 0) {
          const localPrefsRaw = localStorage.getItem(KEYS.preferences);
          if (!localPrefsRaw) {
            const resolved = normalizePreferences(remote.preferences, remote.torznab);
            savePreferences(resolved);
            setPreferencesState(resolved);
          }
        }
        setConfigHydrated(true);
      })
      .catch(() => {
        hydratedFromServerRef.current = true;
        if (active) setConfigHydrated(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // 2. Sincroniza alterações com PUT /api/config com debounce de 500ms
  useEffect(() => {
    if (!hydratedFromServerRef.current) return;
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      void pushConfigToServer({
        tmdbApiKey,
        addons,
        addonListUrls,
        preferences,
        watchlist,
        ratings,
        watchHistory,
      });
    }, 500);

    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, [tmdbApiKey, addons, addonListUrls, preferences, watchlist, ratings, watchHistory]);

  const setTmdbApiKey = useCallback((key: string) => {
    const cleaned = key.trim();
    saveTmdbApiKey(cleaned);
    setTmdbApiKeyState(cleaned);
  }, []);

  const setRating = useCallback((key: string, rating: number) => {
    setRatingsState((prev) => {
      const next = { ...prev };
      if (rating <= 0) {
        delete next[key];
      } else {
        next[key] = rating;
      }
      saveRatings(next);
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback((item: MediaItem) => {
    const key = getMediaKey(item);
    setWatchlistState((prev) => {
      const exists = prev.some((entry) => getMediaKey(entry) === key);
      const next = exists
        ? prev.filter((entry) => getMediaKey(entry) !== key)
        : [item, ...prev];
      saveWatchlist(next);
      return next;
    });
  }, []);

  const recordWatch = useCallback(
    (
      item: MediaItem,
      req: PlayRequest,
      progressPercent = 0,
      currentTimeSeconds?: number,
      durationSeconds?: number
    ) => {
      const key = getMediaKey(item);
      setWatchHistoryState((prev) => {
        const existing = prev.find((entry) => entry.key === key);
        const sameEpisode =
          item.media_type !== 'tv' ||
          (existing?.season === req.season && existing?.episode === req.episode);

        const nextPercent =
          progressPercent > 0
            ? Math.max(0, Math.min(100, Math.round(progressPercent)))
            : sameEpisode
              ? (existing?.progressPercent ?? 0)
              : 0;

        const nextTime =
          currentTimeSeconds !== undefined
            ? currentTimeSeconds
            : sameEpisode
              ? existing?.currentTimeSeconds
              : 0;

        const nextDuration =
          durationSeconds !== undefined
            ? durationSeconds
            : sameEpisode
              ? existing?.durationSeconds
              : undefined;

        const entry: WatchHistoryEntry = {
          key,
          item,
          imdbId: req.imdbId,
          season: req.season,
          episode: req.episode,
          progressPercent: nextPercent,
          ...(nextTime !== undefined ? { currentTimeSeconds: nextTime } : {}),
          ...(nextDuration !== undefined ? { durationSeconds: nextDuration } : {}),
          updatedAt: Date.now(),
        };
        const filtered = prev.filter((h) => h.key !== key);
        const next = [entry, ...filtered].slice(0, 20);
        saveWatchHistory(next);
        return next;
      });
    },
    []
  );

  const removeFromHistory = useCallback((key: string) => {
    setWatchHistoryState((prev) => {
      const next = prev.filter((entry) => entry.key !== key);
      saveWatchHistory(next);
      return next;
    });
  }, []);

  const addAddon = useCallback(
    async (rawUrl: string): Promise<{ ok: boolean; error?: string; name?: string }> => {
      const normalized = normalizeAddonUrl(rawUrl);
      if (!normalized) {
        return {
          ok: false,
          error: 'Informe uma URL válida (https:// ou stremio://).',
        };
      }

      const validation = await fetchManifestName(normalized.manifestUrl);
      if (!validation.ok) {
        return {
          ok: false,
          error: 'Não foi possível acessar o manifest.json desta URL.',
        };
      }

      const entry: AddonEntry = {
        url: normalized.manifestUrl,
        ...(validation.name ? { name: validation.name } : {}),
      };

      setAddonsState((prev) => {
        const existsIdx = prev.findIndex((a) => a.url === entry.url);
        const next =
          existsIdx >= 0
            ? prev.map((a, idx) => (idx === existsIdx ? entry : a))
            : [...prev, entry];
        saveAddons(next);
        return next;
      });

      return { ok: true, name: validation.name };
    },
    []
  );

  const installDirectoryAddon = useCallback((transportUrl: string, name?: string) => {
    const normalized = normalizeAddonUrl(transportUrl);
    if (!normalized) return;
    const entry: AddonEntry = {
      url: normalized.manifestUrl,
      ...(name ? { name } : {}),
    };
    setAddonsState((prev) => {
      if (prev.some((a) => a.url === entry.url)) return prev;
      const next = [...prev, entry];
      saveAddons(next);
      return next;
    });
  }, []);

  const removeAddon = useCallback((url: string) => {
    setAddonsState((prev) => {
      const next = prev.filter((entry) => entry.url !== url);
      saveAddons(next);
      return next;
    });
  }, []);

  const addAddonListUrl = useCallback((rawUrl: string): boolean => {
    const trimmed = rawUrl.trim().replace(/^stremio:\/\//i, 'https://');
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      const str = parsed.toString();
      setAddonListUrlsState((prev) => {
        if (prev.includes(str)) return prev;
        const next = [...prev, str];
        saveAddonListUrls(next);
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const removeAddonListUrl = useCallback((url: string) => {
    setAddonListUrlsState((prev) => {
      const next = prev.filter((u) => u !== url);
      saveAddonListUrls(next);
      return next;
    });
  }, []);

  const syncAddonListsNow = useCallback(
    async (overrideUrls?: string[]): Promise<SyncAddonListsResponse> => {
      const targetUrls = overrideUrls ?? addonListUrls;
      const result = await syncRemoteAddonLists(targetUrls);
      if (Array.isArray(result.addons)) {
        const normalized = normalizeAddonList(result.addons);
        setAddonsState((prev) => {
          const merged = mergeAddons(prev, normalized);
          saveAddons(merged);
          return merged;
        });
      }
      return result;
    },
    [addonListUrls]
  );

  const setTheme = useCallback((theme: ThemeMode) => {
    setPreferencesState((prev) => {
      const next: UserPreferences = { ...prev, theme };
      savePreferences(next);
      return next;
    });
  }, []);

  const setLanguage = useCallback((language: LanguagePreference) => {
    setPreferencesState((prev) => {
      const next: UserPreferences = { ...prev, language };
      savePreferences(next);
      return next;
    });
  }, []);

  const updatePlaybackPreference = useCallback(
    <K extends keyof PlaybackPreferences>(key: K, value: PlaybackPreferences[K]) => {
      setPreferencesState((prev) => {
        const next: UserPreferences = {
          ...prev,
          playback: {
            ...prev.playback,
            [key]: value,
          },
        };
        savePreferences(next);
        return next;
      });
    },
    []
  );

  const updateSourcePreference = useCallback(
    <K extends keyof SourcePreferences>(key: K, value: SourcePreferences[K]) => {
      setPreferencesState((prev) => {
        const next: UserPreferences = {
          ...prev,
          sources: {
            ...prev.sources,
            [key]: value,
          },
        };
        savePreferences(next);
        return next;
      });
    },
    []
  );

  const exportBackupJson = useCallback(
    (options?: { includeTmdbKey?: boolean }) => {
      const includeKey = Boolean(options?.includeTmdbKey);
      const payload: PlayHubBackupPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        ...(includeKey && tmdbApiKey ? { tmdbApiKey } : {}),
        addons,
        addonListUrls,
        preferences,
        watchlist,
        ratings,
        watchHistory,
        torznab: {
          url: preferences.sources.torznabUrl,
          apiKey: preferences.sources.torznabApiKey,
        },
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'playhub-backup.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    [tmdbApiKey, addons, addonListUrls, preferences, watchlist, ratings, watchHistory]
  );

  const importBackupJson = useCallback(
    async (rawText: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const parsed = JSON.parse(rawText) as Partial<PlayHubBackupPayload>;
        if (!parsed || typeof parsed !== 'object') {
          return { ok: false, error: 'Arquivo JSON inválido.' };
        }

        const nextTmdbKey =
          typeof parsed.tmdbApiKey === 'string' && parsed.tmdbApiKey.trim()
            ? parsed.tmdbApiKey.trim()
            : tmdbApiKey;
        const nextAddons = parsed.addons ? normalizeAddonList(parsed.addons) : addons;
        const nextLists = Array.isArray(parsed.addonListUrls)
          ? parsed.addonListUrls.filter((u): u is string => typeof u === 'string')
          : addonListUrls;
        const nextPrefs = parsed.preferences
          ? normalizePreferences(parsed.preferences, parsed.torznab)
          : preferences;
        const nextWatchlist = Array.isArray(parsed.watchlist) ? parsed.watchlist : watchlist;
        const nextRatings =
          parsed.ratings && typeof parsed.ratings === 'object' ? parsed.ratings : ratings;
        const nextHistory = Array.isArray(parsed.watchHistory)
          ? parsed.watchHistory
          : watchHistory;

        if (nextTmdbKey !== tmdbApiKey) {
          saveTmdbApiKey(nextTmdbKey);
          setTmdbApiKeyState(nextTmdbKey);
        }
        saveAddons(nextAddons);
        saveAddonListUrls(nextLists);
        savePreferences(nextPrefs);
        saveWatchlist(nextWatchlist);
        saveRatings(nextRatings);
        saveWatchHistory(nextHistory);

        setAddonsState(nextAddons);
        setAddonListUrlsState(nextLists);
        setPreferencesState(nextPrefs);
        setWatchlistState(nextWatchlist);
        setRatingsState(nextRatings);
        setWatchHistoryState(nextHistory);

        await pushConfigToServer({
          tmdbApiKey: nextTmdbKey,
          addons: nextAddons,
          addonListUrls: nextLists,
          preferences: nextPrefs,
          watchlist: nextWatchlist,
          ratings: nextRatings,
          watchHistory: nextHistory,
        });

        return { ok: true };
      } catch {
        return { ok: false, error: 'Não foi possível ler o arquivo JSON de backup.' };
      }
    },
    [tmdbApiKey, addons, addonListUrls, preferences, watchlist, ratings, watchHistory]
  );

  return {
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
    updatePlaybackPreference,
    updateSourcePreference,
    exportBackupJson,
    importBackupJson,
  };
}
