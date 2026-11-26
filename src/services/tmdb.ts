import type { SyntheticEvent } from 'react';
import type { MediaDetails, MediaItem, MediaType } from '../types/media';
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

export async function getMediaDetails(type: MediaType, id: number): Promise<MediaDetails> {
    const data = await tmdbFetch<MediaDetails>(`/${type}/${id}`, {
        append_to_response: 'external_ids',
    });
    return {
        ...data,
        media_type: type,
        imdb_id: data.imdb_id || data.external_ids?.imdb_id || null,
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
