import type { StreamMediaType } from './streamResolver';

export type SubtitleStatus = 'native-pt' | 'native' | 'auto-translated' | 'none';

export interface SubtitleCacheEntry {
  key: string;
  status: SubtitleStatus;
  language: string;
  vtt: string | null;
  sourceLang?: string;
  createdAt: number;
}

export interface SubtitleLookupInput {
  type: StreamMediaType;
  imdbId: string;
  season?: number;
  episode?: number;
  autoTranslate: boolean;
  lang?: string;
  iso2?: string;
  openSubCodes?: string[];
}

interface OpenSubtitlesItem {
  id?: string;
  url?: string;
  lang?: string;
}

interface VttCue {
  timing: string;
  text: string;
}

const OPENSUBTITLES_BASE = 'https://opensubtitles-v3.strem.io/subtitles';
const FETCH_TIMEOUT_MS = 8000;
const TRANSLATE_BATCH_SIZE = 40;
const PUBLIC_TRANSLATE_SEPARATOR = '\n⟪§⟫\n';

const subtitleCache = new Map<string, SubtitleCacheEntry>();

function inferDefaultsForLang(lang?: string): {
  lang: string;
  iso2: string;
  openSubCodes: string[];
} {
  const clean = (lang || 'pt-BR').trim();
  const lower = clean.toLowerCase();
  if (lower.startsWith('en')) {
    return { lang: 'en-US', iso2: 'en', openSubCodes: ['eng'] };
  }
  if (lower.startsWith('es')) {
    return { lang: 'es-ES', iso2: 'es', openSubCodes: ['spa'] };
  }
  if (lower.startsWith('fr')) {
    return { lang: 'fr-FR', iso2: 'fr', openSubCodes: ['fre', 'fra'] };
  }
  return { lang: clean || 'pt-BR', iso2: 'pt', openSubCodes: ['pob', 'por'] };
}

function mapDeepLTargetLang(lang: string, iso2: string): string {
  const lower = lang.toLowerCase();
  if (lower === 'pt-br') return 'PT-BR';
  if (lower.startsWith('pt')) return 'PT-PT';
  if (lower === 'en-us') return 'EN-US';
  if (lower.startsWith('en')) return 'EN-GB';
  return iso2.toUpperCase();
}

export function buildSubtitleCacheKey(
  imdbId: string,
  season?: number,
  episode?: number,
  lang = 'pt-BR'
): string {
  return `${imdbId}:${season ?? 0}:${episode ?? 0}:${lang}`;
}

export function getCachedSubtitle(
  imdbId: string,
  season?: number,
  episode?: number,
  lang = 'pt-BR'
): SubtitleCacheEntry | undefined {
  return subtitleCache.get(buildSubtitleCacheKey(imdbId, season, episode, lang));
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function cleanSubtitleText(text: string): string {
  return text
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/<\/?(?:font|span|div|script|style|a|img|br)[^>]*>/gi, ' ')
    .replace(/<[^>]*$/gm, '')
    .replace(/^[^<]*>/gm, '')
    .replace(/<(?!\/?(?:i|b|u)\b)[^>]+>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function srtToVtt(raw: string): string {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const withoutHeader = normalized.replace(/^WEBVTT[^\n]*\n+/i, '');
  const blocks = withoutHeader.split(/\n{2,}/);
  const vttBlocks: string[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    if (lines.length === 0) continue;

    const timingIdx = lines.findIndex((line) => line.includes('-->'));
    if (timingIdx === -1) continue;

    const rawTiming = lines[timingIdx];
    if (!rawTiming) continue;

    const vttTiming = rawTiming.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const rawText = lines.slice(timingIdx + 1).join('\n');
    const cleanedText = cleanSubtitleText(rawText);

    if (!cleanedText) continue;
    vttBlocks.push(`${vttTiming}\n${cleanedText}`);
  }

  return `WEBVTT\n\n${vttBlocks.join('\n\n')}\n`;
}

function parseVttCues(vtt: string): VttCue[] {
  const body = vtt.replace(/^WEBVTT[^\n]*\n+/i, '').trim();
  if (!body) return [];

  const blocks = body.split(/\n{2,}/);
  const cues: VttCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const timing = lines[timingIdx];
    if (!timing) continue;

    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim();
    if (!text) continue;

    cues.push({ timing, text });
  }

  return cues;
}

function buildVttFromCues(cues: VttCue[]): string {
  const body = cues.map((cue) => `${cue.timing}\n${cue.text}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

function parseVttSeconds(ts: string): number {
  const cleaned = ts.trim().split(/\s+/)[0] ?? '';
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    return (
      Number(parts[0]) * 3600 +
      Number(parts[1]) * 60 +
      Number((parts[2] ?? '0').replace(',', '.'))
    );
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number((parts[1] ?? '0').replace(',', '.'));
  }
  return Number.NaN;
}

function formatVttSeconds(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}.${pad3(Math.min(999, ms))}`;
}

export function shiftVttByOffset(vtt: string, offsetSeconds: number): string {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds <= 0) return vtt;

  const cues = parseVttCues(vtt);
  const shifted: VttCue[] = [];

  for (const cue of cues) {
    const [rawStart, rawEnd] = cue.timing.split('-->');
    if (!rawStart || !rawEnd) continue;
    const start = parseVttSeconds(rawStart);
    const end = parseVttSeconds(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    // Descarta cues que terminam antes do offset
    if (end <= offsetSeconds) continue;

    const nextStart = Math.max(0, start - offsetSeconds);
    const nextEnd = Math.max(nextStart + 0.1, end - offsetSeconds);
    shifted.push({
      timing: `${formatVttSeconds(nextStart)} --> ${formatVttSeconds(nextEnd)}`,
      text: cue.text,
    });
  }

  return buildVttFromCues(shifted);
}

async function translateWithDeepL(
  texts: string[],
  apiKey: string,
  targetLang: string,
  iso2: string
): Promise<string[] | null> {
  const endpoint = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        target_lang: mapDeepLTargetLang(targetLang, iso2),
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { translations?: { text: string }[] };
    if (!Array.isArray(data.translations) || data.translations.length !== texts.length) {
      return null;
    }
    return data.translations.map((item, i) => item.text || texts[i] || '');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithLibreTranslate(
  texts: string[],
  baseUrl: string,
  iso2: string,
  apiKey?: string
): Promise<string[] | null> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/translate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: texts,
        source: 'en',
        target: iso2,
        format: 'text',
        ...(apiKey ? { api_key: apiKey } : {}),
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { translatedText?: string | string[] };
    if (Array.isArray(data.translatedText) && data.translatedText.length === texts.length) {
      return data.translatedText;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithPublicFallback(
  texts: string[],
  targetLang: string
): Promise<string[]> {
  const output: string[] = [];
  let cursor = 0;

  while (cursor < texts.length) {
    const chunk: string[] = [];
    let charCount = 0;

    while (cursor < texts.length) {
      const next = texts[cursor] ?? '';
      if (chunk.length > 0 && charCount + next.length > 2600) break;
      chunk.push(next);
      charCount += next.length + PUBLIC_TRANSLATE_SEPARATOR.length;
      cursor++;
    }

    const joined = chunk.join(PUBLIC_TRANSLATE_SEPARATOR);
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'en');
    url.searchParams.set('tl', targetLang);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', joined);

    try {
      const res = await fetchWithTimeout(url.toString(), 7000);
      if (!res.ok) {
        output.push(...chunk);
        continue;
      }

      const payload = (await res.json()) as unknown[];
      const segments = Array.isArray(payload[0]) ? (payload[0] as unknown[][]) : [];
      const translatedJoined = segments
        .map((seg) => (typeof seg[0] === 'string' ? seg[0] : ''))
        .join('');

      const split = translatedJoined.split(/\s*⟪§⟫\s*/);
      if (split.length === chunk.length) {
        output.push(...split.map((s, idx) => s.trim() || chunk[idx] || ''));
      } else {
        output.push(...chunk);
      }
    } catch {
      output.push(...chunk);
    }
  }

  return output;
}

export async function translateBatch(
  texts: string[],
  targetLang = 'pt-BR',
  iso2 = 'pt'
): Promise<string[]> {
  if (texts.length === 0) return [];

  const deeplKey = process.env.DEEPL_API_KEY?.trim();
  if (deeplKey) {
    const deeplResult = await translateWithDeepL(texts, deeplKey, targetLang, iso2);
    if (deeplResult) return deeplResult;
  }

  const libreUrl = process.env.LIBRETRANSLATE_URL?.trim();
  if (libreUrl) {
    const libreResult = await translateWithLibreTranslate(
      texts,
      libreUrl,
      iso2,
      process.env.LIBRETRANSLATE_API_KEY?.trim()
    );
    if (libreResult) return libreResult;
  }

  return translateWithPublicFallback(texts, targetLang);
}

async function translateVtt(vtt: string, targetLang: string, iso2: string): Promise<string> {
  const cues = parseVttCues(vtt);
  if (cues.length === 0) return vtt;

  const translatedCues: VttCue[] = [];

  for (let i = 0; i < cues.length; i += TRANSLATE_BATCH_SIZE) {
    const batch = cues.slice(i, i + TRANSLATE_BATCH_SIZE);
    const texts = batch.map((c) => c.text);
    const translatedTexts = await translateBatch(texts, targetLang, iso2);

    for (let j = 0; j < batch.length; j++) {
      const originalCue = batch[j];
      if (!originalCue) continue;
      translatedCues.push({
        timing: originalCue.timing,
        text: translatedTexts[j] || originalCue.text,
      });
    }
  }

  return buildVttFromCues(translatedCues);
}

async function fetchSubtitleTrackList(
  type: StreamMediaType,
  imdbId: string,
  season?: number,
  episode?: number
): Promise<OpenSubtitlesItem[]> {
  const stremioType = type === 'movie' ? 'movie' : 'series';
  const stremioId = type === 'movie' ? imdbId : `${imdbId}:${season ?? 1}:${episode ?? 1}`;
  const url = `${OPENSUBTITLES_BASE}/${stremioType}/${encodeURIComponent(stremioId)}.json`;

  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return [];
    const data = (await res.json()) as { subtitles?: unknown };
    return Array.isArray(data.subtitles) ? (data.subtitles as OpenSubtitlesItem[]) : [];
  } catch {
    return [];
  }
}

async function downloadSubtitleText(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function resolveSubtitle(
  input: SubtitleLookupInput
): Promise<SubtitleCacheEntry> {
  const defaults = inferDefaultsForLang(input.lang);
  const lang = input.lang?.trim() || defaults.lang;
  const iso2 = (input.iso2?.trim() || defaults.iso2).toLowerCase();
  const openSubCodes =
    input.openSubCodes && input.openSubCodes.length > 0
      ? input.openSubCodes.map((c) => c.toLowerCase())
      : defaults.openSubCodes;

  const { type, imdbId, season, episode, autoTranslate } = input;
  const cacheKey = buildSubtitleCacheKey(imdbId, season, episode, lang);

  const cached = subtitleCache.get(cacheKey);
  if (cached && (cached.vtt !== null || !autoTranslate)) {
    return cached;
  }

  const tracks = await fetchSubtitleTrackList(type, imdbId, season, episode);

  // 1. Procura legenda nativa na ordem de prioridade de openSubCodes (mais iso2/lang)
  const acceptedCodes = [...openSubCodes, lang.toLowerCase(), iso2];
  let nativeTrack: OpenSubtitlesItem | undefined;

  for (const code of acceptedCodes) {
    nativeTrack = tracks.find(
      (t) => Boolean(t.url) && (t.lang ?? '').toLowerCase() === code
    );
    if (nativeTrack) break;
  }

  if (nativeTrack?.url) {
    const rawSrt = await downloadSubtitleText(nativeTrack.url);
    if (rawSrt) {
      const vtt = srtToVtt(rawSrt);
      const entry: SubtitleCacheEntry = {
        key: cacheKey,
        status: iso2 === 'pt' ? 'native-pt' : 'native',
        language: lang,
        vtt,
        sourceLang: nativeTrack.lang ?? openSubCodes[0],
        createdAt: Date.now(),
      };
      subtitleCache.set(cacheKey, entry);
      return entry;
    }
  }

  // 2. Se não encontrou nativa e autoTranslate está ativo (e idioma alvo não for inglês), traduz de inglês
  if (autoTranslate && iso2 !== 'en') {
    const engTrack = tracks.find((t) => {
      const l = (t.lang ?? '').toLowerCase();
      return Boolean(t.url) && (l === 'eng' || l === 'en');
    });

    if (engTrack?.url) {
      const rawSrt = await downloadSubtitleText(engTrack.url);
      if (rawSrt) {
        const baseVtt = srtToVtt(rawSrt);
        const translatedVtt = await translateVtt(baseVtt, lang, iso2);
        const entry: SubtitleCacheEntry = {
          key: cacheKey,
          status: 'auto-translated',
          language: lang,
          vtt: translatedVtt,
          sourceLang: engTrack.lang ?? 'eng',
          createdAt: Date.now(),
        };
        subtitleCache.set(cacheKey, entry);
        return entry;
      }
    }
  }

  const emptyEntry: SubtitleCacheEntry = {
    key: cacheKey,
    status: 'none',
    language: lang,
    vtt: null,
    createdAt: Date.now(),
  };
  subtitleCache.set(cacheKey, emptyEntry);
  return emptyEntry;
}
