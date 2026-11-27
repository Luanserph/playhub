import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Download,
  Film,
  Loader2,
  Play,
  Star,
  Tv,
  User,
  X,
} from 'lucide-react';
import {
  resolvePlayback,
  type DownloadItem,
  type ResolvedStream,
  type StartDownloadPayload,
} from '../services/playerApi';
import type { SourcePreferences } from '../services/storage';
import {
  getImageUrl,
  getMediaDetails,
  getSeasonDetails,
  handleTmdbImageError,
} from '../services/tmdb';
import type {
  EpisodeInfo,
  MediaDetails,
  MediaItem,
  PlayRequest,
  SeasonDetails,
} from '../types/media';
import type { LanguageConfig } from '../utils/locale';

interface DetailsModalProps {
  item: MediaItem | null;
  userRating?: number;
  inWatchlist?: boolean;
  onToggleWatchlist?: (item: MediaItem) => void;
  onRate: (key: string, rating: number) => void;
  onClose: () => void;
  onPlay: (item: MediaItem, req: PlayRequest) => void;
  onSelectRelated?: (item: MediaItem) => void;
  downloads?: DownloadItem[];
  addons?: string[];
  sourcePreferences?: SourcePreferences;
  languageConfig?: LanguageConfig;
  onStartDownload?: (payload: StartDownloadPayload) => Promise<void>;
}

const MODAL_SPRING = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 32,
  mass: 0.9,
};

const SLIDESHOW_INTERVAL_MS = 7000;

export function DetailsModal({
  item,
  userRating = 0,
  inWatchlist = false,
  onToggleWatchlist,
  onRate,
  onClose,
  onPlay,
  onSelectRelated,
  downloads = [],
  addons = [],
  sourcePreferences,
  languageConfig,
  onStartDownload,
}: DetailsModalProps) {
  useEffect(() => {
    if (!item) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [item, onClose]);

  return (
    <AnimatePresence>
      {item && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 pt-[calc(var(--safe-top)+8px)] pb-[calc(var(--safe-bottom)+8px)] sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={item.title || item.name || 'Detalhes'}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          <DetailsFullView
            key={`${item.media_type}-${item.id}`}
            item={item}
            userRating={userRating}
            inWatchlist={inWatchlist}
            onToggleWatchlist={onToggleWatchlist}
            onRate={onRate}
            onClose={onClose}
            onPlay={onPlay}
            onSelectRelated={onSelectRelated}
            downloads={downloads}
            addons={addons}
            sourcePreferences={sourcePreferences}
            languageConfig={languageConfig}
            onStartDownload={onStartDownload}
          />
        </div>
      )}
    </AnimatePresence>
  );
}

interface DetailsFullViewProps {
  item: MediaItem;
  userRating: number;
  inWatchlist: boolean;
  onToggleWatchlist?: (item: MediaItem) => void;
  onRate: (key: string, rating: number) => void;
  onClose: () => void;
  onPlay: (item: MediaItem, req: PlayRequest) => void;
  onSelectRelated?: (item: MediaItem) => void;
  downloads: DownloadItem[];
  addons: string[];
  sourcePreferences?: SourcePreferences;
  languageConfig?: LanguageConfig;
  onStartDownload?: (payload: StartDownloadPayload) => Promise<void>;
}

function DetailsFullView({
  item,
  userRating,
  inWatchlist,
  onToggleWatchlist,
  onRate,
  onClose,
  onPlay,
  onSelectRelated,
  downloads,
  addons,
  sourcePreferences,
  languageConfig,
  onStartDownload,
}: DetailsFullViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(1);
  const [seasonDetails, setSeasonDetails] = useState<SeasonDetails | null>(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [downloadPickerTarget, setDownloadPickerTarget] = useState<{
    season?: number;
    episode?: number;
    label: string;
    stillPath?: string | null;
  } | null>(null);
  const [pickerStreams, setPickerStreams] = useState<ResolvedStream[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [startingDownloadId, setStartingDownloadId] = useState<string | null>(null);

  // Carrega detalhes completos do título
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSlideIndex(0);
    setLogoFailed(false);
    setTrailerOpen(false);
    scrollContainerRef.current?.scrollTo({ top: 0 });

    getMediaDetails(item.media_type, item.id)
      .then((res) => {
        if (!active) return;
        setDetails(res);
        const firstValidSeason = (res.seasons ?? []).find((s) => s.season_number > 0);
        if (firstValidSeason) {
          setSeason(firstValidSeason.season_number);
        }
      })
      .catch(() => {
        if (active) setDetails(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.media_type, item.id]);

  // Carrega episódios detalhados da temporada selecionada (para séries)
  useEffect(() => {
    if (item.media_type !== 'tv') return;
    let active = true;
    setLoadingSeason(true);

    getSeasonDetails(item.id, season)
      .then((res) => {
        if (active) setSeasonDetails(res);
      })
      .catch(() => {
        if (active) setSeasonDetails(null);
      })
      .finally(() => {
        if (active) setLoadingSeason(false);
      });

    return () => {
      active = false;
    };
  }, [item.media_type, item.id, season]);

  const backdrops = useMemo(() => {
    if (details?.backdrops && details.backdrops.length > 0) {
      return details.backdrops;
    }
    if (item.backdrop_path) return [item.backdrop_path];
    if (item.poster_path) return [item.poster_path];
    return [];
  }, [details?.backdrops, item.backdrop_path, item.poster_path]);

  // Slideshow automático suave a cada 7 segundos
  useEffect(() => {
    if (backdrops.length <= 1 || trailerOpen) return;
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % backdrops.length);
    }, SLIDESHOW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [backdrops.length, trailerOpen]);

  const title = details?.title || details?.name || item.title || item.name || 'Sem título';
  const year = (
    details?.release_date ||
    details?.first_air_date ||
    item.release_date ||
    item.first_air_date ||
    ''
  ).slice(0, 4);
  const ratingKey = `${item.media_type}-${item.id}`;
  const validSeasons = (details?.seasons || []).filter((s) => s.season_number > 0);
  const currentSeasonObj = validSeasons.find((s) => s.season_number === season);
  const imdbId = details?.imdb_id;
  const displayStars = hoverStar ?? userRating;
  const activeBackdropPath = backdrops[slideIndex] || backdrops[0] || null;
  const activeBackdropSize = item.backdrop_path || details?.backdrops?.length ? 'w1280' : 'w500';
  const logoUrl = details?.logoPath ? getImageUrl(details.logoPath, 'w500') : null;

  const seasonThemeBgPath =
    seasonDetails?.poster_path ||
    currentSeasonObj?.poster_path ||
    details?.backdrop_path ||
    item.backdrop_path ||
    null;

  const findExistingDownload = (targetSeason?: number, targetEpisode?: number): DownloadItem | undefined => {
    if (!imdbId) return undefined;
    return downloads.find(
      (d) =>
        d.imdbId === imdbId &&
        d.mediaType === item.media_type &&
        (item.media_type === 'movie' ||
          ((d.season ?? 1) === (targetSeason ?? 1) && (d.episode ?? 1) === (targetEpisode ?? 1)))
    );
  };

  const movieDownload = item.media_type === 'movie' ? findExistingDownload() : undefined;

  const openDownloadPicker = async (target: {
    season?: number;
    episode?: number;
    label: string;
    stillPath?: string | null;
  }) => {
    if (!imdbId || !onStartDownload) return;
    setDownloadPickerTarget(target);
    setPickerStreams([]);
    setPickerError(null);
    setPickerLoading(true);
    try {
      const res = await resolvePlayback({
        imdbId,
        type: item.media_type,
        season: target.season,
        episode: target.episode,
        addons,
        enableBuiltInProviders: sourcePreferences?.enableBuiltInProviders ?? true,
        torznabUrl: sourcePreferences?.torznabUrl,
        torznabApiKey: sourcePreferences?.torznabApiKey,
        preferPtBr: true,
        autoSubtitles: false,
        lang: languageConfig?.locale ?? 'pt-BR',
        iso2: languageConfig?.iso2 ?? 'pt',
        openSubCodes: languageConfig?.openSubCodes ?? ['pob'],
      });
      const torrentSources = res.streams.filter(
        (s) => s.sourceType === 'torrent' && Boolean(s.infoHash)
      );
      setPickerStreams(torrentSources);
      if (torrentSources.length === 0) {
        setPickerError('Nenhuma fonte torrent disponível para download neste título.');
      }
    } catch {
      setPickerError('Servidor local offline. Inicie o backend para baixar.');
    } finally {
      setPickerLoading(false);
    }
  };

  const handleConfirmDownloadSource = async (stream: ResolvedStream) => {
    if (!imdbId || !onStartDownload || !stream.infoHash || !downloadPickerTarget) return;
    setStartingDownloadId(stream.id);
    try {
      await onStartDownload({
        imdbId,
        tmdbId: item.id,
        mediaType: item.media_type,
        title,
        season: downloadPickerTarget.season,
        episode: downloadPickerTarget.episode,
        posterPath: item.poster_path,
        backdropPath: downloadPickerTarget.stillPath || item.backdrop_path,
        quality: stream.resolution || stream.quality,
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? 'auto',
      });
      setDownloadPickerTarget(null);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Falha ao iniciar download.');
    } finally {
      setStartingDownloadId(null);
    }
  };

  const handleWatch = (overrideSeason?: number, overrideEpisode?: number, stillPath?: string | null) => {
    if (!imdbId) return;
    onPlay(item, {
      tmdbId: item.id,
      imdbId,
      type: item.media_type,
      title,
      ...(item.media_type === 'tv'
        ? {
            season: overrideSeason ?? season,
            episode: overrideEpisode ?? 1,
            stillPath: stillPath ?? null,
          }
        : {}),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 12 }}
      transition={MODAL_SPRING}
      onClick={(e) => e.stopPropagation()}
      className="relative z-10 flex h-[92vh] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-3xl border border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-2xl"
    >
      {/* Barra fixa flutuante: Voltar + Fechar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-3.5 text-xs font-medium text-white backdrop-blur-md transition-colors hover:bg-black/80"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/80"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Área rolável completa */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* TOPO CINEMATOGRÁFICO com Slideshow Crossfade */}
        <div className="relative min-h-[380px] w-full overflow-hidden bg-[#09090B] sm:min-h-[450px] lg:min-h-[500px]">
          <AnimatePresence mode="sync">
            {activeBackdropPath && (
              <motion.img
                key={activeBackdropPath}
                src={getImageUrl(activeBackdropPath, activeBackdropSize) || ''}
                alt={title}
                initial={{ opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                onError={(e) => handleTmdbImageError(e, activeBackdropPath, activeBackdropSize)}
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
            )}
          </AnimatePresence>

          {/* Gradientes escuros na base e lateral esquerda para leitura impecável */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, var(--ph-surface) 0%, rgba(9,9,11,0.72) 38%, rgba(9,9,11,0.22) 100%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, rgba(9,9,11,0.88) 0%, rgba(9,9,11,0.52) 48%, transparent 100%)',
            }}
          />

          {/* Controles discretos do slideshow (setas + bolinhas) */}
          {backdrops.length > 1 && (
            <div className="absolute bottom-5 right-5 z-20 flex items-center gap-2 sm:bottom-7 sm:right-8">
              <button
                type="button"
                onClick={() =>
                  setSlideIndex((prev) => (prev - 1 + backdrops.length) % backdrops.length)
                }
                aria-label="Imagem anterior"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/80 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2.5 py-1.5 backdrop-blur-md">
                {backdrops.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSlideIndex(idx)}
                    aria-label={`Ir para imagem ${idx + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === slideIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSlideIndex((prev) => (prev + 1) % backdrops.length)}
                aria-label="Próxima imagem"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/80 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Conteúdo sobreposto ao banner */}
          <div className="relative z-10 flex min-h-[380px] flex-col justify-end px-6 pb-8 pt-20 sm:min-h-[450px] sm:px-10 sm:pb-10 lg:min-h-[500px] lg:px-12">
            <div className="max-w-2xl">
              {/* Metadados principais */}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-white/80">
                <span className="uppercase tracking-[0.16em] text-white">
                  {item.media_type === 'tv' ? 'Série' : 'Filme'}
                </span>
                {year && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="tabular-nums">{year}</span>
                  </>
                )}
                {details?.crewInfo?.runtimeLabel && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock className="h-3 w-3" />
                      {details.crewInfo.runtimeLabel}
                    </span>
                  </>
                )}
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-white tabular-nums">
                  <Star className="h-3.5 w-3.5 fill-[#E5A93C] text-[#E5A93C]" />
                  {(details?.vote_average ?? item.vote_average).toFixed(1)}
                </span>
                {details?.crewInfo?.certification && (
                  <span className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                    {details.crewInfo.certification}
                  </span>
                )}
              </div>

              {/* Logo oficial transparente ou Título editorial */}
              {logoUrl && !logoFailed ? (
                <img
                  src={logoUrl}
                  alt={title}
                  onError={(e) =>
                    handleTmdbImageError(e, details?.logoPath, 'w500', () => setLogoFailed(true))
                  }
                  className="mb-2 max-h-24 w-auto max-w-[320px] object-contain object-left drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)] sm:max-h-28 sm:max-w-[400px]"
                />
              ) : (
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                  {title}
                </h2>
              )}

              {details?.tagline && (
                <p className="mt-2 text-sm italic text-white/70">{details.tagline}</p>
              )}

              {/* Botões principais: Assistir Agora, Trailer, Minha Lista */}
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={loading || !imdbId}
                  onClick={() => handleWatch()}
                  className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-white px-6 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-zinc-950" />
                  )}
                  <span>
                    {loading
                      ? 'Carregando...'
                      : !imdbId
                        ? 'ID IMDb indisponível'
                        : item.media_type === 'tv'
                          ? `Assistir · T${season} E1`
                          : 'Assistir Agora'}
                  </span>
                </button>

                {item.media_type === 'movie' && onStartDownload && imdbId && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => openDownloadPicker({ label: title })}
                    className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium backdrop-blur-md transition-colors active:scale-[0.98] ${
                      movieDownload?.status === 'completed'
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/20 bg-black/50 text-white hover:bg-white/15'
                    }`}
                  >
                    {movieDownload?.status === 'completed' ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-400" />
                        <span>Baixado</span>
                      </>
                    ) : movieDownload?.status === 'downloading' ||
                      movieDownload?.status === 'queued' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="tabular-nums">
                          Baixando {Math.round(movieDownload.progress)}%
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        <span>Baixar</span>
                      </>
                    )}
                  </button>
                )}

                {details?.trailerKey && (
                  <button
                    type="button"
                    onClick={() => setTrailerOpen(true)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-black/50 px-4 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/15 active:scale-[0.98]"
                  >
                    <Clapperboard className="h-4 w-4" />
                    <span>Trailer</span>
                  </button>
                )}

                {onToggleWatchlist && (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => onToggleWatchlist(item)}
                    className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium backdrop-blur-md transition-colors ${
                      inWatchlist
                        ? 'border-white/30 bg-white/20 text-white'
                        : 'border-white/15 bg-black/45 text-white/90 hover:bg-white/15'
                    }`}
                  >
                    {inWatchlist ? (
                      <>
                        <Check className="h-4 w-4" strokeWidth={2.25} />
                        <span>Na Minha Lista</span>
                      </>
                    ) : (
                      <>
                        <Bookmark className="h-4 w-4" />
                        <span>Minha Lista</span>
                      </>
                    )}
                  </motion.button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CORPO EDITORIAL ABAIXO DO BANNER */}
        <div className="space-y-10 px-6 py-8 sm:px-10 lg:px-12">
          {/* Sinopse + Ficha Técnica Lateral */}
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            <div className="space-y-6">
              <div>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                  Sinopse
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--ph-text)] opacity-90 sm:text-[15px]">
                  {details?.overview || item.overview || 'Sinopse indisponível em português.'}
                </p>
              </div>

              {/* Avaliação Pessoal */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--ph-text)]">Sua avaliação</p>
                  <p className="text-xs text-[var(--ph-text-muted)] tabular-nums">
                    {userRating > 0 ? `${userRating} de 5 estrelas` : 'Toque para avaliar'}
                  </p>
                </div>

                <div
                  className="flex items-center gap-1"
                  onMouseLeave={() => setHoverStar(null)}
                >
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = star <= displayStars;
                    return (
                      <motion.button
                        key={star}
                        type="button"
                        whileTap={{ scale: 0.85 }}
                        whileHover={{ scale: 1.12 }}
                        onMouseEnter={() => setHoverStar(star)}
                        onClick={() => onRate(ratingKey, star === userRating ? 0 : star)}
                        aria-label={`Avaliar com ${star} estrelas`}
                        className="p-1 focus:outline-none"
                      >
                        <Star
                          className={`h-5 w-5 transition-colors ${
                            active
                              ? 'fill-[#E5A93C] text-[#E5A93C]'
                              : 'text-[var(--ph-text-muted)] opacity-35 hover:opacity-70'
                          }`}
                        />
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Ficha Técnica Lateral */}
            <aside className="space-y-3 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-5 text-xs">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                Ficha Técnica
              </p>

              {details?.crewInfo?.directorOrCreators &&
                details.crewInfo.directorOrCreators.length > 0 && (
                  <div>
                    <p className="text-[var(--ph-text-muted)]">
                      {item.media_type === 'tv' ? 'Criação' : 'Direção'}
                    </p>
                    <p className="mt-0.5 font-medium text-[var(--ph-text)]">
                      {details.crewInfo.directorOrCreators.join(', ')}
                    </p>
                  </div>
                )}

              {details?.crewInfo?.studioOrNetwork && (
                <div>
                  <p className="text-[var(--ph-text-muted)]">
                    {item.media_type === 'tv' ? 'Emissora / Estúdio' : 'Estúdio'}
                  </p>
                  <p className="mt-0.5 font-medium text-[var(--ph-text)]">
                    {details.crewInfo.studioOrNetwork}
                  </p>
                </div>
              )}

              {details?.crewInfo?.genres && details.crewInfo.genres.length > 0 && (
                <div>
                  <p className="text-[var(--ph-text-muted)]">Gêneros</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {details.crewInfo.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface)] px-2 py-0.5 text-[11px] text-[var(--ph-text)]"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {details?.crewInfo?.status && (
                <div>
                  <p className="text-[var(--ph-text-muted)]">Status</p>
                  <p className="mt-0.5 font-medium text-[var(--ph-text)]">
                    {details.crewInfo.status}
                  </p>
                </div>
              )}

              {imdbId && (
                <div>
                  <p className="text-[var(--ph-text-muted)]">IMDb ID</p>
                  <p className="mt-0.5 font-mono text-[var(--ph-text)]">{imdbId}</p>
                </div>
              )}
            </aside>
          </div>

          {/* SEÇÃO DE TEMPORADAS E EPISÓDIOS (Temática com camada protetora forte) */}
          {item.media_type === 'tv' && validSeasons.length > 0 && (
            <section className="relative overflow-hidden rounded-3xl border border-[var(--ph-border)] bg-zinc-950">
              {/* Imagem de fundo temática da temporada/série */}
              {seasonThemeBgPath && (
                <img
                  key={seasonThemeBgPath}
                  src={getImageUrl(seasonThemeBgPath, 'w780') || ''}
                  alt=""
                  aria-hidden="true"
                  onError={(e) => handleTmdbImageError(e, seasonThemeBgPath, 'w780')}
                  className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover object-center opacity-45"
                />
              )}

              {/* Camada protetora forte garantindo contraste impecável */}
              <div className="pointer-events-none absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0.88) 45%, rgba(9,9,11,0.96) 100%)',
                }}
              />

              <div className="relative z-10 p-5 sm:p-7">
                {/* Cabeçalho + Abas de Temporada */}
                <div className="flex flex-col gap-4 border-b border-white/10 pb-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold tracking-tight text-white sm:text-lg">
                      Temporadas e Episódios
                    </h3>
                    {seasonDetails?.episodes && (
                      <span className="text-xs text-white/60 tabular-nums">
                        {seasonDetails.episodes.length}{' '}
                        {seasonDetails.episodes.length === 1 ? 'episódio' : 'episódios'}
                      </span>
                    )}
                  </div>

                  {/* Abas horizontais de temporadas */}
                  <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                    {validSeasons.map((s) => {
                      const active = s.season_number === season;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSeason(s.season_number)}
                          className={`shrink-0 rounded-xl px-4 py-2 text-xs font-medium transition-colors tabular-nums ${
                            active
                              ? 'bg-white text-zinc-950 shadow-sm'
                              : 'border border-white/15 bg-white/[0.06] text-white/80 hover:bg-white/15 hover:text-white'
                          }`}
                        >
                          Temporada {s.season_number}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Lista de Episódios */}
                <div className="mt-5">
                  {loadingSeason ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-xs text-white/70">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Carregando episódios da Temporada {season}...</span>
                    </div>
                  ) : seasonDetails && seasonDetails.episodes.length > 0 ? (
                    <div className="space-y-3">
                      {seasonDetails.episodes.map((ep) => (
                        <EpisodeRowCard
                          key={ep.id}
                          episode={ep}
                          disabled={!imdbId}
                          downloadItem={findExistingDownload(ep.season_number, ep.episode_number)}
                          onPlay={() =>
                            handleWatch(ep.season_number, ep.episode_number, ep.still_path)
                          }
                          onDownload={
                            onStartDownload && imdbId
                              ? () =>
                                  void openDownloadPicker({
                                    season: ep.season_number,
                                    episode: ep.episode_number,
                                    label: `${title} · T${ep.season_number} E${String(ep.episode_number).padStart(2, '0')}`,
                                    stillPath: ep.still_path,
                                  })
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-xs text-white/65">
                      Detalhes de episódios indisponíveis para esta temporada.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ELENCO (Carrossel Horizontal) */}
          {details?.cast && details.cast.length > 0 && (
            <section>
              <h3 className="mb-4 text-base font-semibold tracking-tight text-[var(--ph-text)]">
                Elenco Principal
              </h3>
              <div className="no-scrollbar flex gap-3.5 overflow-x-auto pb-2">
                {details.cast.map((person) => (
                  <div
                    key={person.id}
                    className="w-[116px] shrink-0 sm:w-[128px]"
                  >
                    <div className="aspect-[2/3] w-full overflow-hidden rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)]">
                      {person.profilePath ? (
                        <img
                          src={getImageUrl(person.profilePath, 'w185') || ''}
                          alt={person.name}
                          loading="lazy"
                          onError={(e) => handleTmdbImageError(e, person.profilePath, 'w185')}
                          className="h-full w-full object-cover object-top"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[var(--ph-text-muted)] opacity-45">
                          <User className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs font-medium text-[var(--ph-text)]">
                      {person.name}
                    </p>
                    {person.character && (
                      <p className="truncate text-[11px] text-[var(--ph-text-muted)]">
                        {person.character}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TÍTULOS SEMELHANTES (Trilho clicável) */}
          {details?.recommendations && details.recommendations.length > 0 && (
            <section className="pb-2">
              <h3 className="mb-4 text-base font-semibold tracking-tight text-[var(--ph-text)]">
                Títulos Semelhantes
              </h3>
              <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
                {details.recommendations.map((rec) => {
                  const recTitle = rec.title || rec.name || 'Sem título';
                  const recYear = (rec.release_date || rec.first_air_date || '').slice(0, 4);
                  const recPoster = getImageUrl(rec.poster_path, 'w342');
                  return (
                    <button
                      key={`${rec.media_type}-${rec.id}`}
                      type="button"
                      onClick={() => onSelectRelated?.(rec)}
                      className="group w-[132px] shrink-0 text-left focus:outline-none sm:w-[148px]"
                    >
                      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] transition-colors group-hover:border-[var(--ph-border-strong)]">
                        {recPoster ? (
                          <img
                            src={recPoster}
                            alt={recTitle}
                            loading="lazy"
                            onError={(e) => handleTmdbImageError(e, rec.poster_path, 'w342')}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--ph-text-muted)] opacity-45">
                            {rec.media_type === 'tv' ? (
                              <Tv className="h-5 w-5" />
                            ) : (
                              <Film className="h-5 w-5" />
                            )}
                          </div>
                        )}
                      </div>
                      <p className="mt-2 truncate text-xs font-medium text-[var(--ph-text)]">
                        {recTitle}
                      </p>
                      <p className="text-[11px] text-[var(--ph-text-muted)] tabular-nums">
                        {recYear || '—'} · {rec.media_type === 'tv' ? 'Série' : 'Filme'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Modal Seletor de Fonte para Download */}
      <AnimatePresence>
        {downloadPickerTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDownloadPickerTarget(null)}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-[#121215] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    Escolher fonte para download
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-white">
                    {downloadPickerTarget.label}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDownloadPickerTarget(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto p-4">
                {pickerLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-xs text-white/70">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Buscando fontes disponíveis...</span>
                  </div>
                ) : pickerError ? (
                  <p className="py-8 text-center text-xs text-white/65">{pickerError}</p>
                ) : (
                  <div className="space-y-2">
                    {pickerStreams.map((stream) => (
                      <button
                        key={stream.id}
                        type="button"
                        disabled={startingDownloadId !== null}
                        onClick={() => void handleConfirmDownloadSource(stream)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-left transition-colors hover:border-white/25 hover:bg-white/10 disabled:opacity-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-white tabular-nums">
                            <span>{stream.resolution || stream.quality}</span>
                            {stream.size && (
                              <span className="font-normal text-white/70">· {stream.size}</span>
                            )}
                            {stream.seeders !== undefined && (
                              <span className="font-normal text-white/70">
                                · 👤 {stream.seeders}
                              </span>
                            )}
                            {stream.containerTag && (
                              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium">
                                {stream.containerTag}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-white/55">
                            {stream.releaseTitle || stream.name}
                          </p>
                        </div>
                        {startingDownloadId === stream.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white" />
                        ) : (
                          <Download className="h-4 w-4 shrink-0 text-white/75" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Overlay do Trailer YouTube */}
      <AnimatePresence>
        {trailerOpen && details?.trailerKey && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTrailerOpen(false)}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md sm:p-8"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setTrailerOpen(false)}
                aria-label="Fechar trailer"
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-md hover:bg-black"
              >
                <X className="h-4 w-4" />
              </button>
              <iframe
                src={`https://www.youtube.com/embed/${encodeURIComponent(details.trailerKey)}?autoplay=1&rel=0`}
                title={`Trailer de ${title}`}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
                className="h-full w-full border-0"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EpisodeRowCard({
  episode,
  disabled,
  downloadItem,
  onPlay,
  onDownload,
}: {
  episode: EpisodeInfo;
  disabled: boolean;
  downloadItem?: DownloadItem;
  onPlay: () => void;
  onDownload?: () => void;
}) {
  const [stillFailed, setStillFailed] = useState(false);
  const stillUrl = getImageUrl(episode.still_path, 'w500');
  const epCode = `E${String(episode.episode_number).padStart(2, '0')}`;

  return (
    <div className="group flex w-full flex-col gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:border-white/25 hover:bg-white/[0.09] sm:flex-row sm:items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onPlay}
        className="flex min-w-0 flex-1 flex-col gap-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:items-center"
      >
        {/* Miniatura 16:9 com Play no hover */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10 sm:w-44">
          {stillUrl && !stillFailed ? (
            <img
              src={stillUrl}
              alt={episode.name}
              loading="lazy"
              onError={(e) =>
                handleTmdbImageError(e, episode.still_path, 'w500', () => setStillFailed(true))
              }
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/30">
              <Tv className="h-5 w-5" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg">
              <Play className="h-4 w-4 translate-x-[1px] fill-zinc-950" />
            </span>
          </div>
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white backdrop-blur-sm">
            {epCode}
          </span>
        </div>

        {/* Infos do Episódio */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="truncate text-sm font-medium text-white">
              {episode.episode_number}. {episode.name}
            </h4>
            <div className="flex items-center gap-2 text-[11px] text-white/55 tabular-nums">
              {episode.runtime && episode.runtime > 0 && <span>{episode.runtime} min</span>}
              {episode.air_date && (
                <>
                  {episode.runtime ? <span className="opacity-40">·</span> : null}
                  <span>{episode.air_date.slice(0, 10)}</span>
                </>
              )}
            </div>
          </div>
          {episode.overview && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-white/65">
              {episode.overview}
            </p>
          )}
        </div>
      </button>

      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          title={
            downloadItem?.status === 'completed'
              ? 'Episódio baixado'
              : downloadItem?.status === 'downloading'
                ? `Baixando (${Math.round(downloadItem.progress)}%)`
                : `Baixar episódio ${epCode}`
          }
          className={`flex h-9 shrink-0 items-center justify-center gap-1.5 self-end rounded-xl border px-3 text-xs font-medium transition-colors sm:self-center ${
            downloadItem?.status === 'completed'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-white/15 bg-white/[0.06] text-white/80 hover:bg-white/15 hover:text-white'
          }`}
        >
          {downloadItem?.status === 'completed' ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : downloadItem?.status === 'downloading' || downloadItem?.status === 'queued' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="font-mono text-[11px] tabular-nums">
                {Math.round(downloadItem.progress)}%
              </span>
            </>
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
}
