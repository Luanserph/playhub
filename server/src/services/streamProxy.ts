import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyReply, FastifyRequest } from 'fastify';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PROXY_TIMEOUT_MS = 15000;

function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isHlsPlaylist(url: string, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('m3u8')) return true;
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

function decodeExtraHeaders(encoded?: string): Record<string, string> {
  if (!encoded || typeof encoded !== 'string') return {};
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const allowed: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const lower = key.toLowerCase();
      // Repassa cabeçalhos relevantes de proxyHeaders sem permitir injeção de Host/Content-Length
      if (
        lower === 'referer' ||
        lower === 'origin' ||
        lower === 'user-agent' ||
        lower === 'accept' ||
        lower === 'accept-language' ||
        lower === 'authorization' ||
        lower === 'cookie'
      ) {
        allowed[key] = value.trim();
      }
    }
    return allowed;
  } catch {
    return {};
  }
}

function toProxyUrl(targetUrl: string, proxyOrigin: string, encodedHeaders?: string): string {
  const base = `${proxyOrigin}/api/proxy?url=${encodeURIComponent(targetUrl)}`;
  return encodedHeaders ? `${base}&headers=${encodeURIComponent(encodedHeaders)}` : base;
}

export function rewriteHlsPlaylist(
  playlist: string,
  baseUrl: string,
  proxyOrigin: string,
  encodedHeaders?: string
): string {
  const lines = playlist.split(/\r?\n/);

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Reescreve atributos URI="..." dentro de tags HLS (#EXT-X-MEDIA, #EXT-X-KEY, #EXT-X-MAP, etc.)
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_match, rawUri: string) => {
          try {
            const abs = new URL(rawUri, baseUrl).toString();
            return `URI="${toProxyUrl(abs, proxyOrigin, encodedHeaders)}"`;
          } catch {
            return `URI="${rawUri}"`;
          }
        });
      }

      // Linha de segmento (.ts, .m4s) ou sub-playlist (.m3u8)
      try {
        const abs = new URL(trimmed, baseUrl).toString();
        return toProxyUrl(abs, proxyOrigin, encodedHeaders);
      } catch {
        return line;
      }
    })
    .join('\n');
}

export async function handleStreamProxy(
  targetUrl: string,
  request: FastifyRequest,
  reply: FastifyReply,
  proxyOrigin: string,
  encodedHeaders?: string
): Promise<unknown> {
  if (!isValidHttpUrl(targetUrl)) {
    return reply.status(400).send({ error: 'URL de destino inválida.' });
  }

  const extraHeaders = decodeExtraHeaders(encodedHeaders);
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: '*/*',
    ...extraHeaders,
  };

  const rangeHeader = request.headers.range;
  if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
    headers.Range = rangeHeader;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      return reply
        .status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502)
        .send({ error: `Origem retornou HTTP ${upstream.status}` });
    }

    const finalUrl = upstream.url || targetUrl;
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    // Se for playlist HLS (.m3u8), reescreve URLs internas para apontar ao proxy local
    if (isHlsPlaylist(finalUrl, contentType)) {
      const playlistText = await upstream.text();
      const rewritten = rewriteHlsPlaylist(playlistText, finalUrl, proxyOrigin, encodedHeaders);

      return reply
        .status(200)
        .header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send(rewritten);
    }

    // Mídia binária (.ts, .m4s, .mp4, áudio): streaming direto preservando cabeçalhos Range
    reply.status(upstream.status);
    reply.header('Content-Type', contentType);

    const passthroughHeaders = [
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
    ] as const;

    for (const headerName of passthroughHeaders) {
      const val = upstream.headers.get(headerName);
      if (val) {
        reply.header(headerName, val);
      }
    }

    if (!upstream.headers.get('accept-ranges')) {
      reply.header('Accept-Ranges', 'bytes');
    }

    if (!upstream.body) {
      return reply.status(204).send();
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as WebReadableStream);
    return reply.send(nodeStream);
  } catch (err) {
    clearTimeout(timeout);
    request.log.warn({ err, targetUrl }, 'Erro ao fazer proxy de stream');
    return reply.status(502).send({ error: 'Falha ao obter stream da origem.' });
  }
}
