import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Info, Loader2, Play, Star } from 'lucide-react';
import { getImageUrl, getMediaDetails, handleTmdbImageError } from '../services/tmdb';
import type { MediaItem, PlayRequest } from '../types/media';

interface HeroSectionProps {
  item: MediaItem;
  onOpenDetails: (item: MediaItem) => void;
  onPlay: (item: MediaItem, req: PlayRequest) => void;
}

export function HeroSection({ item, onOpenDetails, onPlay }: HeroSectionProps) {
  const [resolvingPlay, setResolvingPlay] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);

  const title = item.title || item.name || 'Sem título';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const score = item.vote_average ? item.vote_average.toFixed(1) : null;
  const backdropUrl = getImageUrl(item.backdrop_path, 'original');

  useEffect(() => {
    setBackdropFailed(false);
  }, [item.id, item.backdrop_path]);

  const handleQuickPlay = async () => {
    if (resolvingPlay) return;
    setResolvingPlay(true);
    try {
      const details = await getMediaDetails(item.media_type, item.id);
      if (details.imdb_id) {
        onPlay(item, {
          tmdbId: item.id,
          imdbId: details.imdb_id,
          type: item.media_type,
          title: details.title || details.name || title,
          ...(item.media_type === 'tv' ? { season: 1, episode: 1 } : {}),
        });
      } else {
        onOpenDetails(item);
      }
    } catch {
      onOpenDetails(item);
    } finally {
      setResolvingPlay(false);
    }
  };

  return (
    <section className="relative min-h-[66vh] w-full overflow-hidden sm:min-h-[74vh] lg:min-h-[78vh]">
      {/* Backdrop full-bleed */}
      {backdropUrl && !backdropFailed && (
        <motion.img
          key={item.id}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          src={backdropUrl}
          alt={title}
          onError={(e) =>
            handleTmdbImageError(e, item.backdrop_path, 'original', () => setBackdropFailed(true))
          }
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      )}

      {/* Gradientes cinematográficos mesclando ao fundo (Escuro Cinema ou Claro Editorial) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, var(--ph-bg) 0%, color-mix(in srgb, var(--ph-bg) 68%, transparent) 42%, color-mix(in srgb, var(--ph-bg) 14%, transparent) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, var(--ph-bg) 0%, color-mix(in srgb, var(--ph-bg) 65%, transparent) 45%, transparent 100%)',
        }}
      />

      {/* Conteúdo editorial */}
      <div className="relative z-10 flex min-h-[66vh] flex-col justify-end px-5 pb-12 pt-24 sm:min-h-[74vh] sm:px-10 sm:pb-16 lg:min-h-[78vh] lg:px-14">
        <motion.div
          key={`content-${item.id}`}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          {/* Metadados */}
          <div className="mb-3.5 flex flex-wrap items-center gap-3 text-xs font-medium text-[var(--ph-text-muted)]">
            <span className="uppercase tracking-[0.16em] text-[var(--ph-text)] opacity-85">
              {item.media_type === 'tv' ? 'Série em destaque' : 'Filme em destaque'}
            </span>
            {year && (
              <>
                <span className="opacity-35">·</span>
                <span className="tabular-nums">{year}</span>
              </>
            )}
            {score && (
              <>
                <span className="opacity-35">·</span>
                <span className="inline-flex items-center gap-1 text-[var(--ph-text)] tabular-nums">
                  <Star className="h-3.5 w-3.5 fill-[#E5A93C] text-[#E5A93C]" />
                  {score}
                </span>
              </>
            )}
          </div>

          {/* Título */}
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--ph-text)] sm:text-5xl lg:text-6xl">
            {title}
          </h1>

          {/* Sinopse curta */}
          {item.overview && (
            <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-relaxed text-[var(--ph-text-muted)] sm:text-[15px]">
              {item.overview}
            </p>
          )}

          {/* Ações */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleQuickPlay}
              disabled={resolvingPlay}
              className="inline-flex h-11 items-center gap-2.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-6 text-sm font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)] active:scale-[0.98] disabled:cursor-wait disabled:opacity-75"
            >
              {resolvingPlay ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4 fill-current" />
              )}
              <span>{resolvingPlay ? 'Preparando...' : 'Assistir Agora'}</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenDetails(item)}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-btn-secondary-bg)] px-5 text-sm font-medium text-[var(--ph-text)] backdrop-blur-md transition-colors hover:bg-[var(--ph-btn-secondary-hover)] active:scale-[0.98]"
            >
              <Info className="h-4 w-4" />
              <span>Mais Detalhes</span>
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
