import { spawn, spawnSync } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import torrentStream from 'torrent-stream';

interface TorrentFileLike {
  name: string;
  length: number;
  createReadStream: (opts?: { start?: number; end?: number }) => Readable;
}

interface TorrentSwarmLike {
  wires: unknown[];
  downloaded: number;
  downloadSpeed: () => number;
}

interface TorrentEngineLike {
  infoHash: string;
  files: TorrentFileLike[];
  swarm?: TorrentSwarmLike;
  torrent?: { length?: number };
  once: (event: string, listener: (...args: unknown[]) => void) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  remove: (cb?: () => void) => void;
  destroy: (cb?: () => void) => void;
}

export interface TorrentStatusResponse {
  ready: boolean;
  numPeers: number;
  downloadSpeed: number;
  progress: number;
  fileName: string | null;
}

export interface TorrentMetaResponse {
  duration: number;
  isTranscoded: boolean;
  fileName: string;
}

export interface TorrentStreamOptions {
  forceTranscode?: boolean;
  startSeconds?: number;
  localPort?: number;
}

export interface LastStreamError {
  source: 'ffmpeg' | 'torrent' | 'http';
  message: string;
  timestamp: number;
}

// Lista reforçada com 22 trackers públicos estáveis (UDP, HTTP e WSS)
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://public.popcorn-tracker.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://tracker.ccp.ovh:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.gbitt.info:80/announce',
  'https://tracker.tamersunion.org:443/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v']);
const METADATA_TIMEOUT_MS = 30000;

const HEVC_REGEX = /(?:^|[^a-z0-9])(x265|hevc|h\.?265|10bit)(?:$|[^a-z0-9])/i;
const INCOMPATIBLE_CODEC_REGEX =
  /(?:^|[^a-z0-9])(x265|hevc|h\.?265|10bit|ac3|eac3|ddp|dts|dts-hd|truehd|atmos)(?:$|[^a-z0-9])/i;

interface ActiveEngineState {
  infoHash: string;
  engine: TorrentEngineLike;
  ready: boolean;
  readyPromise: Promise<TorrentEngineLike>;
  fileName: string | null;
}

let activeState: ActiveEngineState | null = null;
let lastStreamError: LastStreamError | null = null;
const torrentMetaCache = new Map<string, TorrentMetaResponse>();

let ffmpegChecked = false;
let ffmpegAvailable = false;
let nvencAvailable = false;

function recordStreamError(source: LastStreamError['source'], message: string): void {
  lastStreamError = {
    source,
    message: message.slice(0, 500),
    timestamp: Date.now(),
  };
}

export function getLastStreamError(): LastStreamError | null {
  return lastStreamError;
}

function checkFfmpegCapabilities(): { available: boolean; nvenc: boolean } {
  if (ffmpegChecked) {
    return { available: ffmpegAvailable, nvenc: nvencAvailable };
  }
  ffmpegChecked = true;

  try {
    const versionCheck = spawnSync('ffmpeg', ['-version'], {
      stdio: 'pipe',
      timeout: 3000,
    });
    if (versionCheck.status !== 0 || versionCheck.error) {
      ffmpegAvailable = false;
      nvencAvailable = false;
      console.warn(
        '[torrentStream] FFmpeg não encontrado no PATH — fallback para stream direto sem remux/transcode.'
      );
      return { available: false, nvenc: false };
    }

    ffmpegAvailable = true;

    const encCheck = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: 'pipe',
      timeout: 3000,
    });
    const encOut = encCheck.stdout ? encCheck.stdout.toString('utf-8') : '';
    nvencAvailable = /\bh264_nvenc\b/.test(encOut);
    console.log(
      `[torrentStream] FFmpeg detectado (NVENC ${nvencAvailable ? 'disponível' : 'indisponível'})`
    );
  } catch {
    ffmpegAvailable = false;
    nvencAvailable = false;
    console.warn(
      '[torrentStream] FFmpeg não disponível — fallback para stream direto sem remux/transcode.'
    );
  }

  return { available: ffmpegAvailable, nvenc: nvencAvailable };
}

function destroyEngineSafely(state: ActiveEngineState | null): void {
  if (!state) return;
  console.log(`[torrentStream] Limpando engine anterior e arquivos temporários: ${state.infoHash}`);
  try {
    state.engine.remove(() => {
      try {
        state.engine.destroy();
      } catch {
        // Ignora erro na destruição
      }
    });
  } catch {
    try {
      state.engine.destroy();
    } catch {
      // Ignora erro
    }
  }
}

function buildMagnetUri(infoHash: string, trackers: string[]): string {
  const trParams = trackers.map((tr) => `tr=${encodeURIComponent(tr)}`).join('&');
  return `magnet:?xt=urn:btih:${infoHash}&${trParams}`;
}

async function getOrCreateEngine(
  infoHash: string,
  extraTrackers: string[]
): Promise<TorrentEngineLike> {
  const normalizedHash = infoHash.toLowerCase();

  if (activeState && activeState.infoHash === normalizedHash) {
    return activeState.readyPromise;
  }

  // Ao trocar de infoHash, limpa a engine anterior e seus arquivos temporários no disco
  if (activeState && activeState.infoHash !== normalizedHash) {
    const previous = activeState;
    activeState = null;
    destroyEngineSafely(previous);
  }

  const trackers = Array.from(new Set([...extraTrackers, ...DEFAULT_TRACKERS]));
  const magnetUri = buildMagnetUri(normalizedHash, trackers);

  const engine = torrentStream(magnetUri, {
    dht: true,
    tracker: true,
    trackers,
  }) as unknown as TorrentEngineLike;

  engine.on('error', (err) => {
    console.warn(`[torrentStream] Engine error (${normalizedHash}):`, err);
  });

  const state: ActiveEngineState = {
    infoHash: normalizedHash,
    engine,
    ready: false,
    fileName: null,
    readyPromise: Promise.resolve(engine),
  };

  state.readyPromise = new Promise<TorrentEngineLike>((resolve, reject) => {
    if (engine.files && engine.files.length > 0) {
      state.ready = true;
      resolve(engine);
      return;
    }

    const timer = setTimeout(() => {
      console.warn(`[torrentStream] Timeout de 30s aguardando metadados de ${normalizedHash}`);
      if (activeState === state) {
        activeState = null;
      }
      destroyEngineSafely(state);
      reject(new Error('METADATA_TIMEOUT'));
    }, METADATA_TIMEOUT_MS);

    engine.once('ready', () => {
      clearTimeout(timer);
      state.ready = true;
      resolve(engine);
    });

    engine.once('error', (err) => {
      clearTimeout(timer);
      if (activeState === state) {
        activeState = null;
      }
      destroyEngineSafely(state);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

  activeState = state;
  return state.readyPromise;
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function getVideoMimeType(filename: string): string {
  switch (getFileExtension(filename)) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.avi':
      return 'video/x-msvideo';
    case '.mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}

function shouldUseFfmpeg(filename: string, forceTranscode: boolean): boolean {
  if (forceTranscode) return true;
  const ext = getFileExtension(filename);
  if (ext === '.mkv' || ext === '.avi' || ext === '.mov') return true;
  if (INCOMPATIBLE_CODEC_REGEX.test(filename)) return true;
  return ext !== '.mp4' && ext !== '.m4v' && ext !== '.webm';
}

function selectVideoFile(files: TorrentFileLike[], fileIdxParam: string): TorrentFileLike | null {
  if (files.length === 0) return null;

  if (fileIdxParam !== 'auto') {
    const idx = Number(fileIdxParam);
    if (Number.isInteger(idx) && idx >= 0 && idx < files.length) {
      return files[idx] ?? null;
    }
  }

  const videoFiles = files.filter((file) => VIDEO_EXTENSIONS.has(getFileExtension(file.name)));
  const candidates = videoFiles.length > 0 ? videoFiles : files;

  return candidates.reduce<TorrentFileLike | null>((largest, current) => {
    if (!largest || current.length > largest.length) return current;
    return largest;
  }, null);
}

function serveRawTorrentFile(
  file: TorrentFileLike,
  engine: TorrentEngineLike,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const totalSize = file.length;
  const contentType = getVideoMimeType(file.name);
  const rangeHeader = request.headers.range;
  const numPeers = engine.swarm?.wires?.length ?? 0;

  console.log(
    `[torrentRaw] Servindo "${file.name}" (${contentType}, ${(
      totalSize /
      (1024 * 1024)
    ).toFixed(1)} MB) · peers=${numPeers} · range=${rangeHeader ?? 'full'}`
  );

  if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
    const [rawStart, rawEnd] = rangeHeader.replace('bytes=', '').split('-');
    const start = rawStart ? Number.parseInt(rawStart, 10) : 0;
    const end = rawEnd ? Number.parseInt(rawEnd, 10) : totalSize - 1;

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end >= totalSize ||
      start > end
    ) {
      return reply
        .status(416)
        .header('Content-Range', `bytes */${totalSize}`)
        .send();
    }

    const chunkSize = end - start + 1;
    const readStream = file.createReadStream({ start, end });

    request.raw.on('close', () => {
      if (!readStream.destroyed) {
        readStream.destroy();
      }
    });

    return reply
      .status(206)
      .header('Content-Range', `bytes ${start}-${end}/${totalSize}`)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(chunkSize))
      .header('Content-Type', contentType)
      .header('Access-Control-Allow-Origin', '*')
      .send(readStream);
  }

  const readStream = file.createReadStream();

  request.raw.on('close', () => {
    if (!readStream.destroyed) {
      readStream.destroy();
    }
  });

  return reply
    .status(200)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', String(totalSize))
    .header('Content-Type', contentType)
    .header('Access-Control-Allow-Origin', '*')
    .send(readStream);
}

async function probeDurationSeconds(inputHttpUrl: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputHttpUrl,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    let out = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignora
      }
      resolve(0);
    }, 12000);

    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8');
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(0);
    });

    proc.on('close', () => {
      clearTimeout(timer);
      const parsed = Number.parseFloat(out.trim());
      resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    });
  });
}

export async function getTorrentMeta(
  infoHash: string,
  fileIdxParam: string,
  extraTrackers: string[],
  localPort = 3001
): Promise<TorrentMetaResponse> {
  const normalizedHash = infoHash.toLowerCase();
  const cacheKey = `${normalizedHash}:${fileIdxParam || 'auto'}`;
  const cached = torrentMetaCache.get(cacheKey);
  if (cached) return cached;

  const engine = await getOrCreateEngine(normalizedHash, extraTrackers);
  const file = selectVideoFile(engine.files, fileIdxParam);
  if (!file) {
    throw new Error('NO_VIDEO_FILE');
  }

  if (activeState && activeState.infoHash === normalizedHash) {
    activeState.fileName = file.name;
  }

  const caps = checkFfmpegCapabilities();
  const isTranscoded = caps.available && shouldUseFfmpeg(file.name, false);

  const qs = new URLSearchParams();
  for (const tr of extraTrackers) qs.append('tr', tr);
  const querySuffix = qs.toString() ? `?${qs.toString()}` : '';
  const rawUrl = `http://127.0.0.1:${localPort}/api/torrent-raw/${normalizedHash}/${encodeURIComponent(
    fileIdxParam || 'auto'
  )}${querySuffix}`;

  const duration = caps.available ? await probeDurationSeconds(rawUrl) : 0;
  const meta: TorrentMetaResponse = {
    duration,
    isTranscoded,
    fileName: file.name,
  };

  if (duration > 0) {
    torrentMetaCache.set(cacheKey, meta);
  }

  return meta;
}

async function probePreferredAudioIndex(inputHttpUrl: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index:stream_tags=language',
        '-of',
        'json',
        inputHttpUrl,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    let out = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignora
      }
      resolve(0);
    }, 4000);

    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8');
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(0);
    });

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as {
          streams?: { tags?: { language?: string } }[];
        };
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const ptIdx = streams.findIndex((s) => {
          const lang = (s.tags?.language || '').toLowerCase();
          return lang === 'por' || lang === 'pob' || lang === 'pt' || lang === 'pt-br';
        });
        resolve(ptIdx >= 0 ? ptIdx : 0);
      } catch {
        resolve(0);
      }
    });
  });
}

function buildFfmpegHttpArgs(
  inputHttpUrl: string,
  filename: string,
  useNvenc: boolean,
  audioIndex: number,
  startSeconds?: number
): string[] {
  const isHevc = HEVC_REGEX.test(filename);
  const args: string[] = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-probesize',
    '10M',
    '-analyzeduration',
    '10M',
  ];

  if (startSeconds && Number.isFinite(startSeconds) && startSeconds > 0) {
    args.push('-ss', String(Math.floor(startSeconds)));
  }

  args.push('-i', inputHttpUrl);
  args.push('-map', '0:v:0', '-map', `0:a:${audioIndex}?`);

  if (isHevc) {
    if (useNvenc) {
      args.push(
        '-c:v',
        'h264_nvenc',
        '-preset',
        'p1',
        '-tune',
        'll',
        '-pix_fmt',
        'yuv420p',
        '-b:v',
        '4500k'
      );
    } else {
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p'
      );
    }
  } else {
    args.push('-c:v', 'copy');
  }

  args.push(
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ac',
    '2',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1'
  );

  return args;
}

async function streamViaFfmpegHttp(
  inputHttpUrl: string,
  filename: string,
  request: FastifyRequest,
  reply: FastifyReply,
  allowNvenc: boolean,
  startSeconds?: number
) {
  const audioIndex = await probePreferredAudioIndex(inputHttpUrl);
  const output = new PassThrough();
  let activeProc: ReturnType<typeof spawn> | null = null;
  let clientClosed = false;
  let sentAnyBytes = false;
  let lastStderr = '';

  const killActiveProc = () => {
    if (activeProc && !activeProc.killed) {
      try {
        activeProc.kill('SIGKILL');
      } catch {
        // Ignora erro caso já tenha encerrado
      }
    }
  };

  request.raw.on('close', () => {
    clientClosed = true;
    killActiveProc();
    if (!output.destroyed) {
      output.destroy();
    }
  });

  const launchFfmpeg = (useNvenc: boolean) => {
    if (clientClosed) return;

    const isHevc = HEVC_REGEX.test(filename);
    const args = buildFfmpegHttpArgs(inputHttpUrl, filename, useNvenc, audioIndex, startSeconds);
    const modeLabel = isHevc
      ? useNvenc
        ? 'HEVC->NVENC'
        : 'HEVC->libx264'
      : 'Remux->MP4/AAC';

    const startSec = startSeconds && startSeconds > 0 ? Math.floor(startSeconds) : 0;
    console.log(
      `[FFmpeg] Iniciando em ${startSec}s (${modeLabel}, audio#${audioIndex}) para "${filename}"`
    );

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeProc = proc;

    proc.stdout.on('data', (chunk: Buffer) => {
      sentAnyBytes = true;
      if (!output.destroyed) {
        output.write(chunk);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf-8').trim();
      if (msg) {
        lastStderr = msg;
        console.warn(`[ffmpeg] ${msg}`);
      }
    });

    proc.on('error', (err) => {
      recordStreamError('ffmpeg', `Erro ao iniciar FFmpeg: ${err.message}`);
      console.error('[torrentStream] Erro ao iniciar FFmpeg:', err.message);
      if (!output.destroyed) output.end();
    });

    proc.on('close', (code) => {
      if (clientClosed) return;

      if (isHevc && useNvenc && code !== 0 && !sentAnyBytes) {
        console.warn(
          '[torrentStream] h264_nvenc falhou — fazendo fallback automático para libx264 (yuv420p)'
        );
        nvencAvailable = false;
        launchFfmpeg(false);
        return;
      }

      if (code && code !== 0) {
        const reason = lastStderr || `FFmpeg encerrou com código ${code}`;
        recordStreamError('ffmpeg', reason);
        console.warn(`[torrentStream] FFmpeg encerrou com código ${code} para "${filename}"`);
      }

      if (!output.destroyed) {
        output.end();
      }
    });
  };

  launchFfmpeg(allowNvenc);

  return reply
    .status(200)
    .header('Content-Type', 'video/mp4')
    .header('Cache-Control', 'no-store')
    .header('Access-Control-Allow-Origin', '*')
    .send(output);
}

export async function getTorrentStatus(infoHash: string): Promise<TorrentStatusResponse> {
  const normalized = infoHash.toLowerCase();
  if (!activeState || activeState.infoHash !== normalized) {
    return { ready: false, numPeers: 0, downloadSpeed: 0, progress: 0, fileName: null };
  }

  const { engine, ready } = activeState;
  const numPeers = engine.swarm?.wires?.length ?? 0;
  const downloadSpeed =
    typeof engine.swarm?.downloadSpeed === 'function' ? engine.swarm.downloadSpeed() : 0;

  const totalLength = engine.torrent?.length ?? 0;
  const downloaded = engine.swarm?.downloaded ?? 0;
  const progress = totalLength > 0 ? Math.min(1, downloaded / totalLength) : 0;

  const fileName =
    activeState.fileName ??
    (engine.files && engine.files.length > 0
      ? selectVideoFile(engine.files, 'auto')?.name ?? null
      : null);

  return {
    ready,
    numPeers,
    downloadSpeed,
    progress,
    fileName,
  };
}

/**
 * Rota 1: GET /api/torrent-raw/:infoHash/:fileIdx
 * Serve o arquivo bruto do torrent-stream com suporte completo a Range (206 Partial Content), sem FFmpeg.
 */
export async function handleTorrentRaw(
  infoHash: string,
  fileIdxParam: string,
  extraTrackers: string[],
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  if (!/^([a-f0-9]{40}|[a-z2-7]{32})$/i.test(infoHash)) {
    return reply.status(400).send({ error: 'infoHash inválido.' });
  }

  const normalizedHash = infoHash.toLowerCase();

  try {
    const engine = await getOrCreateEngine(normalizedHash, extraTrackers);
    const file = selectVideoFile(engine.files, fileIdxParam);

    if (!file) {
      return reply.status(404).send({ error: 'Nenhum arquivo de vídeo encontrado no torrent.' });
    }

    if (activeState && activeState.infoHash === normalizedHash) {
      activeState.fileName = file.name;
    }

    return serveRawTorrentFile(file, engine, request, reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordStreamError('torrent', msg);
    console.error(`[torrentRaw] Erro ao servir ${normalizedHash}: ${msg}`);
    if (msg === 'METADATA_TIMEOUT') {
      return reply.status(504).send({
        error: 'Tempo esgotado (30s) aguardando peers/metadados do torrent.',
      });
    }
    return reply.status(502).send({ error: 'Falha ao reproduzir torrent P2P.' });
  }
}

/**
 * Rota 2: GET /api/torrent-stream/:infoHash/:fileIdx
 * Serve direto do raw se for MP4 compatível, ou faz remux/transcode com FFmpeg lendo de /api/torrent-raw via HTTP.
 */
export async function handleTorrentStream(
  infoHash: string,
  fileIdxParam: string,
  extraTrackers: string[],
  request: FastifyRequest,
  reply: FastifyReply,
  options: TorrentStreamOptions = {}
): Promise<unknown> {
  if (!/^([a-f0-9]{40}|[a-z2-7]{32})$/i.test(infoHash)) {
    return reply.status(400).send({ error: 'infoHash inválido.' });
  }

  const normalizedHash = infoHash.toLowerCase();

  try {
    const engine = await getOrCreateEngine(normalizedHash, extraTrackers);
    const file = selectVideoFile(engine.files, fileIdxParam);

    if (!file) {
      console.warn(`[torrentStream] Nenhum arquivo de vídeo no torrent ${normalizedHash}`);
      return reply.status(404).send({ error: 'Nenhum arquivo de vídeo encontrado no torrent.' });
    }

    if (activeState && activeState.infoHash === normalizedHash) {
      activeState.fileName = file.name;
    }

    const wantsFfmpeg = shouldUseFfmpeg(file.name, Boolean(options.forceTranscode));
    if (wantsFfmpeg) {
      const caps = checkFfmpegCapabilities();
      if (caps.available) {
        const port = options.localPort ?? 3001;
        const qs = new URLSearchParams();
        for (const tr of extraTrackers) qs.append('tr', tr);
        const querySuffix = qs.toString() ? `?${qs.toString()}` : '';
        const rawInputUrl = `http://127.0.0.1:${port}/api/torrent-raw/${normalizedHash}/${encodeURIComponent(
          fileIdxParam || 'auto'
        )}${querySuffix}`;

        return streamViaFfmpegHttp(
          rawInputUrl,
          file.name,
          request,
          reply,
          caps.nvenc,
          options.startSeconds
        );
      }
    }

    return serveRawTorrentFile(file, engine, request, reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordStreamError('torrent', msg);
    console.error(`[torrentStream] Erro ao reproduzir ${normalizedHash}: ${msg}`);
    if (msg === 'METADATA_TIMEOUT') {
      return reply.status(504).send({
        error: 'Tempo esgotado (30s) aguardando peers/metadados do torrent.',
      });
    }
    return reply.status(502).send({ error: 'Falha ao reproduzir torrent P2P.' });
  }
}
