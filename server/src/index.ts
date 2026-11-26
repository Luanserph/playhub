import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getAddonDirectory, syncAddonLists } from './services/addonLists';
import {
  mergeAndSaveStore,
  readStore,
  type PlayHubStoreData,
} from './services/configStore';
import { handleStreamProxy } from './services/streamProxy';
import { resolveStreams, type StreamMediaType } from './services/streamResolver';
import { handleTmdbImageProxy, handleTmdbProxy } from './services/tmdbProxy';
import {
  getCachedSubtitle,
  resolveSubtitle,
  shiftVttByOffset,
} from './services/subtitleService';
import {
  getLastStreamError,
  getTorrentMeta,
  getTorrentStatus,
  handleTorrentRaw,
  handleTorrentStream,
} from './services/torrentStream';
import { generateNeuralTts, type TtsVoiceKey } from './services/ttsService';

// Carrega .env se disponível no runtime Node (sem depender de pacotes extras)
try {
  const nodeProcess = process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  };
  nodeProcess.loadEnvFile?.();
} catch {
  // .env opcional
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

interface ResolveBody {
  type?: string;
  imdbId?: string;
  season?: number;
  episode?: number;
  preferPtBr?: boolean;
  autoTranslate?: boolean;
  addons?: string[];
  enableBuiltInProviders?: boolean;
  torznabUrl?: string;
  torznabApiKey?: string;
  lang?: string;
  iso2?: string;
  openSubCodes?: string[];
}

interface SubtitleQuery {
  type?: string;
  imdbId?: string;
  season?: string;
  episode?: string;
  autoTranslate?: string;
  lang?: string;
  iso2?: string;
  openSubCodes?: string;
  offset?: string;
}

function parseMediaType(raw?: string): StreamMediaType | null {
  if (raw === 'movie' || raw === 'tv') return raw;
  if (raw === 'series') return 'tv';
  return null;
}

function parseOptionalInt(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

function parseOpenSubCodes(raw?: string | string[]): string[] | undefined {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((c) => c.trim().toLowerCase()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const cleaned = raw
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  return undefined;
}

function buildVttUrl(
  type: StreamMediaType,
  imdbId: string,
  season?: number,
  episode?: number,
  autoTranslate = true,
  lang = 'pt-BR',
  iso2 = 'pt',
  openSubCodes?: string[]
): string {
  const params = new URLSearchParams({
    type,
    imdbId,
    autoTranslate: String(autoTranslate),
    lang,
    iso2,
  });
  if (openSubCodes && openSubCodes.length > 0) {
    params.set('openSubCodes', openSubCodes.join(','));
  }
  if (type === 'tv') {
    params.set('season', String(season ?? 1));
    params.set('episode', String(episode ?? 1));
  }
  return `/api/subtitles/vtt?${params.toString()}`;
}

async function start() {
  const app = Fastify({
    logger: true,
  });

  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'tauri://localhost',
    'http://tauri.localhost',
    'capacitor://localhost',
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : []),
  ];

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  });

  // 1. Healthcheck
  app.get('/api/health', async () => {
    return { ok: true };
  });

  // 1b. Persistência unificada em disco (server/data/store.json)
  app.get('/api/config', async () => {
    return readStore();
  });

  app.put<{ Body: Partial<PlayHubStoreData> }>('/api/config', async (request) => {
    const body = request.body ?? {};
    return mergeAndSaveStore(body);
  });

  // 1c. Sincronização de listas remotas de Add-ons + Diretório Público Comunitário
  app.post<{ Body: { listUrls?: string[] } }>('/api/addons/sync-lists', async (request) => {
    const listUrls = Array.isArray(request.body?.listUrls)
      ? request.body.listUrls.filter((u): u is string => typeof u === 'string')
      : undefined;
    return syncAddonLists(listUrls);
  });

  app.get('/api/addons/directory', async () => {
    const items = await getAddonDirectory();
    return { addons: items };
  });

  // 1d. Diagnóstico do último erro técnico do backend/FFmpeg
  app.get('/api/debug/last-error', async () => {
    return { error: getLastStreamError() };
  });

  // 1e. Proxy server-side para TMDB (evita 403 por Origin de navegador + cache 10 min)
  app.get<{ Params: { '*': string } }>('/api/tmdb/*', async (request, reply) => {
    return handleTmdbProxy(request.params['*'] || '', request, reply);
  });

  // 1f. Proxy server-side de imagens do TMDB (com validação de tamanho + cache LRU de 300 itens)
  app.get<{ Params: { '*': string } }>('/api/tmdb-image/*', async (request, reply) => {
    return handleTmdbImageProxy(request.params['*'] || '', request, reply);
  });

  // 2. Resolução unificada de Streams (HTTP + Torrent P2P) + Legenda PT-BR automática
  app.post<{ Body: ResolveBody }>('/api/resolve', async (request, reply) => {
    const body = request.body ?? {};
    const type = parseMediaType(body.type);
    const imdbId = typeof body.imdbId === 'string' ? body.imdbId.trim() : '';

    if (!type || !/^tt\d{7,9}$/i.test(imdbId)) {
      return reply.status(400).send({
        error:
          'Parâmetros inválidos. Informe type ("movie" | "tv") e imdbId válido (ex: tt0371746).',
      });
    }

    const season = type === 'tv' ? (parseOptionalInt(body.season) ?? 1) : undefined;
    const episode = type === 'tv' ? (parseOptionalInt(body.episode) ?? 1) : undefined;
    const preferPtBr = body.preferPtBr !== false;
    const autoTranslate = body.autoTranslate !== false;
    const lang = typeof body.lang === 'string' && body.lang.trim() ? body.lang.trim() : 'pt-BR';
    const iso2 = typeof body.iso2 === 'string' && body.iso2.trim() ? body.iso2.trim() : undefined;
    const openSubCodes = parseOpenSubCodes(body.openSubCodes);
    const addons = Array.isArray(body.addons)
      ? body.addons.filter((a): a is string => typeof a === 'string')
      : [];
    const enableBuiltInProviders = body.enableBuiltInProviders !== false;
    const torznabUrl =
      typeof body.torznabUrl === 'string' ? body.torznabUrl.trim() : undefined;
    const torznabApiKey =
      typeof body.torznabApiKey === 'string' ? body.torznabApiKey.trim() : undefined;

    const hostHeader = request.headers.host || `localhost:${PORT}`;
    const protocol = request.protocol || 'http';
    const serverOrigin = `${protocol}://${hostHeader}`;

    const [streamResult, subtitleEntry] = await Promise.all([
      resolveStreams({
        type,
        imdbId,
        season,
        episode,
        preferPtBr,
        addons,
        enableBuiltInProviders,
        torznabUrl,
        torznabApiKey,
        serverOrigin,
      }),
      resolveSubtitle({
        type,
        imdbId,
        season,
        episode,
        autoTranslate,
        lang,
        iso2,
        openSubCodes,
      }),
    ]);

    const subtitleUrl =
      subtitleEntry.status !== 'none' && subtitleEntry.vtt
        ? buildVttUrl(
            type,
            imdbId,
            season,
            episode,
            autoTranslate,
            subtitleEntry.language,
            iso2 ?? subtitleEntry.language.slice(0, 2).toLowerCase(),
            openSubCodes
          )
        : null;

    return {
      streams: streamResult.streams,
      ...(streamResult.reason ? { reason: streamResult.reason } : {}),
      subtitle: {
        status: subtitleEntry.status,
        language: subtitleEntry.language,
        url: subtitleUrl,
      },
    };
  });

  // 3. Metadados de legenda automática
  app.get<{ Querystring: SubtitleQuery }>('/api/subtitles', async (request, reply) => {
    const q = request.query;
    const type = parseMediaType(q.type);
    const imdbId = typeof q.imdbId === 'string' ? q.imdbId.trim() : '';

    if (!type || !/^tt\d{7,9}$/i.test(imdbId)) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos. Informe type ("movie" | "tv") e imdbId válido.',
      });
    }

    const season = type === 'tv' ? (parseOptionalInt(q.season) ?? 1) : undefined;
    const episode = type === 'tv' ? (parseOptionalInt(q.episode) ?? 1) : undefined;
    const autoTranslate = q.autoTranslate !== 'false';
    const lang = typeof q.lang === 'string' && q.lang.trim() ? q.lang.trim() : 'pt-BR';
    const iso2 = typeof q.iso2 === 'string' && q.iso2.trim() ? q.iso2.trim() : undefined;
    const openSubCodes = parseOpenSubCodes(q.openSubCodes);

    const hadCache = Boolean(getCachedSubtitle(imdbId, season, episode, lang));
    const entry = await resolveSubtitle({
      type,
      imdbId,
      season,
      episode,
      autoTranslate,
      lang,
      iso2,
      openSubCodes,
    });

    return {
      status: entry.status,
      language: entry.language,
      cached: hadCache,
      url:
        entry.status !== 'none' && entry.vtt
          ? buildVttUrl(
              type,
              imdbId,
              season,
              episode,
              autoTranslate,
              entry.language,
              iso2 ?? entry.language.slice(0, 2).toLowerCase(),
              openSubCodes
            )
          : null,
    };
  });

  // 4. Proxy / entrega de WebVTT (sem erro de CORS)
  app.get<{ Querystring: SubtitleQuery }>('/api/subtitles/vtt', async (request, reply) => {
    const q = request.query;
    const type = parseMediaType(q.type);
    const imdbId = typeof q.imdbId === 'string' ? q.imdbId.trim() : '';

    if (!type || !/^tt\d{7,9}$/i.test(imdbId)) {
      return reply.status(400).type('text/plain; charset=utf-8').send('Parâmetros inválidos.');
    }

    const season = type === 'tv' ? (parseOptionalInt(q.season) ?? 1) : undefined;
    const episode = type === 'tv' ? (parseOptionalInt(q.episode) ?? 1) : undefined;
    const autoTranslate = q.autoTranslate !== 'false';
    const lang = typeof q.lang === 'string' && q.lang.trim() ? q.lang.trim() : 'pt-BR';
    const iso2 = typeof q.iso2 === 'string' && q.iso2.trim() ? q.iso2.trim() : undefined;
    const openSubCodes = parseOpenSubCodes(q.openSubCodes);

    const entry =
      getCachedSubtitle(imdbId, season, episode, lang) ??
      (await resolveSubtitle({
        type,
        imdbId,
        season,
        episode,
        autoTranslate,
        lang,
        iso2,
        openSubCodes,
      }));

    if (!entry.vtt) {
      return reply.status(404).type('text/plain; charset=utf-8').send('Legenda não encontrada.');
    }

    const offsetSec = q.offset ? Number(q.offset) : 0;
    const outputVtt =
      Number.isFinite(offsetSec) && offsetSec > 0
        ? shiftVttByOffset(entry.vtt, offsetSec)
        : entry.vtt;

    return reply
      .header('Content-Type', 'text/vtt; charset=utf-8')
      .header('Cache-Control', offsetSec > 0 ? 'no-cache' : 'public, max-age=3600')
      .send(outputVtt);
  });

  // 5. Proxy Anti-CORS para streams HLS (.m3u8 + reescrita) e MP4 (Range + headers base64)
  app.get<{ Querystring: { url?: string; headers?: string } }>(
    '/api/proxy',
    async (request, reply) => {
      const targetUrl = typeof request.query.url === 'string' ? request.query.url.trim() : '';
      const encodedHeaders =
        typeof request.query.headers === 'string' ? request.query.headers.trim() : undefined;

      if (!targetUrl) {
        return reply.status(400).send({ error: 'Informe o parâmetro ?url=...' });
      }

      const hostHeader = request.headers.host || `localhost:${PORT}`;
      const protocol = request.protocol || 'http';
      const proxyOrigin = `${protocol}://${hostHeader}`;

      return handleStreamProxy(targetUrl, request, reply, proxyOrigin, encodedHeaders);
    }
  );

  // 6a. Streaming bruto do WebTorrent com suporte completo a Range (usado direto e como entrada HTTP do FFmpeg)
  app.get<{
    Params: { infoHash: string; fileIdx: string };
    Querystring: { tr?: string | string[] };
  }>('/api/torrent-raw/:infoHash/:fileIdx', async (request, reply) => {
    const { infoHash, fileIdx } = request.params;
    const rawTrackers = request.query.tr;
    const extraTrackers = Array.isArray(rawTrackers)
      ? rawTrackers.filter((t): t is string => typeof t === 'string')
      : typeof rawTrackers === 'string'
        ? [rawTrackers]
        : [];

    return handleTorrentRaw(infoHash, fileIdx || 'auto', extraTrackers, request, reply);
  });

  // 6b. Streaming P2P local via WebTorrent + remux/transcode FFmpeg lendo de /api/torrent-raw via HTTP
  app.get<{
    Params: { infoHash: string; fileIdx: string };
    Querystring: { tr?: string | string[]; transcode?: string; start?: string };
  }>('/api/torrent-stream/:infoHash/:fileIdx', async (request, reply) => {
    const { infoHash, fileIdx } = request.params;
    const rawTrackers = request.query.tr;
    const extraTrackers = Array.isArray(rawTrackers)
      ? rawTrackers.filter((t): t is string => typeof t === 'string')
      : typeof rawTrackers === 'string'
        ? [rawTrackers]
        : [];

    const forceTranscode =
      request.query.transcode === '1' || request.query.transcode === 'true';
    const rawStart = request.query.start ? Number(request.query.start) : undefined;
    const startSeconds =
      rawStart !== undefined && Number.isFinite(rawStart) && rawStart > 0 ? rawStart : undefined;

    return handleTorrentStream(infoHash, fileIdx || 'auto', extraTrackers, request, reply, {
      forceTranscode,
      startSeconds,
      localPort: PORT,
    });
  });

  // 6c. Metadados de duração e transcode via ffprobe (com cache por infoHash)
  app.get<{
    Params: { infoHash: string; fileIdx: string };
    Querystring: { tr?: string | string[] };
  }>('/api/torrent-meta/:infoHash/:fileIdx', async (request, reply) => {
    const { infoHash, fileIdx } = request.params;
    if (!/^([a-f0-9]{40}|[a-z2-7]{32})$/i.test(infoHash)) {
      return reply.status(400).send({ error: 'infoHash inválido.' });
    }
    const rawTrackers = request.query.tr;
    const extraTrackers = Array.isArray(rawTrackers)
      ? rawTrackers.filter((t): t is string => typeof t === 'string')
      : typeof rawTrackers === 'string'
        ? [rawTrackers]
        : [];

    try {
      return await getTorrentMeta(infoHash, fileIdx || 'auto', extraTrackers, PORT);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'METADATA_TIMEOUT') {
        return reply.status(504).send({ error: 'Timeout aguardando metadados do torrent.' });
      }
      return reply.status(502).send({ error: 'Falha ao obter duração do torrent.' });
    }
  });

  // 6d. Status em tempo real de peers / download do torrent ativo
  app.get<{ Params: { infoHash: string } }>(
    '/api/torrent-status/:infoHash',
    async (request, reply) => {
      const { infoHash } = request.params;
      if (!/^([a-f0-9]{40}|[a-z2-7]{32})$/i.test(infoHash)) {
        return reply.status(400).send({ error: 'infoHash inválido.' });
      }
      return getTorrentStatus(infoHash);
    }
  );

  // 7. Dublagem Neural (msedge-tts com suporte a voiceName dinâmico + cache LRU em memória)
  app.get<{ Querystring: { text?: string; voice?: string; voiceName?: string } }>(
    '/api/tts',
    async (request, reply) => {
      const text = typeof request.query.text === 'string' ? request.query.text.trim() : '';
      const voice: TtsVoiceKey = request.query.voice === 'male' ? 'male' : 'female';
      const voiceName =
        typeof request.query.voiceName === 'string' ? request.query.voiceName.trim() : undefined;

      if (!text) {
        return reply.status(400).send({ error: 'Informe o parâmetro ?text=...' });
      }

      try {
        const audioBuffer = await generateNeuralTts(text, voice, voiceName);
        return reply
          .status(200)
          .header('Content-Type', 'audio/mpeg')
          .header('Content-Length', String(audioBuffer.length))
          .header('Cache-Control', 'public, max-age=86400')
          .send(audioBuffer);
      } catch (err) {
        request.log.error({ err }, 'Falha na síntese TTS neural');
        return reply.status(502).send({ error: 'Falha ao gerar áudio de dublagem neural.' });
      }
    }
  );

  try {
    await app.listen({ port: PORT, host: HOST });
    // Sincroniza listas remotas de add-ons em segundo plano ao iniciar o servidor
    void syncAddonLists().catch((err) => {
      app.log.warn({ err }, 'Falha no sync inicial de listas remotas de add-ons');
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
