import type { FastifyReply, FastifyRequest } from 'fastify';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const MAX_CACHE_ENTRIES = 500;
const MAX_IMAGE_CACHE_ENTRIES = 300;

const ALLOWED_IMAGE_SIZES = new Set([
  'w92',
  'w154',
  'w185',
  'w300',
  'w342',
  'w500',
  'w780',
  'w1280',
  'h632',
  'original',
]);

interface CacheEntry {
  status: number;
  body: unknown;
  expiresAt: number;
}

interface ImageCacheEntry {
  buffer: Buffer;
  contentType: string;
}

const tmdbCache = new Map<string, CacheEntry>();
const tmdbImageCache = new Map<string, ImageCacheEntry>();

function cleanTmdbKey(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, '');
}

function resolveTmdbKey(request: FastifyRequest): string {
  const headerVal = request.headers['x-tmdb-key'];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return cleanTmdbKey(fromHeader);
  }

  const fromEnv = process.env.VITE_TMDB_API_KEY || process.env.TMDB_API_KEY || '';
  return cleanTmdbKey(fromEnv);
}

function buildCacheKey(normalizedPath: string, params: URLSearchParams): string {
  const sorted = new URLSearchParams(params);
  sorted.delete('api_key');
  sorted.sort();
  const qs = sorted.toString();
  return qs ? `${normalizedPath}?${qs}` : normalizedPath;
}

function setCacheEntry(key: string, entry: CacheEntry): void {
  const now = Date.now();
  if (tmdbCache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, v] of tmdbCache.entries()) {
      if (v.expiresAt <= now) {
        tmdbCache.delete(k);
      }
    }
    if (tmdbCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = tmdbCache.keys().next().value;
      if (oldestKey !== undefined) {
        tmdbCache.delete(oldestKey);
      }
    }
  }
  tmdbCache.set(key, entry);
}

export async function handleTmdbProxy(
  wildcardPath: string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const normalizedPath = wildcardPath.replace(/^\/+/, '');
  if (!normalizedPath) {
    return reply.status(400).send({ error: 'Caminho do endpoint TMDB não informado.' });
  }

  const key = resolveTmdbKey(request);
  if (!key) {
    return reply.status(401).send({
      error: 'Chave TMDB ausente. Envie o header x-tmdb-key ou configure VITE_TMDB_API_KEY.',
    });
  }

  const incomingUrl = new URL(request.url, 'http://127.0.0.1');
  const isConfigurationEndpoint =
    normalizedPath === 'configuration' || normalizedPath.startsWith('configuration/');
  const cacheKey = buildCacheKey(normalizedPath, incomingUrl.searchParams);

  if (!isConfigurationEndpoint) {
    const cached = tmdbCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return reply
        .status(cached.status)
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('X-TMDB-Cache', 'HIT')
        .send(cached.body);
    }
    if (cached) {
      tmdbCache.delete(cacheKey);
    }
  }

  const targetUrl = new URL(`${TMDB_API_BASE}/${normalizedPath}`);
  incomingUrl.searchParams.forEach((value, name) => {
    if (name !== 'api_key') {
      targetUrl.searchParams.append(name, value);
    }
  });

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'PlayHub/1.0',
  };

  if (key.length > 60) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    targetUrl.searchParams.set('api_key', key);
  }

  try {
    const upstreamRes = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers,
    });

    const rawText = await upstreamRes.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return reply.status(502).send({
        error: 'Resposta inválida ou bloqueada pelo proxy de rede ao acessar o TMDB.',
      });
    }

    if (upstreamRes.ok && !isConfigurationEndpoint) {
      setCacheEntry(cacheKey, {
        status: upstreamRes.status,
        body: parsed,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return reply
      .status(upstreamRes.status)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('X-TMDB-Cache', isConfigurationEndpoint ? 'BYPASS' : 'MISS')
      .send(parsed);
  } catch (err) {
    request.log.warn({ err, path: normalizedPath }, 'Falha ao conectar ao TMDB via proxy');
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(502).send({
      error: `Falha de rede no servidor ao acessar o TMDB: ${message}`,
    });
  }
}

function getCachedImage(key: string): ImageCacheEntry | undefined {
  const cached = tmdbImageCache.get(key);
  if (!cached) return undefined;
  // Atualiza ordem LRU
  tmdbImageCache.delete(key);
  tmdbImageCache.set(key, cached);
  return cached;
}

function setCachedImage(key: string, entry: ImageCacheEntry): void {
  if (tmdbImageCache.has(key)) {
    tmdbImageCache.delete(key);
  } else if (tmdbImageCache.size >= MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = tmdbImageCache.keys().next().value;
    if (oldestKey !== undefined) {
      tmdbImageCache.delete(oldestKey);
    }
  }
  tmdbImageCache.set(key, entry);
}

function validateTmdbImagePath(rawPath: string): string | null {
  const normalized = rawPath.replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('\\') || normalized.includes('://')) {
    return null;
  }

  const segments = normalized.split('/');
  if (segments.length < 2) return null;

  const [size, ...rest] = segments;
  if (!size || !ALLOWED_IMAGE_SIZES.has(size)) return null;

  const validSegment = /^[a-zA-Z0-9._-]+$/;
  if (!rest.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && validSegment.test(seg))) {
    return null;
  }

  return `${size}/${rest.join('/')}`;
}

export async function handleTmdbImageProxy(
  wildcardPath: string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const safeImagePath = validateTmdbImagePath(wildcardPath);
  if (!safeImagePath) {
    return reply.status(400).send({
      error: 'Caminho de imagem TMDB inválido ou tamanho não permitido.',
    });
  }

  const cached = getCachedImage(safeImagePath);
  if (cached) {
    return reply
      .status(200)
      .header('Content-Type', cached.contentType)
      .header('Cache-Control', 'public, max-age=86400')
      .header('Access-Control-Allow-Origin', '*')
      .header('X-TMDB-Image-Cache', 'HIT')
      .send(cached.buffer);
  }

  const upstreamUrl = `${TMDB_IMAGE_BASE}/${safeImagePath}`;
  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'PlayHub/1.0',
      },
    });

    const contentType = upstreamRes.headers.get('content-type') || '';
    if (!upstreamRes.ok || !contentType.toLowerCase().startsWith('image/')) {
      const status = upstreamRes.status === 404 ? 404 : 502;
      return reply.status(status).send({
        error: 'Imagem indisponível ou bloqueada ao acessar image.tmdb.org.',
      });
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    setCachedImage(safeImagePath, { buffer, contentType });

    return reply
      .status(200)
      .header('Content-Type', contentType)
      .header('Cache-Control', 'public, max-age=86400')
      .header('Access-Control-Allow-Origin', '*')
      .header('X-TMDB-Image-Cache', 'MISS')
      .send(buffer);
  } catch (err) {
    request.log.warn({ err, imagePath: safeImagePath }, 'Falha ao buscar imagem do TMDB via proxy');
    return reply.status(502).send({
      error: 'Falha de rede no servidor ao buscar imagem do TMDB.',
    });
  }
}
