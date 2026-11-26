import type { StreamMediaType } from './streamResolver';

export type SubtitleStatus = 'native-pt' | 'native' | 'auto-translated' | 'none';
export type SubtitleLangTag = 'PT-BR' | 'PT-PT' | 'EN' | 'IA PT-BR';

export interface SubtitleOptionItem {
  id: string;
  label: string;
  langTag: SubtitleLangTag;
  releaseName: string;
  url: string;
}

export interface SubtitleCacheEntry {
  key: string;
  status: SubtitleStatus;
  language: string;
  vtt: string | null;
  sourceLang?: string;
  options: SubtitleOptionItem[];
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
  label?: string;
  name?: string;
  SubFileName?: string;
  source?: 'OpenSubtitles' | 'Wyzie';
}

interface RegisteredSubtitleTrack {
  sourceUrl?: string;
  vtt?: string;
  translateTarget?: { lang: string; iso2: string };
}

interface VttCue {
  timing: string;
  text: string;
}

const OPENSUBTITLES_BASE = 'https://opensubtitles-v3.strem.io/subtitles';
const WYZIE_SUBS_BASE = 'https://sub.wyzie.ru/search';
const FETCH_TIMEOUT_MS = 8000;
const WYZIE_TIMEOUT_MS = 5000;
const TRANSLATE_BATCH_SIZE = 40;
const PUBLIC_TRANSLATE_SEPARATOR = '\n⟪§⟫\n';

const subtitleCache = new Map<string, SubtitleCacheEntry>();
const subtitleTrackRegistry = new Map<string, RegisteredSubtitleTrack>();

const BRAZIL_REGEX = /\b(pob|pt[-_]?br|brazil|brazilian|brasil|brasileiro|brasileira)\b/i;
const PORTUGAL_REGEX = /\b(pt[-_]?pt|portugal|european\s*portuguese)\b/i;

function classifySubtitleTrack(
  track: OpenSubtitlesItem
): 'PT-BR' | 'PT-PT' | 'EN' | 'OTHER' {
  const code = (track.lang ?? '').toLowerCase().trim();
  const meta = `${track.label ?? ''} ${track.name ?? ''} ${track.SubFileName ?? ''} ${track.id ?? ''} ${track.url ?? ''}`.toLowerCase();

  // Separação rigorosa: PT-BR apenas para código 'pob' ou indicador explícito brasileiro
  if (code === 'pob' || code === 'pt-br' || code === 'ptbr' || code === 'pb') {
    return 'PT-BR';
  }
  if ((code === 'por' || code === 'pt') && BRAZIL_REGEX.test(meta) && !PORTUGAL_REGEX.test(meta)) {
    return 'PT-BR';
  }
  if (code === 'por' || code === 'pt' || code === 'pt-pt' || PORTUGAL_REGEX.test(meta)) {
    return 'PT-PT';
  }
  if (code === 'eng' || code === 'en' || code === 'en-us' || code === 'en-gb') {
    return 'EN';
  }
  return 'OTHER';
}

function extractReleaseName(track: OpenSubtitlesItem, fallbackIdx: number): string {
  const explicit = (track.SubFileName || track.name || track.label || '').trim();
  if (explicit && !/^(pob|por|eng|pt|en)$/i.test(explicit)) {
    return explicit;
  }
  if (track.url) {
    try {
      const parsed = new URL(track.url);
      const lastSeg = decodeURIComponent(parsed.pathname.split('/').pop() || '');
      if (lastSeg && !/^\d+\.(srt|vtt)$/i.test(lastSeg)) {
        return lastSeg.replace(/\.(srt|vtt|ass)$/i, '');
      }
    } catch {
      // ignora URL inválida
    }
  }
  return `OpenSubtitles #${fallbackIdx + 1}`;
}

export async function getVttByTrackId(trackId: string): Promise<string | null> {
  const reg = subtitleTrackRegistry.get(trackId);
  if (!reg) return null;
  if (reg.vtt) return reg.vtt;
  if (!reg.sourceUrl) return null;

  const raw = await downloadSubtitleText(reg.sourceUrl);
  if (!raw) return null;

  let vtt = srtToVtt(raw);
  if (reg.translateTarget) {
    vtt = await translateVtt(vtt, reg.translateTarget.lang, reg.translateTarget.iso2);
  }
  reg.vtt = vtt;
  return vtt;
}

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
    return Array.isArray(data.subtitles)
      ? (data.subtitles as OpenSubtitlesItem[]).map((item) => ({
          ...item,
          source: 'OpenSubtitles' as const,
        }))
      : [];
  } catch {
    return [];
  }
}

async function fetchWyzieSubtitleTracks(
  type: StreamMediaType,
  imdbId: string,
  season?: number,
  episode?: number
): Promise<OpenSubtitlesItem[]> {
  const url = new URL(WYZIE_SUBS_BASE);
  url.searchParams.set('id', imdbId);
  url.searchParams.set('language', 'pt,pb,en');
  if (type === 'tv') {
    url.searchParams.set('season', String(season ?? 1));
    url.searchParams.set('episode', String(episode ?? 1));
  }

  try {
    const res = await fetchWithTimeout(url.toString(), WYZIE_TIMEOUT_MS);
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown;
    const list = Array.isArray(raw) ? raw : [];
    const items: OpenSubtitlesItem[] = [];

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const subUrl = typeof rec.url === 'string' ? rec.url.trim() : '';
      if (!subUrl) continue;

      const langCode =
        typeof rec.language === 'string'
          ? rec.language
          : typeof rec.lang === 'string'
            ? rec.lang
            : '';
      const display = typeof rec.display === 'string' ? rec.display : '';
      const release =
        typeof rec.release === 'string'
          ? rec.release
          : typeof rec.fileName === 'string'
            ? rec.fileName
            : typeof rec.media === 'string'
              ? rec.media
              : '';

      items.push({
        id: typeof rec.id === 'string' ? rec.id : undefined,
        url: subUrl,
        lang: langCode,
        label: display,
        SubFileName: release || display || undefined,
        source: 'Wyzie',
      });
    }

    return items;
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
  const isPtBrTarget = lang.toLowerCase() === 'pt-br';
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

  // Consulta paralela: OpenSubtitles + Wyzie Subs, mesclando sem duplicatas
  const [openSubTracks, wyzieTracks] = await Promise.all([
    fetchSubtitleTrackList(type, imdbId, season, episode),
    fetchWyzieSubtitleTracks(type, imdbId, season, episode),
  ]);

  const dedupMap = new Map<string, OpenSubtitlesItem>();
  for (const t of [...openSubTracks, ...wyzieTracks]) {
    if (!t.url) continue;
    if (!dedupMap.has(t.url)) {
      dedupMap.set(t.url, t);
    }
  }
  const tracks = Array.from(dedupMap.values());

  // Classificação rigorosa de todas as faixas disponíveis
  const ptBrTracks: OpenSubtitlesItem[] = [];
  const ptPtTracks: OpenSubtitlesItem[] = [];
  const enTracks: OpenSubtitlesItem[] = [];

  for (const track of tracks) {
    const tag = classifySubtitleTrack(track);
    if (tag === 'PT-BR') ptBrTracks.push(track);
    else if (tag === 'PT-PT') ptPtTracks.push(track);
    else if (tag === 'EN') enTracks.push(track);
  }

  // Constrói lista ranqueada de até 12 opções selecionáveis
  const baseTrackKey = `${imdbId}-${season ?? 0}-${episode ?? 0}`;
  const seenUrls = new Set<string>();
  const options: SubtitleOptionItem[] = [];

  const registerOption = (
    track: OpenSubtitlesItem,
    langTag: SubtitleLangTag,
    idx: number,
    preloadedVtt?: string
  ): SubtitleOptionItem | null => {
    if (!track.url || seenUrls.has(track.url) || options.length >= 12) return null;
    seenUrls.add(track.url);
    const id = `${baseTrackKey}-${langTag.toLowerCase().replace(/\s+/g, '-')}-${idx}`;
    const releaseName = extractReleaseName(track, idx);
    const sourceLabel = track.source === 'Wyzie' ? 'Wyzie' : 'OpenSubtitles';
    subtitleTrackRegistry.set(id, {
      sourceUrl: track.url,
      ...(preloadedVtt ? { vtt: preloadedVtt } : {}),
    });
    const labelMap: Record<SubtitleLangTag, string> = {
      'PT-BR': `Português (Brasil) #${idx + 1}`,
      'PT-PT': `Português (Portugal) #${idx + 1}`,
      EN: `English #${idx + 1}`,
      'IA PT-BR': 'Português (Brasil · IA)',
    };
    const item: SubtitleOptionItem = {
      id,
      label: labelMap[langTag],
      langTag,
      releaseName: `${sourceLabel} · ${releaseName}`,
      url: `/api/subtitles/vtt?trackId=${encodeURIComponent(id)}`,
    };
    options.push(item);
    return item;
  };

  // 1. Seleciona faixa principal respeitando estritamente PT-BR vs PT-PT
  let primaryVtt: string | null = null;
  let primaryStatus: SubtitleStatus = 'none';
  let primarySourceLang: string | undefined;

  if (isPtBrTarget) {
    // Somente faixas PT-BR genuínas (pob / indicador Brasil) entram como nativas PT-BR
    const primaryBrTrack = ptBrTracks[0];
    if (primaryBrTrack?.url) {
      const rawSrt = await downloadSubtitleText(primaryBrTrack.url);
      if (rawSrt) {
        primaryVtt = srtToVtt(rawSrt);
        primaryStatus = 'native-pt';
        primarySourceLang = primaryBrTrack.lang ?? 'pob';
      }
    }
  } else {
    const acceptedCodes = [...openSubCodes, lang.toLowerCase(), iso2];
    let nativeTrack: OpenSubtitlesItem | undefined;
    for (const code of acceptedCodes) {
      nativeTrack = tracks.find((t) => (t.lang ?? '').toLowerCase() === code);
      if (nativeTrack) break;
    }
    if (nativeTrack?.url) {
      const rawSrt = await downloadSubtitleText(nativeTrack.url);
      if (rawSrt) {
        primaryVtt = srtToVtt(rawSrt);
        primaryStatus = iso2 === 'pt' ? 'native-pt' : 'native';
        primarySourceLang = nativeTrack.lang ?? openSubCodes[0];
      }
    }
  }

  // 2. Se não encontrou nativa PT-BR (mesmo que exista PT-PT ou EN) e autoTranslate está ativo, traduz para PT-BR
  let translatedOptionVtt: string | null = null;
  if (!primaryVtt && autoTranslate && iso2 !== 'en') {
    const sourceForTranslation = enTracks[0] ?? ptPtTracks[0];
    if (sourceForTranslation?.url) {
      const rawSrt = await downloadSubtitleText(sourceForTranslation.url);
      if (rawSrt) {
        const baseVtt = srtToVtt(rawSrt);
        translatedOptionVtt = await translateVtt(baseVtt, lang, iso2);
        primaryVtt = translatedOptionVtt;
        primaryStatus = 'auto-translated';
        primarySourceLang = sourceForTranslation.lang ?? 'eng';
      }
    }
  }

  // Popula lista ranqueada (até 12 opções): PT-BR -> IA PT-BR -> PT-PT -> EN
  ptBrTracks.slice(0, 5).forEach((t, idx) => {
    registerOption(t, 'PT-BR', idx, idx === 0 && primaryStatus === 'native-pt' && primaryVtt ? primaryVtt : undefined);
  });

  if (translatedOptionVtt && options.length < 12) {
    const aiId = `${baseTrackKey}-ia-pt-br`;
    subtitleTrackRegistry.set(aiId, { vtt: translatedOptionVtt });
    options.push({
      id: aiId,
      label: 'Português (Brasil · Tradução IA)',
      langTag: 'IA PT-BR',
      releaseName: 'Tradução automática para PT-BR',
      url: `/api/subtitles/vtt?trackId=${encodeURIComponent(aiId)}`,
    });
  } else if (isPtBrTarget && autoTranslate && !translatedOptionVtt && enTracks[0]?.url && options.length < 12) {
    // Oferece opção sob demanda de tradução IA para PT-BR
    const aiId = `${baseTrackKey}-ia-pt-br`;
    subtitleTrackRegistry.set(aiId, {
      sourceUrl: enTracks[0].url,
      translateTarget: { lang: 'pt-BR', iso2: 'pt' },
    });
    options.push({
      id: aiId,
      label: 'Português (Brasil · Tradução IA)',
      langTag: 'IA PT-BR',
      releaseName: `Auto-traduzir de ${extractReleaseName(enTracks[0], 0)}`,
      url: `/api/subtitles/vtt?trackId=${encodeURIComponent(aiId)}`,
    });
  }

  ptPtTracks.slice(0, 3).forEach((t, idx) => {
    registerOption(t, 'PT-PT', idx);
  });

  enTracks.slice(0, 3).forEach((t, idx) => {
    registerOption(t, 'EN', idx);
  });

  const entry: SubtitleCacheEntry = {
    key: cacheKey,
    status: primaryStatus,
    language: lang,
    vtt: primaryVtt,
    ...(primarySourceLang ? { sourceLang: primarySourceLang } : {}),
    options: options.slice(0, 12),
    createdAt: Date.now(),
  };

  subtitleCache.set(cacheKey, entry);
  return entry;
}
