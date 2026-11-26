import type { StreamMediaType } from './streamResolver';

export type ResolutionTag = '4K' | '1080p' | '720p' | '480p' | 'SD';
export type CodecHint = 'MP4/H264' | 'MKV/HEVC' | 'Desconhecido';
export type ContainerTag = 'MP4' | 'MKV' | 'WEBM';

export interface TorrentMetadata {
  resolution: ResolutionTag;
  audioTags: string[];
  seeders?: number;
  size?: string;
  codecHint: CodecHint;
  containerTag?: ContainerTag;
  isBrowserFriendly: boolean;
  releaseTitle?: string;
  infoHash?: string;
}

export interface AggregatedTorrentItem {
  provider: 'YTS' | 'EZTV' | 'APIBay' | 'Torznab';
  title: string;
  name: string;
  infoHash: string;
  trackers?: string[];
  metadata: TorrentMetadata;
}

export interface AggregateTorrentsInput {
  type: StreamMediaType;
  imdbId: string;
  season?: number;
  episode?: number;
  enableBuiltInProviders?: boolean;
  torznabUrl?: string;
  torznabApiKey?: string;
}

const PROVIDER_TIMEOUT_MS = 6000;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function formatBytes(bytes?: number): string | undefined {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

export function extractReleaseTitle(
  filename?: string,
  title?: string,
  description?: string
): string | undefined {
  if (filename && filename.trim()) {
    return filename.trim().split('/').pop()?.trim();
  }
  const firstLine = (title || description || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
}

export function parseTorrentMetadata(
  rawText: string,
  overrides?: Partial<TorrentMetadata>
): TorrentMetadata {
  const norm = normalizeText(rawText);

  // 1. Resolução (4K/2160p, 1080p, 720p, 480p, SD)
  let resolution: ResolutionTag = overrides?.resolution ?? 'SD';
  if (!overrides?.resolution) {
    if (/(?:^|[^a-z0-9])(4k|2160p|uhd)(?:$|[^a-z0-9])/i.test(norm)) {
      resolution = '4K';
    } else if (/(?:^|[^a-z0-9])(1080p|full\s?hd|fhd)(?:$|[^a-z0-9])/i.test(norm)) {
      resolution = '1080p';
    } else if (/(?:^|[^a-z0-9])(720p)(?:$|[^a-z0-9])/i.test(norm)) {
      resolution = '720p';
    } else if (/(?:^|[^a-z0-9])(480p|dvdrip)(?:$|[^a-z0-9])/i.test(norm)) {
      resolution = '480p';
    }
  }

  // 2. Tags de Áudio (incluindo emoji 🇧🇷)
  const audioTags = new Set<string>(overrides?.audioTags ?? []);
  if (rawText.includes('🇧🇷') || /(?:^|[^a-z0-9])(pt-br|ptbr|portugues|nacional)(?:$|[^a-z0-9])/i.test(norm)) {
    audioTags.add('PT-BR');
  }
  if (/(?:^|[^a-z0-9])(dublado|dub)(?:$|[^a-z0-9])/i.test(norm)) {
    audioTags.add('Dublado');
  }
  if (/(?:^|[^a-z0-9])(dual[\s.-]?audio|dual)(?:$|[^a-z0-9])/i.test(norm)) {
    audioTags.add('Dual');
  }
  if (/(?:^|[^a-z0-9])(multi)(?:$|[^a-z0-9])/i.test(norm)) {
    audioTags.add('Multi');
  }
  if (/(?:^|[^a-z0-9])(legendado|subbed)(?:$|[^a-z0-9])/i.test(norm)) {
    audioTags.add('Legendado');
  }

  // 3. Seeders (👤 142 ou S: 142 ou seeders: 142)
  let seeders = overrides?.seeders;
  if (seeders === undefined) {
    const seedMatch =
      rawText.match(/👤\s*(\d+)/) ||
      rawText.match(/(?:^|\s)S:\s*(\d+)/i) ||
      rawText.match(/seed(?:er)?s?[:\s]+(\d+)/i);
    if (seedMatch?.[1]) {
      const parsed = Number.parseInt(seedMatch[1], 10);
      if (Number.isFinite(parsed)) seeders = parsed;
    }
  }

  // 4. Tamanho (ex: 4.32 GB ou 850 MB)
  let size = overrides?.size;
  if (!size) {
    const sizeMatch = rawText.match(/\b(\d+(?:[.,]\d+)?)\s*(GB|MB|GiB|MiB)\b/i);
    if (sizeMatch?.[1] && sizeMatch[2]) {
      const unit = sizeMatch[2].toUpperCase().startsWith('G') ? 'GB' : 'MB';
      size = `${sizeMatch[1].replace(',', '.')} ${unit}`;
    }
  }

  // 5. Container (MP4 / MKV / WEBM)
  let containerTag = overrides?.containerTag;
  if (!containerTag) {
    if (/\.mp4\b/i.test(norm)) containerTag = 'MP4';
    else if (/\.mkv\b/i.test(norm)) containerTag = 'MKV';
    else if (/\.webm\b/i.test(norm)) containerTag = 'WEBM';
  }

  // 6. Compatibilidade com navegador (isBrowserFriendly) e codecHint
  const hasIncompatibleCodec =
    /(?:^|[^a-z0-9])(x265|hevc|h\.?265|10bit|dts|dts-hd|truehd|atmos|remux)(?:$|[^a-z0-9])/i.test(
      norm
    );
  const hasFriendlySignal =
    containerTag === 'MP4' ||
    /(?:^|[^a-z0-9])(yts|yify|x264|h\.?264|avc|mp4)(?:$|[^a-z0-9])/i.test(norm);

  const isBrowserFriendly =
    overrides?.isBrowserFriendly ?? (hasFriendlySignal && !hasIncompatibleCodec);

  let codecHint: CodecHint = overrides?.codecHint ?? 'Desconhecido';
  if (!overrides?.codecHint) {
    if (isBrowserFriendly) {
      codecHint = 'MP4/H264';
    } else if (hasIncompatibleCodec || containerTag === 'MKV') {
      codecHint = 'MKV/HEVC';
    }
  }

  return {
    resolution,
    audioTags: Array.from(audioTags),
    ...(seeders !== undefined ? { seeders } : {}),
    ...(size ? { size } : {}),
    codecHint,
    ...(containerTag ? { containerTag } : {}),
    isBrowserFriendly,
    ...(overrides?.releaseTitle ? { releaseTitle: overrides.releaseTitle } : {}),
    ...(overrides?.infoHash ? { infoHash: overrides.infoHash.trim().toLowerCase() } : {}),
  };
}

async function fetchWithTimeout(url: string, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, application/xml, text/xml, */*' },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface YtsTorrentRaw {
  hash?: string;
  quality?: string;
  type?: string;
  seeds?: number;
  size?: string;
  size_bytes?: number;
}

interface YtsMovieRaw {
  title_long?: string;
  title?: string;
  torrents?: YtsTorrentRaw[];
}

async function queryYtsMovies(imdbId: string): Promise<AggregatedTorrentItem[]> {
  const endpoints = [
    `https://yts.mx/api/v2/movie_details.json?imdb_id=${encodeURIComponent(imdbId)}`,
    `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(imdbId)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: { movie?: YtsMovieRaw; movies?: YtsMovieRaw[] };
      };

      const movie = json.data?.movie ?? json.data?.movies?.[0];
      const torrents = movie?.torrents;
      if (!Array.isArray(torrents) || torrents.length === 0) continue;

      const items: AggregatedTorrentItem[] = [];
      for (const t of torrents) {
        if (!t.hash || !/^[a-f0-9]{40}$/i.test(t.hash)) continue;
        const hash = t.hash.toLowerCase();
        const qualityLabel = t.quality || '1080p';
        const releaseType = t.type ? t.type.toUpperCase() : 'WEB';
        const title = `${movie?.title_long || movie?.title || imdbId} [${qualityLabel} ${releaseType}]`;
        const sizeStr = t.size || formatBytes(t.size_bytes);

        const metadata = parseTorrentMetadata(`${title} ${qualityLabel} YTS MP4 x264`, {
          seeders: typeof t.seeds === 'number' ? t.seeds : undefined,
          size: sizeStr,
          codecHint: 'MP4/H264',
          containerTag: 'MP4',
          isBrowserFriendly: true,
          releaseTitle: title,
          infoHash: hash,
        });

        items.push({
          provider: 'YTS',
          name: `YTS · ${metadata.resolution}`,
          title,
          infoHash: hash,
          metadata,
        });
      }

      if (items.length > 0) {
        console.log(`[torrentAggregator] YTS retornou ${items.length} fontes para ${imdbId}`);
        return items;
      }
    } catch {
      // Tenta o próximo endpoint de fallback
    }
  }

  return [];
}

interface EztvTorrentRaw {
  title?: string;
  filename?: string;
  hash?: string;
  season?: string | number;
  episode?: string | number;
  seeds?: number;
  size_bytes?: string | number;
}

async function queryEztvSeries(
  imdbId: string,
  season = 1,
  episode = 1
): Promise<AggregatedTorrentItem[]> {
  const numericId = imdbId.replace(/^tt/i, '');
  if (!/^\d+$/.test(numericId)) return [];

  const url = `https://eztvx.to/api/get-torrents?imdb_id=${encodeURIComponent(numericId)}&limit=100`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { torrents?: EztvTorrentRaw[] };
    const list = Array.isArray(json.torrents) ? json.torrents : [];

    const items: AggregatedTorrentItem[] = [];
    for (const t of list) {
      if (!t.hash || !/^[a-f0-9]{40}$/i.test(t.hash)) continue;
      const tSeason = Number(t.season);
      const tEpisode = Number(t.episode);
      if (tSeason !== season || tEpisode !== episode) continue;

      const hash = t.hash.toLowerCase();
      const rawTitle = t.title || t.filename || `${imdbId} S${season}E${episode}`;
      const sizeBytes = typeof t.size_bytes === 'string' ? Number(t.size_bytes) : t.size_bytes;

      const metadata = parseTorrentMetadata(`${rawTitle}\n${t.filename ?? ''}`, {
        seeders: typeof t.seeds === 'number' ? t.seeds : undefined,
        size: formatBytes(sizeBytes),
        releaseTitle: extractReleaseTitle(t.filename, rawTitle),
        infoHash: hash,
      });

      items.push({
        provider: 'EZTV',
        name: `EZTV · ${metadata.resolution}`,
        title: rawTitle,
        infoHash: hash,
        metadata,
      });
    }

    console.log(
      `[torrentAggregator] EZTV retornou ${items.length} fontes para ${imdbId} S${season}E${episode}`
    );
    return items;
  } catch {
    return [];
  }
}

function extractXmlTag(block: string, tag: string): string | undefined {
  const regex = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i'
  );
  const match = block.match(regex);
  return (match?.[1] ?? match?.[2])?.trim();
}

function extractTorznabAttr(block: string, attrName: string): string | undefined {
  const regex = new RegExp(
    `<torznab:attr[^>]*name=["']${attrName}["'][^>]*value=["']([^"']+)["']`,
    'i'
  );
  return block.match(regex)?.[1]?.trim();
}

async function queryTorznab(
  baseUrl: string,
  apiKey: string,
  type: StreamMediaType,
  imdbId: string,
  season?: number,
  episode?: number
): Promise<AggregatedTorrentItem[]> {
  const numericId = imdbId.replace(/^tt/i, '');
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl.trim());
  } catch {
    return [];
  }

  endpoint.searchParams.set('apikey', apiKey.trim());
  endpoint.searchParams.set('imdbid', numericId);
  if (type === 'movie') {
    endpoint.searchParams.set('t', 'movie');
  } else {
    endpoint.searchParams.set('t', 'tvsearch');
    if (season) endpoint.searchParams.set('season', String(season));
    if (episode) endpoint.searchParams.set('ep', String(episode));
  }

  try {
    const res = await fetchWithTimeout(endpoint.toString());
    if (!res.ok) return [];
    const xml = await res.text();
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

    const items: AggregatedTorrentItem[] = [];
    for (const block of itemBlocks) {
      const title = extractXmlTag(block, 'title') || imdbId;
      const magnet = extractTorznabAttr(block, 'magneturl') || extractXmlTag(block, 'link') || '';
      const rawHash =
        extractTorznabAttr(block, 'infohash') ||
        magnet.match(/btih:([a-f0-9]{40}|[a-z2-7]{32})/i)?.[1];

      if (!rawHash) continue;
      const hash = rawHash.toLowerCase();

      const seedStr = extractTorznabAttr(block, 'seeders');
      const sizeStr = extractTorznabAttr(block, 'size') || extractXmlTag(block, 'size');
      const seeders = seedStr ? Number.parseInt(seedStr, 10) : undefined;
      const sizeBytes = sizeStr ? Number(sizeStr) : undefined;

      const metadata = parseTorrentMetadata(title, {
        seeders: Number.isFinite(seeders) ? seeders : undefined,
        size: formatBytes(sizeBytes),
        releaseTitle: extractReleaseTitle(undefined, title),
        infoHash: hash,
      });

      items.push({
        provider: 'Torznab',
        name: `Torznab · ${metadata.resolution}`,
        title,
        infoHash: hash,
        metadata,
      });
    }

    console.log(`[torrentAggregator] Torznab retornou ${items.length} fontes para ${imdbId}`);
    return items;
  } catch {
    return [];
  }
}

interface ApiBayRawItem {
  id?: string;
  name?: string;
  info_hash?: string;
  seeders?: string | number;
  size?: string | number;
}

async function queryApiBay(
  type: StreamMediaType,
  imdbId: string,
  season?: number,
  episode?: number
): Promise<AggregatedTorrentItem[]> {
  const url = `https://apibay.org/q.php?q=${encodeURIComponent(imdbId)}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const list = (await res.json()) as ApiBayRawItem[];
    if (!Array.isArray(list)) return [];

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const epRegex =
      type === 'tv' && season && episode
        ? new RegExp(`(?:s0?${season}e0?${episode}|${season}x0?${episode}|s${pad2(season)}e${pad2(episode)})(?!\\d)`, 'i')
        : null;

    const items: AggregatedTorrentItem[] = [];
    for (const raw of list) {
      const hash = (raw.info_hash || '').trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(hash) || /^0{40}$/.test(hash)) continue;

      const seeders = Number.parseInt(String(raw.seeders ?? '0'), 10);
      if (!Number.isFinite(seeders) || seeders <= 0) continue;

      const title = (raw.name || '').trim();
      if (!title) continue;
      if (epRegex && !epRegex.test(title)) continue;

      const sizeBytes = Number(raw.size);
      const metadata = parseTorrentMetadata(title, {
        seeders,
        size: formatBytes(Number.isFinite(sizeBytes) ? sizeBytes : undefined),
        releaseTitle: extractReleaseTitle(undefined, title),
        infoHash: hash,
      });

      items.push({
        provider: 'APIBay',
        name: `APIBay · ${metadata.resolution}`,
        title,
        infoHash: hash,
        metadata,
      });
    }

    if (items.length > 0) {
      console.log(`[torrentAggregator] APIBay retornou ${items.length} fontes para ${imdbId}`);
    }
    return items.slice(0, 20);
  } catch {
    return [];
  }
}

export async function aggregateBuiltInAndTorznab(
  input: AggregateTorrentsInput
): Promise<AggregatedTorrentItem[]> {
  const {
    type,
    imdbId,
    season,
    episode,
    enableBuiltInProviders = true,
    torznabUrl,
    torznabApiKey,
  } = input;

  const tasks: Promise<AggregatedTorrentItem[]>[] = [];

  if (enableBuiltInProviders) {
    if (type === 'movie') {
      tasks.push(queryYtsMovies(imdbId));
    } else {
      tasks.push(queryEztvSeries(imdbId, season ?? 1, episode ?? 1));
    }
    tasks.push(queryApiBay(type, imdbId, season, episode));
  }

  const effectiveTorznabUrl = torznabUrl?.trim() || process.env.TORZNAB_URL?.trim();
  const effectiveTorznabKey = torznabApiKey?.trim() || process.env.TORZNAB_API_KEY?.trim();
  if (effectiveTorznabUrl && effectiveTorznabKey) {
    tasks.push(
      queryTorznab(effectiveTorznabUrl, effectiveTorznabKey, type, imdbId, season, episode)
    );
  }

  if (tasks.length === 0) return [];

  const settled = await Promise.allSettled(tasks);
  const aggregated: AggregatedTorrentItem[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled') {
      aggregated.push(...res.value);
    }
  }

  return aggregated;
}
