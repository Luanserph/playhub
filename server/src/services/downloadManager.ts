import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import torrentStream from 'torrent-stream';
import { readStore } from './configStore';
import { resolveSubtitle, shiftVttByOffset, srtToVtt } from './subtitleService';
import { getDataDir, resolveBinaryPath } from '../utils/paths';

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadRecord {
  id: string;
  imdbId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  season?: number;
  episode?: number;
  posterPath: string | null;
  backdropPath: string | null;
  quality?: string;
  infoHash: string;
  magnetUri?: string;
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

export interface StartDownloadInput {
  imdbId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
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

interface BitfieldLike {
  get: (index: number) => boolean;
}

interface TorrentFileLike {
  name: string;
  path: string;
  offset: number;
  length: number;
  select: () => void;
  deselect?: () => void;
}

interface TorrentEngineLike {
  files: TorrentFileLike[];
  bitfield?: BitfieldLike;
  torrent?: { pieceLength?: number; pieces?: unknown[] };
  swarm?: {
    wires?: unknown[];
    downloadSpeed?: () => number;
  };
  once: (event: string, cb: (...args: unknown[]) => void) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  destroy: (cb?: () => void) => void;
}

interface ActiveDownloadJob {
  engine: TorrentEngineLike;
  file: TorrentFileLike | null;
  pollTimer: ReturnType<typeof setInterval>;
}

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.bittorrent.pw:1337/announce',
  'udp://public.popcorn-tracker.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'https://tracker.tamersunion.org:443/announce',
  'wss://tracker.openwebtorrent.com',
];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v']);
const INCOMPATIBLE_CODEC_REGEX =
  /(?:^|[^a-z0-9])(x265|hevc|h\.?265|10bit|ac3|eac3|ddp|dts|dts-hd|truehd|atmos)(?:$|[^a-z0-9])/i;

function getDownloadsDbPath(): string {
  return path.join(getDataDir(), 'downloads.json');
}

const downloadsMap = new Map<string, DownloadRecord>();
const activeJobs = new Map<string, ActiveDownloadJob>();

let ffmpegChecked = false;
let ffmpegAvailable = false;
let nvencAvailable = false;

function checkFfmpeg(): { available: boolean; nvenc: boolean } {
  if (ffmpegChecked) return { available: ffmpegAvailable, nvenc: nvencAvailable };
  ffmpegChecked = true;
  const ffmpegBin = resolveBinaryPath('ffmpeg');
  try {
    const ver = spawnSync(ffmpegBin, ['-version'], { stdio: 'pipe', timeout: 3000 });
    if (ver.status === 0 && !ver.error) {
      ffmpegAvailable = true;
      const enc = spawnSync(ffmpegBin, ['-hide_banner', '-encoders'], { stdio: 'pipe', timeout: 3000 });
      nvencAvailable = /\bh264_nvenc\b/.test(enc.stdout?.toString('utf-8') || '');
    }
  } catch {
    ffmpegAvailable = false;
    nvencAvailable = false;
  }
  return { available: ffmpegAvailable, nvenc: nvencAvailable };
}

export function getDefaultDownloadDir(): string {
  return path.join(os.homedir(), 'Downloads', 'PlayHub');
}

export function getResolvedDownloadDir(): string {
  const store = readStore();
  const custom =
    typeof store.preferences?.downloadDir === 'string'
      ? store.preferences.downloadDir.trim()
      : '';
  const target = custom || getDefaultDownloadDir();
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
  } catch {
    const fallback = getDefaultDownloadDir();
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  }
  return target;
}

function persistDownloads(): void {
  const dbPath = getDownloadsDbPath();
  const list = Array.from(downloadsMap.values()).sort((a, b) => b.createdAt - a.createdAt);
  const tmpPath = `${dbPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(list, null, 2), 'utf-8');
  fs.renameSync(tmpPath, dbPath);
}

function loadDownloadsFromDisk(): void {
  const dbPath = getDownloadsDbPath();
  if (!fs.existsSync(dbPath)) return;
  try {
    const raw = fs.readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof (item as DownloadRecord).id !== 'string') {
        continue;
      }
      const rec = item as DownloadRecord;
      // Ao reiniciar o servidor, downloads que estavam em andamento ficam pausados prontos para retomar
      if (rec.status === 'downloading' || rec.status === 'queued') {
        rec.status = 'paused';
        rec.speed = 0;
        rec.peers = 0;
      }
      downloadsMap.set(rec.id, rec);
    }
  } catch (err) {
    console.warn('[downloadManager] Falha ao carregar downloads.json:', err);
  }
}

loadDownloadsFromDisk();

function extractInfoHashFromMagnet(magnetUri?: string): string {
  if (!magnetUri) return '';
  const match = magnetUri.match(/xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})/i);
  return match?.[1]?.toLowerCase() ?? '';
}

function buildMagnetUri(infoHash: string, rawMagnet?: string): string {
  if (rawMagnet && rawMagnet.startsWith('magnet:?')) return rawMagnet;
  const trParams = DEFAULT_TRACKERS.map((tr) => `tr=${encodeURIComponent(tr)}`).join('&');
  return `magnet:?xt=urn:btih:${infoHash}&${trParams}`;
}

function selectTargetFile(files: TorrentFileLike[], fileIdx: number | 'auto'): TorrentFileLike | null {
  if (files.length === 0) return null;
  if (typeof fileIdx === 'number' && Number.isInteger(fileIdx) && files[fileIdx]) {
    return files[fileIdx]!;
  }
  const videoFiles = files.filter((f) => {
    const ext = path.extname(f.name).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  });
  const candidates = videoFiles.length > 0 ? videoFiles : files;
  return candidates.reduce((largest, curr) => (curr.length > largest.length ? curr : largest), candidates[0]!);
}

function vttToSrt(vtt: string): string {
  const normalized = vtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim();
  if (!normalized) return '';
  const blocks = normalized.split(/\n{2,}/);
  const out: string[] = [];
  let idx = 1;
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter(Boolean);
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const timing = (lines[timingIdx] ?? '')
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
      .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
    const text = lines.slice(timingIdx + 1).join('\n').trim();
    if (!text) continue;
    out.push(`${idx}\n${timing}\n${text}`);
    idx++;
  }
  return `${out.join('\n\n')}\n`;
}

async function fetchAndSaveSubtitleForDownload(record: DownloadRecord): Promise<void> {
  if (!record.imdbId || !record.filePath) return;
  try {
    const subEntry = await resolveSubtitle({
      type: record.mediaType,
      imdbId: record.imdbId,
      season: record.season,
      episode: record.episode,
      autoTranslate: true,
      lang: 'pt-BR',
      iso2: 'pt',
      openSubCodes: ['pob'],
    });
    if (!subEntry.vtt) return;

    const srt = vttToSrt(subEntry.vtt);
    if (!srt.trim()) return;

    const parsedPath = path.parse(record.filePath);
    fs.mkdirSync(parsedPath.dir, { recursive: true });
    const srtPath = path.join(parsedPath.dir, `${parsedPath.name}.pt-br.srt`);
    fs.writeFileSync(srtPath, srt, 'utf-8');

    const latest = downloadsMap.get(record.id);
    if (latest) {
      latest.subtitlePath = srtPath;
      persistDownloads();
    }
  } catch {
    // Legenda opcional — não interrompe download do vídeo
  }
}

function computeFilePieceProgress(
  engine: TorrentEngineLike,
  file: TorrentFileLike
): { progress: number; downloadedBytes: number; complete: boolean } {
  const pieceLength = engine.torrent?.pieceLength || 0;
  const bitfield = engine.bitfield;
  if (!pieceLength || !bitfield || file.length <= 0) {
    return { progress: 0, downloadedBytes: 0, complete: false };
  }

  const startPiece = Math.floor(file.offset / pieceLength);
  const endPiece = Math.floor((file.offset + file.length - 1) / pieceLength);
  const totalPieces = Math.max(1, endPiece - startPiece + 1);

  let verified = 0;
  for (let p = startPiece; p <= endPiece; p++) {
    if (bitfield.get(p)) verified++;
  }

  const ratio = verified / totalPieces;
  const complete = verified === totalPieces;
  const progress = complete ? 100 : Math.min(99.9, Math.round(ratio * 1000) / 10);
  const downloadedBytes = complete ? file.length : Math.min(file.length, Math.round(ratio * file.length));

  return { progress, downloadedBytes, complete };
}

function stopActiveJob(id: string): void {
  const job = activeJobs.get(id);
  if (!job) return;
  clearInterval(job.pollTimer);
  activeJobs.delete(id);
  try {
    // destroy() encerra a engine preservando os arquivos no disco
    job.engine.destroy();
  } catch {
    // ignora
  }
}

function startEngineForRecord(record: DownloadRecord): void {
  if (activeJobs.has(record.id)) return;

  const downloadDir = getResolvedDownloadDir();
  const magnetUri = buildMagnetUri(record.infoHash, record.magnetUri);

  record.status = 'downloading';
  record.error = null;
  record.speed = 0;
  record.peers = 0;
  persistDownloads();

  const engine = torrentStream(magnetUri, {
    path: downloadDir,
    tmp: downloadDir,
    dht: true,
    tracker: true,
    trackers: DEFAULT_TRACKERS,
  }) as unknown as TorrentEngineLike;

  const job: ActiveDownloadJob = {
    engine,
    file: null,
    pollTimer: setInterval(() => {
      const current = downloadsMap.get(record.id);
      if (!current || current.status !== 'downloading') {
        stopActiveJob(record.id);
        return;
      }

      const targetFile = job.file;
      current.peers = engine.swarm?.wires?.length ?? 0;
      current.speed = engine.swarm?.downloadSpeed ? Math.round(engine.swarm.downloadSpeed()) : 0;

      if (targetFile) {
        const stats = computeFilePieceProgress(engine, targetFile);
        current.totalBytes = targetFile.length;
        current.downloadedBytes = stats.downloadedBytes;
        current.progress = stats.progress;

        if (stats.complete) {
          current.status = 'completed';
          current.progress = 100;
          current.downloadedBytes = targetFile.length;
          current.speed = 0;
          current.peers = 0;
          persistDownloads();
          stopActiveJob(record.id);
          return;
        }
      }

      persistDownloads();
    }, 1500),
  };

  activeJobs.set(record.id, job);

  engine.once('ready', () => {
    const current = downloadsMap.get(record.id);
    if (!current || current.status !== 'downloading') {
      stopActiveJob(record.id);
      return;
    }

    const chosen = selectTargetFile(engine.files || [], current.fileIdx);
    if (!chosen) {
      current.status = 'error';
      current.error = 'Nenhum arquivo de vídeo encontrado neste torrent.';
      current.speed = 0;
      current.peers = 0;
      persistDownloads();
      stopActiveJob(record.id);
      return;
    }

    job.file = chosen;
    current.fileName = chosen.name;
    current.filePath = path.join(downloadDir, chosen.path || chosen.name);
    current.totalBytes = chosen.length;

    // Seleciona apenas o arquivo escolhido para baixar todas as peças até 100%
    for (const f of engine.files) {
      if (f !== chosen && typeof f.deselect === 'function') {
        f.deselect();
      }
    }
    chosen.select();

    const stats = computeFilePieceProgress(engine, chosen);
    current.downloadedBytes = stats.downloadedBytes;
    current.progress = stats.progress;
    if (stats.complete) {
      current.status = 'completed';
      current.progress = 100;
      current.speed = 0;
      current.peers = 0;
      persistDownloads();
      stopActiveJob(record.id);
    } else {
      persistDownloads();
    }

    // Em paralelo, baixa e salva a legenda PT-BR na mesma pasta
    if (!current.subtitlePath) {
      void fetchAndSaveSubtitleForDownload(current);
    }
  });

  engine.on('error', (err) => {
    const current = downloadsMap.get(record.id);
    if (!current) return;
    current.status = 'error';
    current.error = err instanceof Error ? err.message : String(err);
    current.speed = 0;
    current.peers = 0;
    persistDownloads();
    stopActiveJob(record.id);
  });
}

export function listDownloads(): DownloadRecord[] {
  return Array.from(downloadsMap.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getDownloadById(id: string): DownloadRecord | undefined {
  return downloadsMap.get(id);
}

export function startDownload(input: StartDownloadInput): DownloadRecord {
  const infoHash = (input.infoHash || extractInfoHashFromMagnet(input.magnetUri)).trim().toLowerCase();
  if (!infoHash || !/^([a-f0-9]{40}|[a-z2-7]{32})$/i.test(infoHash)) {
    throw new Error('infoHash ou magnetUri inválido para download.');
  }

  const fileIdx = input.fileIdx ?? 'auto';

  // Evita duplicatas se já estiver baixando ou concluído
  for (const existing of downloadsMap.values()) {
    const sameMedia =
      existing.imdbId === input.imdbId &&
      existing.mediaType === input.mediaType &&
      (existing.season ?? 0) === (input.season ?? 0) &&
      (existing.episode ?? 0) === (input.episode ?? 0);
    const sameSource = existing.infoHash === infoHash && String(existing.fileIdx) === String(fileIdx);

    if ((sameMedia || sameSource) && (existing.status === 'downloading' || existing.status === 'completed')) {
      return existing;
    }
    if ((sameMedia || sameSource) && (existing.status === 'paused' || existing.status === 'error')) {
      startEngineForRecord(existing);
      return existing;
    }
  }

  const record: DownloadRecord = {
    id: crypto.randomUUID(),
    imdbId: input.imdbId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    title: input.title,
    ...(input.mediaType === 'tv'
      ? { season: input.season ?? 1, episode: input.episode ?? 1 }
      : {}),
    posterPath: input.posterPath ?? null,
    backdropPath: input.backdropPath ?? null,
    ...(input.quality ? { quality: input.quality } : {}),
    infoHash,
    ...(input.magnetUri ? { magnetUri: input.magnetUri } : {}),
    fileIdx,
    fileName: '',
    filePath: '',
    subtitlePath: null,
    totalBytes: 0,
    downloadedBytes: 0,
    progress: 0,
    status: 'queued',
    speed: 0,
    peers: 0,
    createdAt: Date.now(),
    error: null,
  };

  downloadsMap.set(record.id, record);
  persistDownloads();
  startEngineForRecord(record);
  return record;
}

export function pauseDownload(id: string): DownloadRecord | null {
  const record = downloadsMap.get(id);
  if (!record) return null;
  stopActiveJob(id);
  if (record.status !== 'completed') {
    record.status = 'paused';
    record.speed = 0;
    record.peers = 0;
    persistDownloads();
  }
  return record;
}

export function resumeDownload(id: string): DownloadRecord | null {
  const record = downloadsMap.get(id);
  if (!record) return null;
  if (record.status === 'completed') return record;
  startEngineForRecord(record);
  return record;
}

export function deleteDownload(id: string, deleteFiles = false): boolean {
  const record = downloadsMap.get(id);
  if (!record) return false;
  stopActiveJob(id);
  downloadsMap.delete(id);
  persistDownloads();

  if (deleteFiles) {
    const safeUnlink = (targetPath: string | null) => {
      if (!targetPath) return;
      try {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
      } catch {
        // ignora erro ao remover arquivo em uso
      }
    };
    safeUnlink(record.filePath);
    safeUnlink(record.subtitlePath);
  }
  return true;
}

function getMimeForExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function needsOfflineFfmpeg(fileName: string, forceTranscode: boolean): boolean {
  if (forceTranscode) return true;
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.mkv' || ext === '.avi' || ext === '.mov') return true;
  if (INCOMPATIBLE_CODEC_REGEX.test(fileName)) return true;
  return false;
}

export function streamOfflineDownload(
  id: string,
  request: FastifyRequest,
  reply: FastifyReply,
  options: { startSeconds?: number; forceTranscode?: boolean } = {}
): unknown {
  const record = downloadsMap.get(id);
  if (!record || !record.filePath || !fs.existsSync(record.filePath)) {
    return reply.status(404).send({ error: 'Arquivo baixado não encontrado em disco.' });
  }

  const stat = fs.statSync(record.filePath);
  const useFfmpeg = needsOfflineFfmpeg(record.fileName || record.filePath, Boolean(options.forceTranscode));

  if (useFfmpeg) {
    const caps = checkFfmpeg();
    if (caps.available) {
      const startSec = options.startSeconds && options.startSeconds > 0 ? Math.floor(options.startSeconds) : 0;
      const isHevc = /(?:^|[^a-z0-9])(x265|hevc|h\.?265|10bit)(?:$|[^a-z0-9])/i.test(record.fileName);

      const args: string[] = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
      if (startSec > 0) {
        args.push('-ss', String(startSec));
      }
      args.push('-i', record.filePath, '-map', '0:v:0', '-map', '0:a:0?');

      if (isHevc || options.forceTranscode) {
        if (caps.nvenc) {
          args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p');
        } else {
          args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
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
        '-movflags',
        'frag_keyframe+empty_moov+faststart',
        '-f',
        'mp4',
        'pipe:1'
      );

      const proc = spawn(resolveBinaryPath('ffmpeg'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
      request.raw.on('close', () => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignora
        }
      });

      return reply
        .status(200)
        .header('Content-Type', 'video/mp4')
        .header('Cache-Control', 'no-cache')
        .send(proc.stdout);
    }
  }

  // Streaming direto com suporte completo a Range (206 Partial Content)
  const fileSize = stat.size;
  const mime = getMimeForExt(record.filePath);
  const rangeHeader = request.headers.range;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
      return reply
        .status(416)
        .header('Content-Range', `bytes */${fileSize}`)
        .send();
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(record.filePath, { start, end });
    return reply
      .status(206)
      .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(chunkSize))
      .header('Content-Type', mime)
      .send(stream);
  }

  const stream = fs.createReadStream(record.filePath);
  return reply
    .status(200)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', String(fileSize))
    .header('Content-Type', mime)
    .send(stream);
}

export function serveOfflineSubtitleVtt(
  id: string,
  reply: FastifyReply,
  offsetSeconds = 0
): unknown {
  const record = downloadsMap.get(id);
  if (!record || !record.subtitlePath || !fs.existsSync(record.subtitlePath)) {
    return reply.status(404).type('text/plain; charset=utf-8').send('Legenda offline não encontrada.');
  }

  try {
    const rawSrt = fs.readFileSync(record.subtitlePath, 'utf-8');
    let vtt = srtToVtt(rawSrt);
    if (Number.isFinite(offsetSeconds) && offsetSeconds > 0) {
      vtt = shiftVttByOffset(vtt, offsetSeconds);
    }
    return reply
      .status(200)
      .header('Content-Type', 'text/vtt; charset=utf-8')
      .header('Cache-Control', offsetSeconds > 0 ? 'no-cache' : 'public, max-age=3600')
      .send(vtt);
  } catch {
    return reply.status(500).type('text/plain; charset=utf-8').send('Erro ao ler legenda offline.');
  }
}

export function serveOfflineFileAttachment(id: string, reply: FastifyReply): unknown {
  const record = downloadsMap.get(id);
  if (!record || record.status !== 'completed' || !record.filePath || !fs.existsSync(record.filePath)) {
    return reply.status(404).send({ error: 'Arquivo concluído não encontrado.' });
  }

  const stat = fs.statSync(record.filePath);
  const safeFileName = path.basename(record.fileName || record.filePath).replace(/["\r\n]/g, '');
  const stream = fs.createReadStream(record.filePath);

  return reply
    .status(200)
    .header('Content-Type', getMimeForExt(record.filePath))
    .header('Content-Length', String(stat.size))
    .header('Content-Disposition', `attachment; filename="${safeFileName}"`)
    .send(stream);
}
