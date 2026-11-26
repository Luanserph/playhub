import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../utils/paths';

export interface StoredAddon {
  url: string;
  name?: string;
}

export interface StoredTorznab {
  url: string;
  apiKey: string;
}

export interface PlayHubStoreData {
  tmdbApiKey?: string;
  addons: StoredAddon[];
  addonListUrls: string[];
  preferences: Record<string, unknown>;
  watchlist: unknown[];
  ratings: Record<string, number>;
  watchHistory: unknown[];
  torznab: StoredTorznab;
  updatedAt: number;
}

function getStorePath(): string {
  return path.join(getDataDir(), 'store.json');
}

const DEFAULT_STORE: PlayHubStoreData = {
  addons: [],
  addonListUrls: [],
  preferences: {},
  watchlist: [],
  ratings: {},
  watchHistory: [],
  torznab: { url: '', apiKey: '' },
  updatedAt: 0,
};

export function normalizeManifestUrl(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .replace(/\/manifest\.json\/?$/i, '')
    .replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.toString().replace(/\/+$/, '')}/manifest.json`;
  } catch {
    return null;
  }
}

function dedupeAddons(list: StoredAddon[]): StoredAddon[] {
  const map = new Map<string, StoredAddon>();
  for (const item of list) {
    if (!item || typeof item.url !== 'string') continue;
    const normalized = normalizeManifestUrl(item.url);
    if (!normalized) continue;
    const existing = map.get(normalized);
    if (!existing || (!existing.name && item.name)) {
      map.set(normalized, {
        url: normalized,
        ...(typeof item.name === 'string' && item.name.trim()
          ? { name: item.name.trim() }
          : existing?.name
            ? { name: existing.name }
            : {}),
      });
    }
  }
  return Array.from(map.values());
}

function dedupeUrls(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().replace(/^stremio:\/\//i, 'https://');
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      const str = parsed.toString();
      if (!seen.has(str)) {
        seen.add(str);
        out.push(str);
      }
    } catch {
      // Ignora URL inválida
    }
  }
  return out;
}

export function readStore(): PlayHubStoreData {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return { ...DEFAULT_STORE };
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PlayHubStoreData>;
    return {
      ...(typeof parsed.tmdbApiKey === 'string' && parsed.tmdbApiKey.trim()
        ? { tmdbApiKey: parsed.tmdbApiKey.trim() }
        : {}),
      addons: Array.isArray(parsed.addons) ? dedupeAddons(parsed.addons) : [],
      addonListUrls: Array.isArray(parsed.addonListUrls) ? dedupeUrls(parsed.addonListUrls) : [],
      preferences:
        parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {},
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      ratings: parsed.ratings && typeof parsed.ratings === 'object' ? parsed.ratings : {},
      watchHistory: Array.isArray(parsed.watchHistory) ? parsed.watchHistory : [],
      torznab: {
        url: typeof parsed.torznab?.url === 'string' ? parsed.torznab.url : '',
        apiKey: typeof parsed.torznab?.apiKey === 'string' ? parsed.torznab.apiKey : '',
      },
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch (err) {
    console.warn('[configStore] Falha ao ler store.json, usando padrão:', err);
    return { ...DEFAULT_STORE };
  }
}

export function writeStore(data: PlayHubStoreData): PlayHubStoreData {
  const storePath = getStorePath();
  const payload: PlayHubStoreData = {
    ...data,
    addons: dedupeAddons(data.addons),
    addonListUrls: dedupeUrls(data.addonListUrls),
    updatedAt: Date.now(),
  };

  const tmpPath = `${storePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, storePath);
  return payload;
}

export function mergeAndSaveStore(partial: Partial<PlayHubStoreData>): PlayHubStoreData {
  const current = readStore();

  const nextTmdbKey =
    typeof partial.tmdbApiKey === 'string'
      ? partial.tmdbApiKey.trim()
      : (current.tmdbApiKey ?? '');

  const next: PlayHubStoreData = {
    ...(nextTmdbKey ? { tmdbApiKey: nextTmdbKey } : {}),
    addons: Array.isArray(partial.addons) ? dedupeAddons(partial.addons) : current.addons,
    addonListUrls: Array.isArray(partial.addonListUrls)
      ? dedupeUrls(partial.addonListUrls)
      : current.addonListUrls,
    preferences:
      partial.preferences && typeof partial.preferences === 'object'
        ? { ...current.preferences, ...partial.preferences }
        : current.preferences,
    watchlist: Array.isArray(partial.watchlist) ? partial.watchlist : current.watchlist,
    ratings:
      partial.ratings && typeof partial.ratings === 'object'
        ? partial.ratings
        : current.ratings,
    watchHistory: Array.isArray(partial.watchHistory)
      ? partial.watchHistory
      : current.watchHistory,
    torznab:
      partial.torznab && typeof partial.torznab === 'object'
        ? {
            url:
              typeof partial.torznab.url === 'string'
                ? partial.torznab.url
                : current.torznab.url,
            apiKey:
              typeof partial.torznab.apiKey === 'string'
                ? partial.torznab.apiKey
                : current.torznab.apiKey,
          }
        : current.torznab,
    updatedAt: Date.now(),
  };

  return writeStore(next);
}
