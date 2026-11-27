import type { MediaType } from '../types/media';
import {
  API_BASE_URL,
  fetchWithBootRetry,
  getApiBaseUrl,
  hasBackendServer,
  smartFetch,
} from './api';

export const PLAYER_API_BASE = API_BASE_URL;

export type DubVoiceKey = 'female' | 'male';
export type ResolveReason = 'NO_ADDONS' | 'NO_STREAMS_FOUND';

export interface ResolvedStream {
  id: string;
  url: string;
  proxyUrl: string;
  sourceType?: 'http' | 'torrent';
  provider?: string;
  name: string;
  title: string;
  releaseTitle?: string;
  description?: string;
  addonUrl?: string;
  infoHash?: string;
  fileIdx?: number | 'auto';
  score: number;
  quality: '4K' | '1080p' | '720p' | '480p' | 'SD';
  resolution?: '4K' | '1080p' | '720p' | '480p' | 'SD';
  audioTags?: string[];
  seeders?: number;
  size?: string;
  codecHint?: 'MP4/H264' | 'MKV/HEVC' | 'Desconhecido';
  containerTag?: 'MP4' | 'MKV' | 'WEBM';
  isBrowserFriendly?: boolean;
  isPtBr: boolean;
  isHls: boolean;
  isDemo?: boolean;
}

export interface TorrentStatusInfo {
  ready: boolean;
  numPeers: number;
  downloadSpeed: number;
  progress: number;
  fileName: string | null;
}

export interface TorrentMetaInfo {
  duration: number;
  isTranscoded: boolean;
  fileName: string;
}

export interface DirectoryAddon {
  name: string;
  description: string;
  logo?: string;
  transportUrl: string;
  resources: string[];
}

export interface SyncAddonListsResponse {
  syncedLists: number;
  discoveredCount: number;
  onlineCount: number;
  addedCount: number;
  addons: { url: string; name?: string }[];
}

export interface LastStreamErrorInfo {
  source: 'ffmpeg' | 'webtorrent' | 'http';
  message: string;
  timestamp: number;
}

export type SubtitleStatus = 'native-pt' | 'native' | 'auto-translated' | 'none';
export type SubtitleLangTag = 'Embutida' | 'PT-BR' | 'PT-PT' | 'EN' | 'IA PT-BR' | 'LOCAL';

export interface SubtitleTrackOption {
  id: string;
  label: string;
  langTag: SubtitleLangTag;
  releaseName: string;
  url: string;
  embeddedLang?: 'PT-BR' | 'PT-PT' | 'EN' | 'OTHER';
}

export interface ResolveSubtitleInfo {
  status: SubtitleStatus;
  language: string;
  url: string | null;
}

export interface ResolvePlaybackResponse {
  streams: ResolvedStream[];
  reason?: ResolveReason;
  subtitle: ResolveSubtitleInfo;
  subtitles: SubtitleTrackOption[];
}

export interface ResolvePlaybackParams {
  imdbId: string;
  type: MediaType;
  season?: number;
  episode?: number;
  addons: string[];
  enableBuiltInProviders?: boolean;
  torznabUrl?: string;
  torznabApiKey?: string;
  preferPtBr: boolean;
  autoSubtitles: boolean;
  lang: string;
  iso2: string;
  openSubCodes: string[];
}

const DEMO_HLS_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export const DEMO_TEST_STREAM: ResolvedStream = {
  id: 'playhub-manual-demo-hls',
  url: DEMO_HLS_URL,
  proxyUrl: `${PLAYER_API_BASE}/api/proxy?url=${encodeURIComponent(DEMO_HLS_URL)}`,
  sourceType: 'http',
  name: 'Stream Demo · 1080p HLS',
  title: 'Stream público de teste (Mux HLS)',
  score: 0,
  quality: '1080p',
  isPtBr: false,
  isHls: true,
  isDemo: true,
};

function toAbsoluteApiUrl(pathOrUrl: string): string {
  const base = getApiBaseUrl() || PLAYER_API_BASE;
  return pathOrUrl.startsWith('/') ? `${base}${pathOrUrl}` : pathOrUrl;
}

export function buildTtsUrl(text: string, voice: DubVoiceKey, voiceName?: string): string {
  const params = new URLSearchParams({ text, voice });
  if (voiceName) {
    params.set('voiceName', voiceName);
  }
  return `${getApiBaseUrl() || PLAYER_API_BASE}/api/tts?${params.toString()}`;
}

export async function fetchTorrentStatus(
  infoHash: string,
  signal?: AbortSignal
): Promise<TorrentStatusInfo | null> {
  if (!hasBackendServer()) return null;
  try {
    const res = await smartFetch(
      `${getApiBaseUrl()}/api/torrent-status/${encodeURIComponent(infoHash)}`,
      { signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as TorrentStatusInfo;
  } catch {
    return null;
  }
}

export async function fetchTorrentMeta(
  infoHash: string,
  fileIdx: number | 'auto' = 'auto',
  signal?: AbortSignal
): Promise<TorrentMetaInfo | null> {
  if (!hasBackendServer()) return null;
  try {
    const res = await smartFetch(
      `${getApiBaseUrl()}/api/torrent-meta/${encodeURIComponent(infoHash)}/${encodeURIComponent(
        String(fileIdx)
      )}`,
      { signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as TorrentMetaInfo;
  } catch {
    return null;
  }
}

export async function fetchTorrentSubtitles(
  infoHash: string,
  fileIdx: number | 'auto' = 'auto',
  signal?: AbortSignal
): Promise<SubtitleTrackOption[]> {
  if (!hasBackendServer()) return [];
  try {
    const res = await smartFetch(
      `${getApiBaseUrl()}/api/torrent-subtitles/${encodeURIComponent(infoHash)}/${encodeURIComponent(
        String(fileIdx)
      )}`,
      { signal }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      subtitles?: {
        streamIdx: number;
        codec: string;
        language: string;
        title: string;
        langTag: 'PT-BR' | 'PT-PT' | 'EN' | 'OTHER';
        label: string;
        url: string;
      }[];
    };
    if (!Array.isArray(data.subtitles)) return [];
    return data.subtitles.map((sub) => ({
      id: `embedded-${infoHash}-${sub.streamIdx}`,
      label: sub.label,
      langTag: 'Embutida' as const,
      embeddedLang: sub.langTag,
      releaseName: `MKV ${sub.codec.toUpperCase()} · ${sub.title}`,
      url: toAbsoluteApiUrl(sub.url),
    }));
  } catch {
    return [];
  }
}

const FALLBACK_CURATED_DIRECTORY: DirectoryAddon[] = [
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

export async function fetchAddonDirectory(): Promise<DirectoryAddon[]> {
  if (!hasBackendServer()) {
    return FALLBACK_CURATED_DIRECTORY;
  }
  try {
    const res = await smartFetch(`${getApiBaseUrl()}/api/addons/directory`);
    if (!res.ok) return FALLBACK_CURATED_DIRECTORY;
    const data = (await res.json()) as { addons?: DirectoryAddon[] };
    return Array.isArray(data.addons) && data.addons.length > 0
      ? data.addons
      : FALLBACK_CURATED_DIRECTORY;
  } catch {
    return FALLBACK_CURATED_DIRECTORY;
  }
}

export async function syncRemoteAddonLists(
  listUrls?: string[]
): Promise<SyncAddonListsResponse> {
  if (!hasBackendServer()) {
    return {
      syncedLists: 0,
      discoveredCount: 0,
      onlineCount: 0,
      addedCount: 0,
      addons: [],
    };
  }
  const res = await smartFetch(`${getApiBaseUrl()}/api/addons/sync-lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listUrls ? { listUrls } : {}),
  });
  if (!res.ok) throw new Error('Falha ao sincronizar listas remotas.');
  return (await res.json()) as SyncAddonListsResponse;
}

export async function fetchLastStreamError(): Promise<LastStreamErrorInfo | null> {
  if (!hasBackendServer()) return null;
  try {
    const res = await smartFetch(`${getApiBaseUrl()}/api/debug/last-error`);
    if (!res.ok) return null;
    const data = (await res.json()) as { error?: LastStreamErrorInfo | null };
    return data.error ?? null;
  } catch {
    return null;
  }
}

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadItem {
  id: string;
  imdbId: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  season?: number;
  episode?: number;
  posterPath: string | null;
  backdropPath: string | null;
  quality?: string;
  infoHash: string;
  fileIdx: number | 'auto';
  fileName: string;
  filePath: string;
  subtitlePath: string | null;
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  status: DownloadStatus;
  speed: number;
  peers: number;
  createdAt: number;
  error: string | null;
}

export interface StartDownloadPayload {
  imdbId: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  season?: number;
  episode?: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  quality?: string;
  infoHash?: string;
  magnetUri?: string;
  fileIdx?: number | 'auto';
}

export function getOfflineStreamUrl(id: string): string {
  return `${getApiBaseUrl() || PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/stream`;
}

export function getOfflineSubtitleUrl(id: string): string {
  return `${getApiBaseUrl() || PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/subtitle.vtt`;
}

export function getOfflineFileDownloadUrl(id: string): string {
  return `${getApiBaseUrl() || PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/file`;
}

export async function fetchDownloads(): Promise<{
  downloads: DownloadItem[];
  downloadDir: string;
}> {
  if (!hasBackendServer()) {
    return { downloads: [], downloadDir: '' };
  }
  const res = await smartFetch(`${getApiBaseUrl()}/api/downloads`);
  if (!res.ok) throw new Error('Falha ao consultar downloads.');
  const data = (await res.json()) as {
    downloads?: DownloadItem[];
    downloadDir?: string;
  };
  return {
    downloads: Array.isArray(data.downloads) ? data.downloads : [],
    downloadDir: typeof data.downloadDir === 'string' ? data.downloadDir : '',
  };
}

export async function startDownloadJob(payload: StartDownloadPayload): Promise<DownloadItem> {
  if (!hasBackendServer()) {
    throw new Error('Configure um Servidor PlayHub na Rede Local nas Configurações para baixar.');
  }
  const res = await smartFetch(`${getApiBaseUrl()}/api/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { download?: DownloadItem; error?: string };
  if (!res.ok || !data.download) {
    throw new Error(data.error || 'Não foi possível iniciar o download.');
  }
  return data.download;
}

export async function pauseDownloadJob(id: string): Promise<DownloadItem> {
  const res = await smartFetch(`${getApiBaseUrl()}/api/downloads/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
  });
  const data = (await res.json()) as { download?: DownloadItem; error?: string };
  if (!res.ok || !data.download) {
    throw new Error(data.error || 'Falha ao pausar download.');
  }
  return data.download;
}

export async function resumeDownloadJob(id: string): Promise<DownloadItem> {
  const res = await smartFetch(`${getApiBaseUrl()}/api/downloads/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
  });
  const data = (await res.json()) as { download?: DownloadItem; error?: string };
  if (!res.ok || !data.download) {
    throw new Error(data.error || 'Falha ao retomar download.');
  }
  return data.download;
}

export async function deleteDownloadJob(id: string, deleteFiles = true): Promise<void> {
  const res = await smartFetch(
    `${getApiBaseUrl()}/api/downloads/${encodeURIComponent(id)}?deleteFiles=${deleteFiles ? 'true' : 'false'}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error('Falha ao remover download.');
  }
}

interface RawStremioStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
}

function parseQualityTag(text: string): '4K' | '1080p' | '720p' | '480p' | 'SD' {
  if (/\b(2160p|4k|uhd)\b/i.test(text)) return '4K';
  if (/\b1080p\b/i.test(text)) return '1080p';
  if (/\b720p\b/i.test(text)) return '720p';
  if (/\b480p\b/i.test(text)) return '480p';
  return 'SD';
}

async function resolvePlaybackStandalone(
  params: ResolvePlaybackParams,
  signal?: AbortSignal
): Promise<ResolvePlaybackResponse> {
  const stremioType = params.type === 'tv' ? 'series' : 'movie';
  const stremioId =
    params.type === 'tv'
      ? `${params.imdbId}:${params.season ?? 1}:${params.episode ?? 1}`
      : params.imdbId;

  const targetAddons =
    params.addons.length > 0
      ? params.addons
      : FALLBACK_CURATED_DIRECTORY.filter((a) => a.resources.includes('stream')).map(
          (a) => a.transportUrl
        );

  const streams: ResolvedStream[] = [];
  const seen = new Set<string>();

  await Promise.allSettled(
    targetAddons.slice(0, 6).map(async (addonUrl) => {
      const base = addonUrl
        .trim()
        .replace(/^stremio:\/\//i, 'https://')
        .replace(/\/manifest\.json\/?$/i, '')
        .replace(/\/+$/, '');
      if (!base) return;

      const endpoint = `${base}/stream/${stremioType}/${encodeURIComponent(stremioId)}.json`;
      const res = await smartFetch(endpoint, {
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const payload = (await res.json()) as { streams?: RawStremioStream[] };
      if (!Array.isArray(payload.streams)) return;

      for (let i = 0; i < payload.streams.length && streams.length < 30; i++) {
        const s = payload.streams[i];
        const combined = `${s.name ?? ''}\n${s.title ?? ''}\n${s.description ?? ''}`;
        const quality = parseQualityTag(combined);
        const isPtBr = /(🇧🇷|\bpt-?br\b|\bdublado\b|\bdual\b|\bnacional\b)/i.test(combined);
        const seedMatch = combined.match(/(?:👤|S:)\s*(\d+)/i);
        const seeders = seedMatch ? Number(seedMatch[1]) : undefined;
        const sizeMatch = combined.match(/\b(\d+(?:[.,]\d+)?\s*(?:GB|MB))\b/i);
        const size = sizeMatch ? sizeMatch[1] : undefined;

        if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) {
          if (seen.has(s.url)) continue;
          seen.add(s.url);
          const isHls = /\.m3u8(\?|$)/i.test(s.url);
          streams.push({
            id: `standalone-http-${streams.length}`,
            url: s.url,
            proxyUrl: s.url,
            sourceType: 'http',
            provider: s.name?.split('\n')[0]?.trim() || 'Add-on',
            name: `${s.name?.split('\n')[0]?.trim() || 'Stream'} · ${quality}`,
            title: (s.title || s.description || 'Stream HTTP direto').split('\n')[0].trim(),
            addonUrl,
            score: (isPtBr ? 40 : 0) + (quality === '1080p' ? 30 : quality === '4K' ? 25 : 15),
            quality,
            resolution: quality,
            seeders,
            size,
            isPtBr,
            isHls,
          });
        } else if (typeof s.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(s.infoHash)) {
          const hash = s.infoHash.toLowerCase();
          if (seen.has(hash)) continue;
          seen.add(hash);
          const magnetUrl = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(
            (s.title || params.imdbId).split('\n')[0].trim()
          )}`;
          streams.push({
            id: `standalone-magnet-${hash}-${s.fileIdx ?? 'auto'}`,
            url: magnetUrl,
            proxyUrl: magnetUrl,
            sourceType: 'torrent',
            provider: s.name?.split('\n')[0]?.trim() || 'Torrent',
            name: `${s.name?.split('\n')[0]?.trim() || 'Torrent'} · ${quality}`,
            title: (s.title || s.description || 'Magnet (Player Externo)').split('\n')[0].trim(),
            addonUrl,
            infoHash: hash,
            fileIdx: s.fileIdx ?? 'auto',
            score: (isPtBr ? 25 : 0) + (seeders ? Math.min(20, Math.floor(seeders / 10)) : 0),
            quality,
            resolution: quality,
            seeders,
            size,
            isPtBr,
            isHls: false,
          });
        }
      }
    })
  );

  // Prioriza streams HTTP diretos (reproduzíveis no WebView) antes de magnets (Player Externo)
  streams.sort((a, b) => {
    const aHttp = a.sourceType === 'http' ? 1 : 0;
    const bHttp = b.sourceType === 'http' ? 1 : 0;
    if (aHttp !== bHttp) return bHttp - aHttp;
    return b.score - a.score;
  });

  return {
    streams,
    ...(streams.length === 0 ? { reason: 'NO_STREAMS_FOUND' as const } : {}),
    subtitle: {
      status: 'none',
      language: params.lang || 'pt-BR',
      url: null,
    },
    subtitles: [],
  };
}

export async function resolvePlayback(
  params: ResolvePlaybackParams,
  signal?: AbortSignal
): Promise<ResolvePlaybackResponse> {
  if (!hasBackendServer()) {
    return resolvePlaybackStandalone(params, signal);
  }

  const baseUrl = getApiBaseUrl() || PLAYER_API_BASE;
  const res = await fetchWithBootRetry(
    `${baseUrl}/api/resolve`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imdbId: params.imdbId,
        type: params.type,
        season: params.season,
        episode: params.episode,
        addons: params.addons,
        enableBuiltInProviders: params.enableBuiltInProviders ?? true,
        ...(params.torznabUrl ? { torznabUrl: params.torznabUrl } : {}),
        ...(params.torznabApiKey ? { torznabApiKey: params.torznabApiKey } : {}),
        preferPtBr: params.preferPtBr,
        autoTranslate: params.autoSubtitles,
        lang: params.lang,
        iso2: params.iso2,
        openSubCodes: params.openSubCodes,
      }),
    },
    { attempts: 3, delayMs: 1000 }
  );

  if (!res.ok) {
    throw new Error(`Erro ao resolver stream (${res.status})`);
  }

  const data = (await res.json()) as ResolvePlaybackResponse;
  const resolvedStreams = Array.isArray(data.streams)
    ? data.streams.map((stream) => ({
      ...stream,
      url: toAbsoluteApiUrl(stream.url),
      proxyUrl: stream.proxyUrl
        ? toAbsoluteApiUrl(stream.proxyUrl)
        : `${baseUrl}/api/proxy?url=${encodeURIComponent(stream.url)}`,
    }))
    : [];

  const resolvedSubtitleUrl = data.subtitle?.url
    ? toAbsoluteApiUrl(data.subtitle.url)
    : null;

  const resolvedSubtitles: SubtitleTrackOption[] = Array.isArray(data.subtitles)
    ? data.subtitles.map((opt) => ({
      ...opt,
      url: toAbsoluteApiUrl(opt.url),
    }))
    : [];

  return {
    streams: resolvedStreams,
    reason: data.reason,
    subtitle: {
      status: data.subtitle?.status ?? 'none',
      language: data.subtitle?.language ?? 'pt-BR',
      url: resolvedSubtitleUrl,
    },
    subtitles: resolvedSubtitles,
  };
}
