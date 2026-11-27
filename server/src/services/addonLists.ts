import fs from 'node:fs';
import path from 'node:path';
import {
  mergeAndSaveStore,
  normalizeManifestUrl,
  readStore,
  type StoredAddon,
} from './configStore';

export interface DirectoryAddon {
  name: string;
  description: string;
  logo?: string;
  transportUrl: string;
  resources: string[];
}

export interface SyncAddonListsResult {
  syncedLists: number;
  discoveredCount: number;
  onlineCount: number;
  addedCount: number;
  addons: StoredAddon[];
}

const FETCH_TIMEOUT_MS = 5000;
const DIRECTORY_REMOTE_TIMEOUT_MS = 6000;
const DIRECTORY_CACHE_TTL_MS = 15 * 60 * 1000;
const DIRECTORY_FALLBACK_TTL_MS = 30 * 1000;
const DEFAULT_ADDONS_PATH = path.resolve(__dirname, '../../data/default-addons.json');

export const CURATED_DIRECTORY_ADDONS: DirectoryAddon[] = [
  {
    name: 'Torrentio',
    description:
      'Agregador de streams torrent mais popular para filmes e séries (4K, 1080p, 720p, Dual Áudio).',
    transportUrl: 'https://torrentio.strem.fun/manifest.json',
    resources: ['stream'],
  },
  {
    name: 'Comet',
    description:
      'Buscador rápido de streams P2P e Debrid hospedado pela ElfHosted com ampla cobertura.',
    transportUrl: 'https://comet.elfhosted.com/manifest.json',
    resources: ['stream'],
  },
  {
    name: 'MediaFusion',
    description:
      'Add-on multi-fontes com catálogo de filmes, séries e suporte a múltiplos idiomas.',
    transportUrl: 'https://mediafusion.elfhosted.com/manifest.json',
    resources: ['stream'],
  },
  {
    name: 'Brazuca Torrents',
    description:
      'Focado em lançamentos dublados em PT-BR, Dual Áudio e produções nacionais.',
    transportUrl: 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json',
    resources: ['stream'],
  },
  {
    name: 'Peerflix',
    description:
      'Streams P2P com boa disponibilidade de filmes e séries em alta definição.',
    transportUrl: 'https://peerflix.mov/manifest.json',
    resources: ['stream'],
  },
  {
    name: 'OpenSubtitles v3',
    description:
      'Legendas comunitárias oficiais em Português, Inglês, Espanhol e dezenas de idiomas.',
    transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
    resources: ['subtitles'],
  },
];

let directoryCache: { items: DirectoryAddon[]; fetchedAt: number; ttlMs: number } | null = null;

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractCandidatesFromListPayload(payload: unknown): StoredAddon[] {
  const rawList: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { addons?: unknown[] }).addons)
      ? (payload as { addons: unknown[] }).addons
      : [];

  const candidates: StoredAddon[] = [];

  for (const entry of rawList) {
    if (typeof entry === 'string') {
      const url = normalizeManifestUrl(entry);
      if (url) candidates.push({ url });
      continue;
    }

    if (entry && typeof entry === 'object') {
      const obj = entry as {
        url?: unknown;
        transportUrl?: unknown;
        name?: unknown;
        manifest?: { name?: unknown };
      };
      const rawUrl =
        typeof obj.transportUrl === 'string'
          ? obj.transportUrl
          : typeof obj.url === 'string'
            ? obj.url
            : null;
      if (!rawUrl) continue;

      const url = normalizeManifestUrl(rawUrl);
      if (!url) continue;

      const name =
        typeof obj.manifest?.name === 'string' && obj.manifest.name.trim()
          ? obj.manifest.name.trim()
          : typeof obj.name === 'string' && obj.name.trim()
            ? obj.name.trim()
            : undefined;

      candidates.push({ url, ...(name ? { name } : {}) });
    }
  }

  return candidates;
}

async function validateManifestOnline(candidate: StoredAddon): Promise<StoredAddon | null> {
  const manifest = await fetchJsonWithTimeout<{ name?: unknown }>(
    candidate.url,
    FETCH_TIMEOUT_MS
  );
  if (!manifest || typeof manifest !== 'object') return null;

  const resolvedName =
    typeof manifest.name === 'string' && manifest.name.trim()
      ? manifest.name.trim()
      : candidate.name;

  return {
    url: candidate.url,
    ...(resolvedName ? { name: resolvedName } : {}),
  };
}

export async function syncAddonLists(overrideListUrls?: string[]): Promise<SyncAddonListsResult> {
  const store = readStore();
  const listUrls =
    Array.isArray(overrideListUrls) && overrideListUrls.length > 0
      ? overrideListUrls
      : store.addonListUrls;

  if (listUrls.length === 0) {
    return {
      syncedLists: 0,
      discoveredCount: 0,
      onlineCount: 0,
      addedCount: 0,
      addons: store.addons,
    };
  }

  // 1. Baixa todas as listas remotas em paralelo
  const listPayloads = await Promise.allSettled(
    listUrls.map((url) => fetchJsonWithTimeout<unknown>(url, FETCH_TIMEOUT_MS))
  );

  const candidateMap = new Map<string, StoredAddon>();
  let syncedLists = 0;

  for (const res of listPayloads) {
    if (res.status !== 'fulfilled' || !res.value) continue;
    syncedLists++;
    const extracted = extractCandidatesFromListPayload(res.value);
    for (const item of extracted) {
      if (!candidateMap.has(item.url)) {
        candidateMap.set(item.url, item);
      }
    }
  }

  const candidates = Array.from(candidateMap.values());

  // 2. Valida quais manifests estão online (timeout 5s)
  const validatedResults = await Promise.allSettled(
    candidates.map((candidate) => validateManifestOnline(candidate))
  );

  const onlineAddons: StoredAddon[] = [];
  for (const res of validatedResults) {
    if (res.status === 'fulfilled' && res.value) {
      onlineAddons.push(res.value);
    }
  }

  const existingUrls = new Set(store.addons.map((a) => a.url));
  const merged = [...store.addons];
  let addedCount = 0;

  for (const addon of onlineAddons) {
    if (!existingUrls.has(addon.url)) {
      existingUrls.add(addon.url);
      merged.push(addon);
      addedCount++;
    }
  }

  const saved = mergeAndSaveStore({
    addons: merged,
    addonListUrls: listUrls,
  });

  console.log(
    `[addonLists] Sync concluído: ${syncedLists}/${listUrls.length} listas, ${onlineAddons.length}/${candidates.length} online, +${addedCount} novos`
  );

  return {
    syncedLists,
    discoveredCount: candidates.length,
    onlineCount: onlineAddons.length,
    addedCount,
    addons: saved.addons,
  };
}

function readCuratedFallbackAddons(): DirectoryAddon[] {
  try {
    if (!fs.existsSync(DEFAULT_ADDONS_PATH)) return [];
    const raw = fs.readFileSync(DEFAULT_ADDONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as DirectoryAddon[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractResourceNames(rawResources: unknown): string[] {
  if (!Array.isArray(rawResources)) return [];
  const names: string[] = [];
  for (const r of rawResources) {
    if (typeof r === 'string') {
      names.push(r.toLowerCase());
    } else if (r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string') {
      names.push(((r as { name: string }).name).toLowerCase());
    }
  }
  return Array.from(new Set(names));
}

export async function getAddonDirectory(): Promise<DirectoryAddon[]> {
  if (directoryCache && Date.now() - directoryCache.fetchedAt < directoryCache.ttlMs) {
    return directoryCache.items;
  }

  const byUrl = new Map<string, DirectoryAddon>();

  // 1. Lista curada embutida sempre garantida no topo (mesmo no binário empacotado / offline)
  for (const item of CURATED_DIRECTORY_ADDONS) {
    const normalized = normalizeManifestUrl(item.transportUrl);
    if (normalized && !byUrl.has(normalized)) {
      byUrl.set(normalized, { ...item, transportUrl: normalized });
    }
  }

  // 2. Complemento opcional do arquivo default-addons.json (se existir em disco)
  const diskCurated = readCuratedFallbackAddons();
  for (const item of diskCurated) {
    const normalized = normalizeManifestUrl(item.transportUrl);
    if (normalized && !byUrl.has(normalized)) {
      byUrl.set(normalized, { ...item, transportUrl: normalized });
    }
  }

  // 3. Consulta diretório comunitário oficial do Stremio via backend (sem Origin/CORS, timeout 6s)
  const remote = await fetchJsonWithTimeout<unknown>(
    'https://api.strem.io/addonscollection',
    DIRECTORY_REMOTE_TIMEOUT_MS
  );
  let remoteAdded = 0;

  if (Array.isArray(remote)) {
    for (const entry of remote) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as {
        transportUrl?: unknown;
        manifest?: {
          name?: unknown;
          description?: unknown;
          logo?: unknown;
          resources?: unknown;
        };
      };
      if (typeof obj.transportUrl !== 'string') continue;
      const normalized = normalizeManifestUrl(obj.transportUrl);
      if (!normalized || byUrl.has(normalized)) continue;

      const resources = extractResourceNames(obj.manifest?.resources);
      if (!resources.includes('stream') && !resources.includes('subtitles')) continue;

      const name =
        typeof obj.manifest?.name === 'string' && obj.manifest.name.trim()
          ? obj.manifest.name.trim()
          : 'Add-on Stremio';

      const description =
        typeof obj.manifest?.description === 'string'
          ? obj.manifest.description.trim()
          : 'Add-on comunitário compatível com Stremio.';

      const logo =
        typeof obj.manifest?.logo === 'string' && obj.manifest.logo.startsWith('http')
          ? obj.manifest.logo
          : undefined;

      byUrl.set(normalized, {
        name,
        description,
        ...(logo ? { logo } : {}),
        transportUrl: normalized,
        resources: resources.filter((r) => r === 'stream' || r === 'subtitles'),
      });
      remoteAdded++;
    }
  }

  const items = Array.from(byUrl.values()).slice(0, 40);
  directoryCache = {
    items,
    fetchedAt: Date.now(),
    ttlMs: remoteAdded > 0 ? DIRECTORY_CACHE_TTL_MS : DIRECTORY_FALLBACK_TTL_MS,
  };
  return items;
}
