import type { SyntheticEvent } from 'react';
import type {
    CastMember,
    CrewInfo,
    EpisodeInfo,
    MediaDetails,
    MediaItem,
    MediaType,
    SeasonDetails,
} from '../types/media';
import { resolveLanguageConfig } from '../utils/locale';

const ENV_API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() || '';
const BASE_URL = 'https://api.themoviedb.org/3';
const LOCAL_TMDB_PROXY_BASE = 'http://127.0.0.1:3001/api/tmdb';
const LOCAL_TMDB_IMAGE_PROXY_BASE = 'http://127.0.0.1:3001/api/tmdb-image';
const DIRECT_TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TMDB_KEY_STORAGE = 'playhub_tmdb_api_key';

let activeTmdbLanguage = resolveLanguageConfig('auto').tmdbLang;
let runtimeTmdbKey: string | null = null;

export function cleanTmdbKey(rawKey: string): string {
    return rawKey.trim().replace(/^Bearer\s+/i, '');
}

export function setRuntimeTmdbKey(key: string): void {
    runtimeTmdbKey = cleanTmdbKey(key);
}

export function getStoredTmdbKey(): string {
    if (runtimeTmdbKey !== null) return runtimeTmdbKey;
    try {
        return (localStorage.getItem(TMDB_KEY_STORAGE) || '').trim();
    } catch {
        return '';
    }
}

export function getActiveTmdbKey(): string | null {
    const saved = getStoredTmdbKey();
    if (saved) return saved;
    if (ENV_API_KEY) return ENV_API_KEY;
    return null;
}

export function getTmdbKeySource(): 'config' | 'env' | 'none' {
    if (getStoredTmdbKey()) return 'config';
    if (ENV_API_KEY) return 'env';
    return 'none';
}

class TmdbHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'TmdbHttpError';
        this.status = status;
    }
}

function buildDirectTmdbRequest(
    endpoint: string,
    key: string,
    params: Record<string, string> = {}
): { url: string; headers?: Record<string, string> } {
    const cleanedKey = cleanTmdbKey(key);
    const isV4Token = cleanedKey.length > 60;
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${BASE_URL}${normalizedEndpoint}`);
    let headers: Record<string, string> | undefined;

    if (isV4Token) {
        headers = {
            Authorization: `Bearer ${cleanedKey}`,
            Accept: 'application/json',
        };
    } else {
        url.searchParams.set('api_key', cleanedKey);
    }

    Object.entries(params).forEach(([k, value]) => {
        url.searchParams.set(k, value);
    });

    return { url: url.toString(), headers };
}

function buildProxyTmdbUrl(endpoint: string, params: Record<string, string> = {}): string {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${LOCAL_TMDB_PROXY_BASE}${normalizedEndpoint}`);
    Object.entries(params).forEach(([k, value]) => {
        url.searchParams.set(k, value);
    });
    return url.toString();
}

async function parseTmdbResponse<T>(res: Response): Promise<T> {
    const rawText = await res.text();
    let data: unknown = null;
    try {
        data = rawText ? JSON.parse(rawText) : null;
    } catch {
        throw new TmdbHttpError(
            res.status || 502,
            `Erro HTTP ${res.status || 502} ao acessar o TMDB (resposta não-JSON).`
        );
    }

    if (!res.ok) {
        const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const detail =
            (typeof record?.error === 'string' && record.error) ||
            (typeof record?.status_message === 'string' && record.status_message) ||
            res.statusText;
        throw new TmdbHttpError(
            res.status,
            detail
                ? `Erro HTTP ${res.status}: ${detail}`
                : `Erro na API TMDB (HTTP ${res.status})`
        );
    }

    return data as T;
}

export async function tmdbFetch<T>(
    endpoint: string,
    params: Record<string, string> = {},
    customKey?: string
): Promise<T> {
    const rawKey = customKey !== undefined ? customKey : getActiveTmdbKey() || '';
    const activeKey = cleanTmdbKey(rawKey);
    if (!activeKey) {
        throw new Error('MISSING_API_KEY');
    }

    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const finalParams: Record<string, string> = { ...params };
    if (normalizedEndpoint !== '/configuration' && !('language' in finalParams)) {
        finalParams.language = activeTmdbLanguage;
    }

    // 1. Tenta primeiro pelo backend local Fastify (sem Origin de navegador + cache em memória)
    const proxyUrl = buildProxyTmdbUrl(normalizedEndpoint, finalParams);
    let proxyResponse: Response | null = null;
    try {
        proxyResponse = await fetch(proxyUrl, {
            headers: {
                'x-tmdb-key': activeKey,
                Accept: 'application/json',
            },
        });
    } catch {
        // Backend local offline/inacessível: faz fallback automático para o TMDB direto
        proxyResponse = null;
    }

    if (proxyResponse) {
        return parseTmdbResponse<T>(proxyResponse);
    }

    // 2. Fallback direto pelo navegador
    const { url, headers } = buildDirectTmdbRequest(normalizedEndpoint, activeKey, finalParams);
    const directRes = headers ? await fetch(url, { headers }) : await fetch(url);
    return parseTmdbResponse<T>(directRes);
}

export interface TmdbValidationResult {
    ok: boolean;
    error?: string;
}

export async function validateTmdbKey(rawKey: string): Promise<TmdbValidationResult> {
    const key = cleanTmdbKey(rawKey);
    if (!key) {
        return { ok: false, error: 'Informe uma chave de API do TMDB.' };
    }

    try {
        await tmdbFetch<Record<string, unknown>>('/configuration', {}, key);
        return { ok: true };
    } catch (err) {
        if (err instanceof TmdbHttpError) {
            if (err.status === 401) {
                return {
                    ok: false,
                    error: 'Chave rejeitada pelo TMDB (HTTP 401). Verifique se copiou a API Key v3 ou Token v4 corretamente.',
                };
            }
            return {
                ok: false,
                error: err.message,
            };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            error: `Falha de rede ao conectar ao TMDB: ${message}`,
        };
    }
}

export function setTmdbLanguage(tmdbLang: string): void {
    activeTmdbLanguage = tmdbLang || 'pt-BR';
}

export function getTmdbLanguage(): string {
    return activeTmdbLanguage;
}

export type TmdbImageSize =
    | 'w92'
    | 'w154'
    | 'w185'
    | 'w300'
    | 'w342'
    | 'w500'
    | 'w780'
    | 'w1280'
    | 'h632'
    | 'original';

export function getImageUrl(
    path: string | null | undefined,
    size: TmdbImageSize = 'w500'
): string | null {
    if (!path) return null;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${LOCAL_TMDB_IMAGE_PROXY_BASE}/${size}${normalizedPath}`;
}

export function getDirectImageUrl(
    path: string | null | undefined,
    size: TmdbImageSize = 'w500'
): string | null {
    if (!path) return null;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${DIRECT_TMDB_IMAGE_BASE}/${size}${normalizedPath}`;
}

export function handleTmdbImageError(
    e: SyntheticEvent<HTMLImageElement>,
    path: string | null | undefined,
    size: TmdbImageSize = 'w500',
    onFinalError?: () => void
): void {
    const img = e.currentTarget;
    if (img.dataset.fallbackTried !== '1') {
        const directUrl = getDirectImageUrl(path, size);
        if (directUrl && img.src !== directUrl) {
            img.dataset.fallbackTried = '1';
            img.src = directUrl;
            return;
        }
    }
    img.dataset.fallbackTried = '1';
    if (onFinalError) {
        onFinalError();
    } else {
        img.style.display = 'none';
    }
}

export const IMG_BASE = {
    poster: `${LOCAL_TMDB_IMAGE_PROXY_BASE}/w500`,
    backdrop: `${LOCAL_TMDB_IMAGE_PROXY_BASE}/original`,
};

export interface GenreItem {
    id: number;
    name: string;
}

export type DiscoverSortBy =
    | 'popularity.desc'
    | 'vote_average.desc'
    | 'primary_release_date.desc'
    | 'first_air_date.desc'
    | 'vote_count.desc';

export type YearFilter = 'all' | '2026' | '2025' | '2024' | '2020s' | '2010s' | 'classics';

export interface DiscoverParams {
    type: MediaType;
    page?: number;
    genreId?: number | null;
    sortBy?: DiscoverSortBy;
    year?: YearFilter;
    releaseDateLte?: string | null;
    lang?: string;
}

export interface PaginatedMediaResponse {
    results: MediaItem[];
    page: number;
    total_pages: number;
    total_results: number;
}

export function extractImdbId(raw: string): string | null {
    const cleaned = raw.trim();
    const match = cleaned.match(/tt\d{7,9}/i);
    return match ? match[0].toLowerCase() : null;
}

export async function getTrending(filter: 'all' | 'movie' | 'tv' = 'all'): Promise<MediaItem[]> {
    const data = await tmdbFetch<{ results: MediaItem[] }>(`/trending/${filter}/week`);
    return data.results
        .filter((item) => item.media_type === 'movie' || item.media_type === 'tv' || filter !== 'all')
        .map((item) => ({
            ...item,
            media_type: (item.media_type || (filter === 'all' ? 'movie' : filter)) as MediaType,
        }));
}

export async function searchCatalogPaginated(
    query: string,
    page = 1,
    lang?: string
): Promise<PaginatedMediaResponse> {
    const imdbId = extractImdbId(query);

    // Busca direta por link ou ID do IMDb (ex: tt0371746)
    if (imdbId) {
        const data = await tmdbFetch<{
            movie_results: MediaItem[];
            tv_results: MediaItem[];
        }>(`/find/${imdbId}`, {
            external_source: 'imdb_id',
            ...(lang ? { language: lang } : {}),
        });

        const movies = data.movie_results.map((m) => ({ ...m, media_type: 'movie' as const }));
        const shows = data.tv_results.map((t) => ({ ...t, media_type: 'tv' as const }));
        const results = [...movies, ...shows];
        return {
            results,
            page: 1,
            total_pages: 1,
            total_results: results.length,
        };
    }

    // Busca paginada por nome do filme ou série
    const data = await tmdbFetch<{
        results: MediaItem[];
        page: number;
        total_pages: number;
        total_results: number;
    }>('/search/multi', {
        query,
        page: String(page),
        ...(lang ? { language: lang } : {}),
    });

    return {
        results: data.results.filter(
            (item) => item.media_type === 'movie' || item.media_type === 'tv'
        ),
        page: data.page,
        total_pages: data.total_pages,
        total_results: data.total_results,
    };
}

export async function searchCatalog(
    query: string,
    page = 1,
    lang?: string
): Promise<MediaItem[]> {
    const data = await searchCatalogPaginated(query, page, lang);
    return data.results;
}

interface RawTmdbImageItem {
    file_path?: string;
    iso_639_1?: string | null;
    vote_average?: number;
    vote_count?: number;
    width?: number;
}

interface RawTmdbDetailsResponse extends Omit<MediaDetails, 'backdrops' | 'logoPath' | 'cast' | 'crewInfo' | 'recommendations' | 'trailerKey'> {
    episode_run_time?: number[];
    created_by?: { id: number; name: string }[];
    networks?: { id: number; name: string }[];
    production_companies?: { id: number; name: string }[];
    images?: {
        backdrops?: RawTmdbImageItem[];
        logos?: RawTmdbImageItem[];
    };
    credits?: {
        cast?: { id: number; name: string; character?: string; profile_path?: string | null }[];
        crew?: { id: number; name: string; job?: string }[];
    };
    recommendations?: {
        results?: MediaItem[];
    };
    videos?: {
        results?: { key?: string; site?: string; type?: string; official?: boolean; iso_639_1?: string }[];
    };
    content_ratings?: {
        results?: { iso_3166_1?: string; rating?: string }[];
    };
    release_dates?: {
        results?: {
            iso_3166_1?: string;
            release_dates?: { certification?: string }[];
        }[];
    };
}

function translateTmdbStatus(raw?: string): string | null {
    if (!raw) return null;
    const map: Record<string, string> = {
        Released: 'Lançado',
        'Returning Series': 'Em exibição',
        Ended: 'Finalizada',
        'In Production': 'Em produção',
        Planned: 'Planejado',
        'Post Production': 'Pós-produção',
        Canceled: 'Cancelada',
        Pilot: 'Piloto',
    };
    return map[raw] || raw;
}

function formatRuntimeLabel(
    type: MediaType,
    runtime?: number,
    episodeRunTime?: number[],
    numberOfSeasons?: number
): string | null {
    if (type === 'movie' && runtime && runtime > 0) {
        const h = Math.floor(runtime / 60);
        const m = runtime % 60;
        return h > 0 ? `${h}h ${m}min` : `${m} min`;
    }
    if (type === 'tv') {
        const parts: string[] = [];
        if (numberOfSeasons && numberOfSeasons > 0) {
            parts.push(`${numberOfSeasons} ${numberOfSeasons === 1 ? 'temporada' : 'temporadas'}`);
        }
        const epRuntime = episodeRunTime?.[0];
        if (epRuntime && epRuntime > 0) {
            parts.push(`${epRuntime} min/ep`);
        }
        return parts.length > 0 ? parts.join(' · ') : null;
    }
    return null;
}

function extractCertification(type: MediaType, data: RawTmdbDetailsResponse): string | null {
    if (type === 'tv') {
        const list = data.content_ratings?.results ?? [];
        const preferred =
            list.find((r) => r.iso_3166_1 === 'BR' && r.rating?.trim()) ||
            list.find((r) => r.iso_3166_1 === 'US' && r.rating?.trim()) ||
            list.find((r) => r.rating?.trim());
        return preferred?.rating?.trim() || null;
    }

    const list = data.release_dates?.results ?? [];
    for (const country of ['BR', 'US']) {
        const entry = list.find((r) => r.iso_3166_1 === country);
        const cert = entry?.release_dates?.find((d) => d.certification?.trim())?.certification?.trim();
        if (cert) return cert;
    }
    for (const entry of list) {
        const cert = entry.release_dates?.find((d) => d.certification?.trim())?.certification?.trim();
        if (cert) return cert;
    }
    return null;
}

function extractBackdrops(data: RawTmdbDetailsResponse): string[] {
    const rawList = data.images?.backdrops ?? [];
    const sorted = [...rawList]
        .filter((img): img is RawTmdbImageItem & { file_path: string } => Boolean(img.file_path))
        .sort((a, b) => {
            // Prioriza banners limpos sem texto (iso_639_1 === null)
            const aClean = a.iso_639_1 === null ? 1 : 0;
            const bClean = b.iso_639_1 === null ? 1 : 0;
            if (aClean !== bClean) return bClean - aClean;
            return (b.vote_average ?? 0) - (a.vote_average ?? 0);
        });

    const unique = new Set<string>();
    if (data.backdrop_path) unique.add(data.backdrop_path);
    for (const img of sorted) {
        unique.add(img.file_path);
        if (unique.size >= 6) break;
    }
    return Array.from(unique).slice(0, 6);
}

function extractLogoPath(data: RawTmdbDetailsResponse): string | null {
    const logos = (data.images?.logos ?? []).filter(
        (img): img is RawTmdbImageItem & { file_path: string } => Boolean(img.file_path)
    );
    if (logos.length === 0) return null;

    const pickByLang = (lang: string | null) =>
        logos
            .filter((l) => (l.iso_639_1 ?? null) === lang)
            .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];

    const chosen = pickByLang('pt') || pickByLang('en') || pickByLang(null) || logos[0];
    return chosen?.file_path ?? null;
}

function extractTrailerKey(data: RawTmdbDetailsResponse): string | null {
    const videos = (data.videos?.results ?? []).filter(
        (v) => v.site === 'YouTube' && typeof v.key === 'string' && v.key.trim().length > 0
    );
    if (videos.length === 0) return null;

    const chosen =
        videos.find((v) => v.type === 'Trailer' && v.official) ||
        videos.find((v) => v.type === 'Trailer') ||
        videos.find((v) => v.type === 'Teaser') ||
        videos[0];
    return chosen?.key?.trim() || null;
}

export async function getMediaDetails(type: MediaType, id: number): Promise<MediaDetails> {
    const data = await tmdbFetch<RawTmdbDetailsResponse>(`/${type}/${id}`, {
        append_to_response:
            'external_ids,images,credits,recommendations,videos,content_ratings,release_dates',
        include_image_language: 'pt,en,null',
    });

    const directors =
        type === 'movie'
            ? (data.credits?.crew ?? [])
                  .filter((c) => c.job === 'Director')
                  .map((c) => c.name)
                  .slice(0, 3)
            : (data.created_by ?? []).map((c) => c.name).slice(0, 3);

    const studioOrNetwork =
        type === 'tv'
            ? data.networks?.[0]?.name || data.production_companies?.[0]?.name || null
            : data.production_companies?.[0]?.name || null;

    const cast: CastMember[] = (data.credits?.cast ?? []).slice(0, 12).map((c) => ({
        id: c.id,
        name: c.name,
        character: c.character || '',
        profilePath: c.profile_path ?? null,
    }));

    const recommendations: MediaItem[] = (data.recommendations?.results ?? [])
        .filter((item) => item && typeof item.id === 'number')
        .slice(0, 10)
        .map((item) => ({
            ...item,
            media_type: (item.media_type === 'movie' || item.media_type === 'tv'
                ? item.media_type
                : type) as MediaType,
        }));

    const crewInfo: CrewInfo = {
        directorOrCreators: directors,
        studioOrNetwork,
        runtimeLabel: formatRuntimeLabel(
            type,
            data.runtime,
            data.episode_run_time,
            data.number_of_seasons
        ),
        certification: extractCertification(type, data),
        status: translateTmdbStatus(data.status),
        genres: (data.genres ?? []).map((g) => g.name),
    };

    return {
        ...data,
        media_type: type,
        imdb_id: data.imdb_id || data.external_ids?.imdb_id || null,
        backdrops: extractBackdrops(data),
        logoPath: extractLogoPath(data),
        cast,
        crewInfo,
        recommendations,
        trailerKey: extractTrailerKey(data),
    };
}

export async function getSeasonDetails(tvId: number, seasonNumber: number): Promise<SeasonDetails> {
    const data = await tmdbFetch<{
        id: number;
        season_number: number;
        name: string;
        overview?: string;
        poster_path?: string | null;
        air_date?: string | null;
        episodes?: Partial<EpisodeInfo>[];
    }>(`/tv/${tvId}/season/${seasonNumber}`);

    const episodes: EpisodeInfo[] = Array.isArray(data.episodes)
        ? data.episodes.map((ep, idx) => ({
              id: ep.id ?? idx + 1,
              episode_number: ep.episode_number ?? idx + 1,
              season_number: ep.season_number ?? seasonNumber,
              name: ep.name || `Episódio ${ep.episode_number ?? idx + 1}`,
              overview: ep.overview || '',
              still_path: ep.still_path ?? null,
              runtime: ep.runtime ?? null,
              air_date: ep.air_date ?? null,
              vote_average: ep.vote_average,
          }))
        : [];

    return {
        id: data.id,
        season_number: data.season_number ?? seasonNumber,
        name: data.name || `Temporada ${seasonNumber}`,
        overview: data.overview,
        poster_path: data.poster_path ?? null,
        air_date: data.air_date ?? null,
        episodes,
    };
}

export async function getPopularMovies(): Promise<MediaItem[]> {
    const data = await tmdbFetch<{ results: MediaItem[] }>('/movie/popular');
    return data.results.map((item) => ({
        ...item,
        media_type: 'movie' as const,
    }));
}

export async function getPopularTv(): Promise<MediaItem[]> {
    const data = await tmdbFetch<{ results: MediaItem[] }>('/tv/popular');
    return data.results.map((item) => ({
        ...item,
        media_type: 'tv' as const,
    }));
}

export async function getGenres(type: MediaType, lang?: string): Promise<GenreItem[]> {
    const data = await tmdbFetch<{ genres: GenreItem[] }>(
        `/genre/${type}/list`,
        lang ? { language: lang } : {}
    );
    return Array.isArray(data.genres) ? data.genres : [];
}

export async function discoverMedia(params: DiscoverParams): Promise<PaginatedMediaResponse> {
    const {
        type,
        page = 1,
        genreId,
        sortBy = 'popularity.desc',
        year = 'all',
        releaseDateLte,
        lang,
    } = params;

    const effectiveSortBy =
        type === 'tv' && sortBy === 'primary_release_date.desc'
            ? 'first_air_date.desc'
            : type === 'movie' && sortBy === 'first_air_date.desc'
              ? 'primary_release_date.desc'
              : sortBy;

    const query: Record<string, string> = {
        page: String(page),
        sort_by: effectiveSortBy,
        include_adult: 'false',
    };

    if (genreId) {
        query.with_genres = String(genreId);
    }

    if (effectiveSortBy === 'vote_average.desc') {
        query['vote_count.gte'] = '200';
    }

    const dateKeyGte = type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    const dateKeyLte = type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';

    // Evita itens futuros sem data ao ordenar por lançamentos
    if (
        effectiveSortBy === 'primary_release_date.desc' ||
        effectiveSortBy === 'first_air_date.desc'
    ) {
        const today = new Date().toISOString().slice(0, 10);
        query[dateKeyLte] = today;
        query['vote_count.gte'] = '15';
    }

    // Filtro de ano / década
    if (year && year !== 'all') {
        if (year === '2026' || year === '2025' || year === '2024') {
            if (type === 'movie') {
                query.primary_release_year = year;
            } else {
                query.first_air_date_year = year;
            }
        } else if (year === '2020s') {
            query[dateKeyGte] = '2020-01-01';
            query[dateKeyLte] = '2029-12-31';
        } else if (year === '2010s') {
            query[dateKeyGte] = '2010-01-01';
            query[dateKeyLte] = '2019-12-31';
        } else if (year === 'classics') {
            query[dateKeyLte] = '2009-12-31';
        }
    }

    // Janela de data para Date Slicing (permite continuar além do limite de 500 páginas por consulta do TMDB)
    if (releaseDateLte) {
        query[dateKeyLte] = releaseDateLte;
    }

    const data = await tmdbFetch<{
        results: MediaItem[];
        page: number;
        total_pages: number;
        total_results: number;
    }>(`/discover/${type}`, {
        ...query,
        ...(lang ? { language: lang } : {}),
    });

    return {
        results: data.results.map((item) => ({
            ...item,
            media_type: type,
        })),
        page: data.page,
        total_pages: data.total_pages,
        total_results: data.total_results,
    };
}
