export type MediaType = 'movie' | 'tv';

export interface MediaItem {
    id: number;
    media_type: MediaType;
    title?: string;
    name?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    vote_average: number;
    vote_count: number;
    release_date?: string;
    first_air_date?: string;
}

export interface SeasonInfo {
    id: number;
    season_number: number;
    episode_count: number;
    name: string;
}

export interface MediaDetails extends MediaItem {
    imdb_id?: string | null;
    external_ids?: {
        imdb_id?: string | null;
    };
    genres: { id: number; name: string }[];
    runtime?: number;
    number_of_seasons?: number;
    seasons?: SeasonInfo[];
}

export interface PlayRequest {
    tmdbId: number;
    imdbId: string;
    type: MediaType;
    title: string;
    season?: number;
    episode?: number;
}