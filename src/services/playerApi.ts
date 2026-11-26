import type { MediaType } from '../types/media';

export const PLAYER_API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3001'
).replace(/\/+$/, '');

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
  return pathOrUrl.startsWith('/') ? `${PLAYER_API_BASE}${pathOrUrl}` : pathOrUrl;
}

export function buildTtsUrl(text: string, voice: DubVoiceKey, voiceName?: string): string {
  const params = new URLSearchParams({ text, voice });
  if (voiceName) {
    params.set('voiceName', voiceName);
  }
  return `${PLAYER_API_BASE}/api/tts?${params.toString()}`;
}

export async function fetchTorrentStatus(
  infoHash: string,
  signal?: AbortSignal
): Promise<TorrentStatusInfo | null> {
  try {
    const res = await fetch(
      `${PLAYER_API_BASE}/api/torrent-status/${encodeURIComponent(infoHash)}`,
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
  try {
    const res = await fetch(
      `${PLAYER_API_BASE}/api/torrent-meta/${encodeURIComponent(infoHash)}/${encodeURIComponent(
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
  try {
    const res = await fetch(
      `${PLAYER_API_BASE}/api/torrent-subtitles/${encodeURIComponent(infoHash)}/${encodeURIComponent(
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

export async function fetchAddonDirectory(): Promise<DirectoryAddon[]> {
  const res = await fetch(`${PLAYER_API_BASE}/api/addons/directory`);
  if (!res.ok) throw new Error('Falha ao carregar catálogo de add-ons.');
  const data = (await res.json()) as { addons?: DirectoryAddon[] };
  return Array.isArray(data.addons) ? data.addons : [];
}

export async function syncRemoteAddonLists(
  listUrls?: string[]
): Promise<SyncAddonListsResponse> {
  const res = await fetch(`${PLAYER_API_BASE}/api/addons/sync-lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listUrls ? { listUrls } : {}),
  });
  if (!res.ok) throw new Error('Falha ao sincronizar listas remotas.');
  return (await res.json()) as SyncAddonListsResponse;
}

export async function fetchLastStreamError(): Promise<LastStreamErrorInfo | null> {
  try {
    const res = await fetch(`${PLAYER_API_BASE}/api/debug/last-error`);
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
  return `${PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/stream`;
}

export function getOfflineSubtitleUrl(id: string): string {
  return `${PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/subtitle.vtt`;
}

export function getOfflineFileDownloadUrl(id: string): string {
  return `${PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/file`;
}

export async function fetchDownloads(): Promise<{
  downloads: DownloadItem[];
  downloadDir: string;
}> {
  const res = await fetch(`${PLAYER_API_BASE}/api/downloads`);
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
  const res = await fetch(`${PLAYER_API_BASE}/api/downloads`, {
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
  const res = await fetch(`${PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
  });
  const data = (await res.json()) as { download?: DownloadItem; error?: string };
  if (!res.ok || !data.download) {
    throw new Error(data.error || 'Falha ao pausar download.');
  }
  return data.download;
}

export async function resumeDownloadJob(id: string): Promise<DownloadItem> {
  const res = await fetch(`${PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
  });
  const data = (await res.json()) as { download?: DownloadItem; error?: string };
  if (!res.ok || !data.download) {
    throw new Error(data.error || 'Falha ao retomar download.');
  }
  return data.download;
}

export async function deleteDownloadJob(id: string, deleteFiles = true): Promise<void> {
  const res = await fetch(
    `${PLAYER_API_BASE}/api/downloads/${encodeURIComponent(id)}?deleteFiles=${deleteFiles ? 'true' : 'false'}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error('Falha ao remover download.');
  }
}

export async function resolvePlayback(
  params: ResolvePlaybackParams,
  signal?: AbortSignal
): Promise<ResolvePlaybackResponse> {
  const res = await fetch(`${PLAYER_API_BASE}/api/resolve`, {
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
  });

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
        : `${PLAYER_API_BASE}/api/proxy?url=${encodeURIComponent(stream.url)}`,
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
