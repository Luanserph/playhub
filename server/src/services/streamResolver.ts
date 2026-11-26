import {
  aggregateBuiltInAndTorznab,
  extractReleaseTitle,
  parseTorrentMetadata,
  type CodecHint,
  type ContainerTag,
  type ResolutionTag,
} from './torrentAggregator';

export type StreamMediaType = 'movie' | 'tv';
export type ResolveReason = 'NO_ADDONS' | 'NO_STREAMS_FOUND';

export interface StremioProxyHeaders {
  request?: Record<string, string>;
  response?: Record<string, string>;
}

export interface StremioRawStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: {
    filename?: string;
    proxyHeaders?: StremioProxyHeaders;
    [key: string]: unknown;
  };
}

export interface ResolveStreamsInput {
  type: StreamMediaType;
  imdbId: string;
  season?: number;
  episode?: number;
  preferPtBr: boolean;
  addons?: string[];
  enableBuiltInProviders?: boolean;
  torznabUrl?: string;
  torznabApiKey?: string;
  serverOrigin?: string;
}

export interface ResolvedStream {
  id: string;
  url: string;
  proxyUrl: string;
  sourceType: 'http' | 'torrent';
  provider?: string;
  name: string;
  title: string;
  releaseTitle: string;
  description?: string;
  addonUrl?: string;
  infoHash?: string;
  fileIdx?: number | 'auto';
  score: number;
  quality: ResolutionTag;
  resolution: ResolutionTag;
  audioTags: string[];
  seeders?: number;
  size?: string;
  codecHint: CodecHint;
  containerTag?: ContainerTag;
  isBrowserFriendly: boolean;
  isPtBr: boolean;
  isHls: boolean;
  isDemo?: boolean;
}

export interface ResolveStreamsResult {
  streams: ResolvedStream[];
  reason?: ResolveReason;
}

const ADDON_TIMEOUT_MS = 6000;
const MAX_RETURNED_STREAMS = 40;

const PT_BR_REGEX = /\b(dual|dublado|pt-br|ptbr|portugues|nacional)\b/i;
const CAM_TS_REGEX = /\b(cam|camrip|hdcam|ts|hdts|telesync)\b/i;
const INFO_HASH_REGEX = /^([a-f0-9]{40}|[a-z2-7]{32})$/i;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeAddonBase(rawUrl: string): string | null {
  const cleaned = rawUrl
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .replace(/\/manifest\.json\/?$/i, '')
    .replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function isValidHttpUrl(rawUrl?: string): rawUrl is string {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidInfoHash(rawHash?: string): rawHash is string {
  if (!rawHash || typeof rawHash !== 'string') return false;
  return INFO_HASH_REGEX.test(rawHash.trim());
}

function encodeProxyHeaders(headers?: Record<string, string>): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const entries = Object.entries(headers).filter(
    ([k, v]) => typeof k === 'string' && typeof v === 'string' && v.trim().length > 0
  );
  if (entries.length === 0) return null;
  return Buffer.from(JSON.stringify(Object.fromEntries(entries)), 'utf-8').toString('base64');
}

function extractTrackers(sources?: string[]): string[] {
  if (!Array.isArray(sources)) return [];
  const trackers: string[] = [];
  for (const src of sources) {
    if (typeof src !== 'string') continue;
    const trimmed = src.trim();
    if (trimmed.toLowerCase().startsWith('tracker:')) {
      const trackerUrl = trimmed.slice('tracker:'.length).trim();
      if (trackerUrl) trackers.push(trackerUrl);
    } else if (/^(udp|http|https|wss):\/\//i.test(trimmed)) {
      trackers.push(trimmed);
    }
  }
  return Array.from(new Set(trackers)).slice(0, 12);
}

function cleanAddonLabel(rawName?: string, fallback = 'Stremio'): string {
  if (!rawName) return fallback;
  const firstLine = rawName
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return firstLine || fallback;
}

export function scoreStream(
  rawText: string,
  opts: {
    preferPtBr: boolean;
    sourceType: 'http' | 'torrent';
    resolution: ResolutionTag;
    isBrowserFriendly: boolean;
    audioTags: string[];
    seeders?: number;
    isHls?: boolean;
  }
): number {
  const combined = normalizeText(rawText);
  let score = 0;

  // Prioridade máxima para PT-BR / Dual / Dublado quando preferPtBr está ativo
  const hasPtAudio =
    rawText.includes('🇧🇷') ||
    opts.audioTags.some((t) => t === 'PT-BR' || t === 'Dublado' || t === 'Dual') ||
    PT_BR_REGEX.test(combined);

  if (opts.preferPtBr && hasPtAudio) {
    score += 100;
  }

  // Compatibilidade direta com navegador (MP4/H264 sem x265/HEVC/DTS)
  if (opts.isBrowserFriendly) {
    score += 45;
  }

  // Qualidade equilibrada: 1080p > 4K > 720p > 480p
  if (opts.resolution === '1080p') score += 40;
  else if (opts.resolution === '4K') score += 30;
  else if (opts.resolution === '720p') score += 24;
  else if (opts.resolution === '480p') score += 10;

  // Penaliza fontes CAM / TS
  if (CAM_TS_REGEX.test(combined)) {
    score -= 80;
  }

  // HTTP direto inicia mais rápido que P2P
  if (opts.sourceType === 'http') {
    score += 20;
    if (opts.isHls) score += 5;
  }

  // Seeders: penaliza 0 seeders e bonifica torrents bem semeados
  if (opts.seeders !== undefined) {
    if (opts.seeders === 0) {
      score -= 60;
    } else {
      score += Math.min(35, Math.round(Math.log10(opts.seeders + 1) * 14));
    }
  }

  return score;
}

async function fetchAddonStreams(
  addonBase: string,
  type: StreamMediaType,
  imdbId: string,
  season?: number,
  episode?: number
): Promise<StremioRawStream[]> {
  const endpoint =
    type === 'movie'
      ? `${addonBase}/stream/movie/${encodeURIComponent(imdbId)}.json`
      : `${addonBase}/stream/series/${encodeURIComponent(
          `${imdbId}:${season ?? 1}:${episode ?? 1}`
        )}.json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ADDON_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.log(`[streamResolver] Add-on ${addonBase} respondeu HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { streams?: unknown };
    return Array.isArray(data.streams) ? (data.streams as StremioRawStream[]) : [];
  } catch (err) {
    console.log(
      `[streamResolver] Falha ao consultar add-on ${addonBase}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveStreams(input: ResolveStreamsInput): Promise<ResolveStreamsResult> {
  const {
    type,
    imdbId,
    season,
    episode,
    preferPtBr,
    addons = [],
    enableBuiltInProviders = true,
    torznabUrl,
    torznabApiKey,
    serverOrigin = 'http://localhost:3001',
  } = input;

  const validAddons = Array.from(
    new Set(
      addons
        .map((url) => normalizeAddonBase(url))
        .filter((url): url is string => Boolean(url))
    )
  );

  const hasTorznab = Boolean(
    (torznabUrl?.trim() || process.env.TORZNAB_URL?.trim()) &&
      (torznabApiKey?.trim() || process.env.TORZNAB_API_KEY?.trim())
  );

  if (validAddons.length === 0 && !enableBuiltInProviders && !hasTorznab) {
    console.log(`[streamResolver] Nenhum add-on ou provedor ativo para ${type}/${imdbId}`);
    return { streams: [], reason: 'NO_ADDONS' };
  }

  const cleanOrigin = serverOrigin.replace(/\/+$/, '');

  const [addonResults, aggregatedItems] = await Promise.all([
    Promise.allSettled(
      validAddons.map(async (addonBase) => {
        const rawStreams = await fetchAddonStreams(addonBase, type, imdbId, season, episode);
        return { addonBase, rawStreams };
      })
    ),
    aggregateBuiltInAndTorznab({
      type,
      imdbId,
      season,
      episode,
      enableBuiltInProviders,
      torznabUrl,
      torznabApiKey,
    }),
  ]);

  const deduped = new Map<string, ResolvedStream>();

  const upsertStream = (key: string, candidate: ResolvedStream) => {
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(key, candidate);
    }
  };

  // Camada 1: Add-ons Stremio
  for (const result of addonResults) {
    if (result.status !== 'fulfilled') continue;
    const { addonBase, rawStreams } = result.value;

    let acceptedHttp = 0;
    let acceptedTorrent = 0;

    for (let i = 0; i < rawStreams.length; i++) {
      const raw = rawStreams[i];
      if (!raw) continue;

      const filename =
        typeof raw.behaviorHints?.filename === 'string' ? raw.behaviorHints.filename : undefined;
      const rawText = [
        raw.name ?? '',
        raw.title ?? '',
        raw.description ?? '',
        filename ?? '',
      ].join('\n');

      const releaseTitle =
        extractReleaseTitle(filename, raw.title, raw.description) ||
        cleanAddonLabel(raw.name, 'Fonte externa');

      if (isValidHttpUrl(raw.url)) {
        const directUrl = raw.url.trim();
        const encodedHeaders = encodeProxyHeaders(raw.behaviorHints?.proxyHeaders?.request);
        const proxyUrl = encodedHeaders
          ? `/api/proxy?url=${encodeURIComponent(directUrl)}&headers=${encodeURIComponent(
              encodedHeaders
            )}`
          : `/api/proxy?url=${encodeURIComponent(directUrl)}`;

        const isHls = directUrl.toLowerCase().includes('.m3u8');
        const meta = parseTorrentMetadata(rawText, { releaseTitle });
        const isPtBr =
          rawText.includes('🇧🇷') ||
          meta.audioTags.some((t) => t === 'PT-BR' || t === 'Dublado' || t === 'Dual') ||
          PT_BR_REGEX.test(normalizeText(rawText));

        const score = scoreStream(rawText, {
          preferPtBr,
          sourceType: 'http',
          resolution: meta.resolution,
          isBrowserFriendly: isHls || meta.isBrowserFriendly,
          audioTags: meta.audioTags,
          seeders: meta.seeders,
          isHls,
        });

        upsertStream(`http:${directUrl}`, {
          id: `${addonBase}-http-${i}`,
          url: directUrl,
          proxyUrl,
          sourceType: 'http',
          provider: cleanAddonLabel(raw.name, 'Stremio'),
          name: `${cleanAddonLabel(raw.name, 'HTTP')} · ${meta.resolution}`,
          title: raw.title?.trim() || releaseTitle,
          releaseTitle,
          ...(raw.description ? { description: raw.description.trim() } : {}),
          addonUrl: addonBase,
          score,
          quality: meta.resolution,
          resolution: meta.resolution,
          audioTags: meta.audioTags,
          ...(meta.seeders !== undefined ? { seeders: meta.seeders } : {}),
          ...(meta.size ? { size: meta.size } : {}),
          codecHint: meta.codecHint,
          ...(meta.containerTag ? { containerTag: meta.containerTag } : {}),
          isBrowserFriendly: isHls || meta.isBrowserFriendly,
          isPtBr,
          isHls,
        });
        acceptedHttp++;
        continue;
      }

      if (isValidInfoHash(raw.infoHash)) {
        const hash = raw.infoHash.trim().toLowerCase();
        const fileIdx: number | 'auto' =
          typeof raw.fileIdx === 'number' && Number.isInteger(raw.fileIdx) && raw.fileIdx >= 0
            ? raw.fileIdx
            : 'auto';

        const trackers = extractTrackers(raw.sources);
        const qs = new URLSearchParams();
        for (const tr of trackers) qs.append('tr', tr);
        const querySuffix = qs.toString() ? `?${qs.toString()}` : '';
        const torrentUrl = `${cleanOrigin}/api/torrent-stream/${hash}/${fileIdx}${querySuffix}`;

        const meta = parseTorrentMetadata(rawText, { infoHash: hash, releaseTitle });
        const isPtBr =
          rawText.includes('🇧🇷') ||
          meta.audioTags.some((t) => t === 'PT-BR' || t === 'Dublado' || t === 'Dual') ||
          PT_BR_REGEX.test(normalizeText(rawText));

        const score = scoreStream(rawText, {
          preferPtBr,
          sourceType: 'torrent',
          resolution: meta.resolution,
          isBrowserFriendly: meta.isBrowserFriendly,
          audioTags: meta.audioTags,
          seeders: meta.seeders,
        });

        upsertStream(`torrent:${hash}`, {
          id: `${addonBase}-p2p-${i}`,
          url: torrentUrl,
          proxyUrl: torrentUrl,
          sourceType: 'torrent',
          provider: cleanAddonLabel(raw.name, 'Stremio'),
          name: `${cleanAddonLabel(raw.name, 'Torrent')} · ${meta.resolution}`,
          title: raw.title?.trim() || releaseTitle,
          releaseTitle,
          ...(raw.description ? { description: raw.description.trim() } : {}),
          addonUrl: addonBase,
          infoHash: hash,
          fileIdx,
          score,
          quality: meta.resolution,
          resolution: meta.resolution,
          audioTags: meta.audioTags,
          ...(meta.seeders !== undefined ? { seeders: meta.seeders } : {}),
          ...(meta.size ? { size: meta.size } : {}),
          codecHint: meta.codecHint,
          ...(meta.containerTag ? { containerTag: meta.containerTag } : {}),
          isBrowserFriendly: meta.isBrowserFriendly,
          isPtBr,
          isHls: false,
        });
        acceptedTorrent++;
      }
    }

    console.log(
      `[streamResolver] Add-on ${addonBase}: ${rawStreams.length} retornados -> ${
        acceptedHttp + acceptedTorrent
      } aceitos (${acceptedHttp} HTTP, ${acceptedTorrent} P2P)`
    );
  }

  // Camada 2 (YTS / EZTV) e Camada 3 (Torznab)
  for (let i = 0; i < aggregatedItems.length; i++) {
    const item = aggregatedItems[i];
    if (!item) continue;

    const hash = item.infoHash.toLowerCase();
    const torrentUrl = `${cleanOrigin}/api/torrent-stream/${hash}/auto`;
    const rawText = `${item.name}\n${item.title}`;
    const isPtBr =
      rawText.includes('🇧🇷') ||
      item.metadata.audioTags.some((t) => t === 'PT-BR' || t === 'Dublado' || t === 'Dual') ||
      PT_BR_REGEX.test(normalizeText(rawText));

    const score = scoreStream(rawText, {
      preferPtBr,
      sourceType: 'torrent',
      resolution: item.metadata.resolution,
      isBrowserFriendly: item.metadata.isBrowserFriendly,
      audioTags: item.metadata.audioTags,
      seeders: item.metadata.seeders,
    });

    upsertStream(`torrent:${hash}`, {
      id: `${item.provider.toLowerCase()}-${hash}-${i}`,
      url: torrentUrl,
      proxyUrl: torrentUrl,
      sourceType: 'torrent',
      provider: item.provider,
      name: item.name,
      title: item.title,
      releaseTitle: item.metadata.releaseTitle || item.title,
      infoHash: hash,
      fileIdx: 'auto',
      score,
      quality: item.metadata.resolution,
      resolution: item.metadata.resolution,
      audioTags: item.metadata.audioTags,
      ...(item.metadata.seeders !== undefined ? { seeders: item.metadata.seeders } : {}),
      ...(item.metadata.size ? { size: item.metadata.size } : {}),
      codecHint: item.metadata.codecHint,
      ...(item.metadata.containerTag ? { containerTag: item.metadata.containerTag } : {}),
      isBrowserFriendly: item.metadata.isBrowserFriendly,
      isPtBr,
      isHls: false,
    });
  }

  // Filtra fontes com 0 seeders se houver fontes saudáveis disponíveis, e limita ao Top 40
  const allDeduped = Array.from(deduped.values());
  const withSeedsOrHttp = allDeduped.filter(
    (s) => s.sourceType === 'http' || s.seeders === undefined || s.seeders > 0
  );
  const pool = withSeedsOrHttp.length > 0 ? withSeedsOrHttp : allDeduped;

  const resolved = pool
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETURNED_STREAMS);

  console.log(
    `[streamResolver] Total único: ${allDeduped.length} -> retornando top ${resolved.length} fontes`
  );

  if (resolved.length === 0) {
    return {
      streams: [],
      reason: validAddons.length === 0 && !enableBuiltInProviders ? 'NO_ADDONS' : 'NO_STREAMS_FOUND',
    };
  }

  return { streams: resolved };
}
