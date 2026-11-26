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
  overview?: string;
  poster_path?: string | null;
  air_date?: string | null;
}

export interface EpisodeInfo {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  runtime?: number | null;
  air_date?: string | null;
  vote_average?: number;
}

export interface SeasonDetails {
  id: number;
  season_number: number;
  name: string;
  overview?: string;
  poster_path: string | null;
  air_date?: string | null;
  episodes: EpisodeInfo[];
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface CrewInfo {
  directorOrCreators: string[];
  studioOrNetwork: string | null;
  runtimeLabel: string | null;
  certification: string | null;
  status: string | null;
  genres: string[];
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
  status?: string;
  tagline?: string;
  backdrops: string[];
  logoPath: string | null;
  cast: CastMember[];
  crewInfo: CrewInfo;
  recommendations: MediaItem[];
  trailerKey: string | null;
}

export interface PlayRequest {
  tmdbId: number;
  imdbId: string;
  type: MediaType;
  title: string;
  season?: number;
  episode?: number;
  stillPath?: string | null;
  offlineDownloadId?: string;
  offlineHasSubtitle?: boolean;
  offlineFileName?: string;
}
