import type { MediaDetails, MediaItem, MediaType } from '../types/media';
import { resolveLanguageConfig } from '../utils/locale';

const ENV_API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() || '';
const BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_KEY_STORAGE = 'playhub_tmdb_api_key';

let activeTmdbLanguage = resolveLanguageConfig('auto').tmdbLang;
let runtimeTmdbKey: string | null = null;

export function setRuntimeTmdbKey(key: string): void {
    runtimeTmdbKey = key.trim();
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

function buildTmdbRequest(
    endpoint: string,
    key: string,
    params: Record<string, string> = {},
    langOverride?: string
): { url: string; headers: Record<string, string> } {
    const cleanedKey = key.trim();
    const isV4Token = cleanedKey.length > 60;
    const url = new URL(`${BASE_URL}${endpoint}`);
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (isV4Token) {
        headers.Authorization = `Bearer ${cleanedKey}`;
    } else {
        url.searchParams.set('api_key', cleanedKey);
    }

    if (langOverride !== '') {
        url.searchParams.set('language', langOverride || activeTmdbLanguage);
    }

    Object.entries(params).forEach(([k, value]) => {
        url.searchParams.set(k, value);
    });

    return { url: url.toString(), headers };
}

export async function validateTmdbKey(rawKey: string): Promise<boolean> {
    const cleaned = rawKey.trim();
    if (!cleaned) return false;
    try {
        const { url, headers } = buildTmdbRequest('/configuration', cleaned, {}, '');
        const res = await fetch(url, { headers });
        return res.ok;
    } catch {
        return false;
    }
}

export function setTmdbLanguage(tmdbLang: string): void {
    activeTmdbLanguage = tmdbLang || 'pt-BR';
}

export function getTmdbLanguage(): string {
    return activeTmdbLanguage;
}

export const IMG_BASE = {
    poster: 'https://image.tmdb.org/t/p/w500',
    backdrop: 'https://image.tmdb.org/t/p/original',
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

async function tmdbFetch<T>(
    endpoint: string,
    params: Record<string, string> = {},
    langOverride?: string
): Promise<T> {
    const activeKey = getActiveTmdbKey();
    if (!activeKey) {
        throw new Error('MISSING_API_KEY');
    }

    const { url, headers } = buildTmdbRequest(endpoint, activeKey, params, langOverride);

    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`Erro na API TMDB (${res.status})`);
    }
    return res.json() as Promise<T>;
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
        }>(`/find/${imdbId}`, { external_source: 'imdb_id' }, lang);

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
    }>('/search/multi', { query, page: String(page) }, lang);

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
    const data = await tmdbFetch<{ genres: GenreItem[] }>(`/genre/${type}/list`, {}, lang);
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
    }>(`/discover/${type}`, query, lang);

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
