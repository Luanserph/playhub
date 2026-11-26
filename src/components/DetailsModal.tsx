import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, Clock, Loader2, Play, Star, X } from 'lucide-react';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { getImageUrl, getMediaDetails, handleTmdbImageError } from '../services/tmdb';
import type { MediaDetails, MediaItem, PlayRequest } from '../types/media';

interface DetailsModalProps {
  item: MediaItem | null;
  userRating?: number;
  inWatchlist?: boolean;
  onToggleWatchlist?: (item: MediaItem) => void;
  onRate: (key: string, rating: number) => void;
  onClose: () => void;
  onPlay: (item: MediaItem, req: PlayRequest) => void;
}

const SHEET_SPRING = {
  type: 'spring' as const,
  stiffness: 340,
  damping: 34,
  mass: 0.9,
};

export function DetailsModal({
  item,
  userRating = 0,
  inWatchlist = false,
  onToggleWatchlist,
  onRate,
  onClose,
  onPlay,
}: DetailsModalProps) {
  const isDesktop = useIsDesktop(768);

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
          className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch"
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
            className="fixed inset-0 bg-[var(--ph-backdrop-overlay)] backdrop-blur-sm"
          />

          <DetailsPanel
            key={`${item.media_type}-${item.id}`}
            item={item}
            isDesktop={isDesktop}
            userRating={userRating}
            inWatchlist={inWatchlist}
            onToggleWatchlist={onToggleWatchlist}
            onRate={onRate}
            onClose={onClose}
            onPlay={onPlay}
          />
        </div>
      )}
    </AnimatePresence>
  );
}

interface DetailsPanelProps {
  item: MediaItem;
  isDesktop: boolean;
  userRating: number;
  inWatchlist: boolean;
  onToggleWatchlist?: (item: MediaItem) => void;
  onRate: (key: string, rating: number) => void;
  onClose: () => void;
  onPlay: (item: MediaItem, req: PlayRequest) => void;
}

function DetailsPanel({
  item,
  isDesktop,
  userRating,
  inWatchlist,
  onToggleWatchlist,
  onRate,
  onClose,
  onPlay,
}: DetailsPanelProps) {
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [hoverStar, setHoverStar] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    getMediaDetails(item.media_type, item.id)
      .then((res) => {
        if (active) setDetails(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.media_type, item.id]);

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
  const episodeCount = currentSeasonObj?.episode_count || 12;
  const imdbId = details?.imdb_id;
  const displayStars = hoverStar ?? userRating;

  const handleWatch = () => {
    if (!imdbId) return;
    onPlay(item, {
      tmdbId: item.id,
      imdbId,
      type: item.media_type,
      title,
      ...(item.media_type === 'tv' ? { season, episode } : {}),
    });
  };

  return (
    <motion.div
      initial={isDesktop ? { x: '100%' } : { y: '100%' }}
      animate={isDesktop ? { x: 0 } : { y: 0 }}
      exit={isDesktop ? { x: '100%' } : { y: '100%' }}
      transition={SHEET_SPRING}
      onClick={(e) => e.stopPropagation()}
      className={
        isDesktop
          ? 'relative z-10 flex h-full w-full max-w-[540px] flex-col overflow-y-auto border-l border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-2xl'
          : 'relative z-10 flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--ph-border)] bg-[var(--ph-surface)] pb-[env(safe-area-inset-bottom)] shadow-2xl'
      }
    >
      {/* Indicador de puxar no Mobile */}
      {!isDesktop && (
        <div className="pointer-events-none sticky top-0 z-30 flex justify-center pt-3">
          <span className="h-1 w-10 rounded-full bg-white/30" />
        </div>
      )}

      {/* Botão fechar */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar painel"
        className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/85"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Banner cinematográfico */}
      <div className="relative h-60 w-full shrink-0 bg-[var(--ph-surface-2)] sm:h-72">
        {(item.backdrop_path || item.poster_path) ? (
          <img
            key={`${item.id}-${item.backdrop_path || item.poster_path}`}
            src={
              item.backdrop_path
                ? getImageUrl(item.backdrop_path, 'original') || ''
                : getImageUrl(item.poster_path, 'w500') || ''
            }
            alt={title}
            onError={(e) =>
              handleTmdbImageError(
                e,
                item.backdrop_path || item.poster_path,
                item.backdrop_path ? 'original' : 'w500'
              )
            }
            className="h-full w-full object-cover object-center"
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, var(--ph-surface) 0%, color-mix(in srgb, var(--ph-surface) 45%, transparent) 55%, rgba(0,0,0,0.18) 100%)',
          }}
        />
      </div>

      {/* Corpo do painel */}
      <div className="relative -mt-14 flex flex-1 flex-col px-6 pb-8">
        {/* Metadados */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ph-text-muted)]">
          <span className="uppercase tracking-[0.14em] text-[var(--ph-text)] opacity-80">
            {item.media_type === 'tv' ? 'Série' : 'Filme'}
          </span>
          {year && (
            <>
              <span className="opacity-40">·</span>
              <span className="tabular-nums">{year}</span>
            </>
          )}
          {details?.runtime && details.runtime > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="h-3 w-3" />
                {details.runtime} min
              </span>
            </>
          )}
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1 font-medium text-[var(--ph-text)] tabular-nums">
            <Star className="h-3.5 w-3.5 fill-[#E5A93C] text-[#E5A93C]" />
            {item.vote_average.toFixed(1)}
          </span>
        </div>

        {/* Título */}
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ph-text)] sm:text-3xl">
          {title}
        </h2>

        {/* Gêneros e IMDb ID */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {imdbId && (
            <span className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--ph-text-muted)] tabular-nums">
              {imdbId}
            </span>
          )}
          {details?.genres?.slice(0, 4).map((g) => (
            <span
              key={g.id}
              className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-hover-subtle)] px-2.5 py-0.5 text-[11px] text-[var(--ph-text-muted)]"
            >
              {g.name}
            </span>
          ))}
        </div>

        {/* Ações: Assistir Agora + Minha Lista */}
        <div className="mt-6 flex items-center gap-2.5">
          <button
            type="button"
            disabled={loading || !imdbId}
            onClick={handleWatch}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-6 text-sm font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
            <span>
              {loading
                ? 'Carregando detalhes...'
                : !imdbId
                  ? 'ID IMDb indisponível'
                  : item.media_type === 'tv'
                    ? `Assistir Agora · T${season} E${episode}`
                    : 'Assistir Agora'}
            </span>
          </button>

          {onToggleWatchlist && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 450, damping: 24 }}
              onClick={() => onToggleWatchlist(item)}
              aria-label={inWatchlist ? 'Remover da Minha Lista' : 'Salvar na Minha Lista'}
              title={inWatchlist ? 'Salvo na Minha Lista' : 'Salvar na Minha Lista'}
              className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors ${inWatchlist
                  ? 'border-[var(--ph-border-strong)] bg-[var(--ph-hover)] text-[var(--ph-text)]'
                  : 'border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]'
                }`}
            >
              {inWatchlist ? (
                <>
                  <Check className="h-4 w-4" strokeWidth={2.25} />
                  <span className="hidden sm:inline">Na Lista</span>
                </>
              ) : (
                <>
                  <Bookmark className="h-4 w-4" />
                  <span className="hidden sm:inline">Salvar</span>
                </>
              )}
            </motion.button>
          )}
        </div>

        {/* Sinopse */}
        <div className="mt-6">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
            Sinopse
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ph-text)] opacity-85">
            {details?.overview || item.overview || 'Sinopse indisponível em português.'}
          </p>
        </div>

        {/* Seletor de Temporada / Episódio para séries */}
        {item.media_type === 'tv' && validSeasons.length > 0 && (
          <div className="mt-6 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
              Selecionar episódio
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-xs text-[var(--ph-text-muted)]">
                Temporada
                <select
                  value={season}
                  onChange={(e) => {
                    setSeason(Number(e.target.value));
                    setEpisode(1);
                  }}
                  className="h-10 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 text-sm text-[var(--ph-text)] outline-none transition-colors focus:border-[var(--ph-border-strong)] tabular-nums"
                >
                  {validSeasons.map((s) => (
                    <option key={s.id} value={s.season_number}>
                      Temporada {s.season_number}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-xs text-[var(--ph-text-muted)]">
                Episódio
                <select
                  value={episode}
                  onChange={(e) => setEpisode(Number(e.target.value))}
                  className="h-10 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 text-sm text-[var(--ph-text)] outline-none transition-colors focus:border-[var(--ph-border-strong)] tabular-nums"
                >
                  {Array.from({ length: episodeCount }, (_, i) => i + 1).map((ep) => (
                    <option key={ep} value={ep}>
                      Episódio {ep}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {/* Sistema de avaliação pessoal (1 a 5 estrelas) */}
        <div className="mt-6 flex items-center justify-between rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 py-3.5">
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
                  transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                  onMouseEnter={() => setHoverStar(star)}
                  onClick={() => onRate(ratingKey, star === userRating ? 0 : star)}
                  aria-label={`Avaliar com ${star} estrelas`}
                  className="p-1 focus:outline-none"
                >
                  <Star
                    className={`h-5 w-5 transition-colors ${active
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
    </motion.div>
  );
}
