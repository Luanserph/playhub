import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Film, Play, Tv, X } from 'lucide-react';
import type { WatchHistoryEntry } from '../services/storage';
import { getImageUrl, handleTmdbImageError } from '../services/tmdb';
import type { MediaItem, PlayRequest } from '../types/media';

interface ContinueWatchingRowProps {
  entries: WatchHistoryEntry[];
  onResume: (entry: WatchHistoryEntry, req: PlayRequest) => void;
  onOpenDetails: (item: MediaItem) => void;
  onRemove: (key: string) => void;
}

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 28,
};

export function ContinueWatchingRow({
  entries,
  onResume,
  onOpenDetails,
  onRemove,
}: ContinueWatchingRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [failedImageKeys, setFailedImageKeys] = useState<Record<string, true>>({});

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [entries, updateScrollState]);

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = Math.max(el.clientWidth * 0.78, 340);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  if (entries.length === 0) return null;

  return (
    <section className="group/row relative">
      {/* Cabeçalho */}
      <div className="mb-4 flex items-baseline justify-between px-5 sm:px-10 lg:px-14">
        <h2 className="text-lg font-medium tracking-tight text-[var(--ph-text)] sm:text-xl">
          Continuar Assistindo
        </h2>
        <span className="text-xs text-[var(--ph-text-muted)] tabular-nums">
          {entries.length} {entries.length === 1 ? 'título' : 'títulos'}
        </span>
      </div>

      <div className="relative">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByAmount('left')}
            aria-label="Voltar em Continuar Assistindo"
            className="absolute left-3 top-[38%] z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--ph-border)] bg-[var(--ph-surface-glass)] text-[var(--ph-text)] opacity-0 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-[var(--ph-surface-2)] group-hover/row:opacity-100 md:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-5 pb-2 pt-1.5 sm:gap-5 sm:px-10 lg:px-14"
        >
          <AnimatePresence initial={false}>
            {entries.map((entry, idx) => {
              const title = entry.item.title || entry.item.name || 'Sem título';
              const imagePath = entry.item.backdrop_path || entry.item.poster_path;
              const imageSize = entry.item.backdrop_path ? 'original' : 'w500';
              const imageUrl = getImageUrl(imagePath, imageSize);
              const isImageFailed = Boolean(failedImageKeys[entry.key]);

              const handleResume = () => {
                onResume(entry, {
                  tmdbId: entry.item.id,
                  imdbId: entry.imdbId,
                  type: entry.item.media_type,
                  title,
                  ...(entry.item.media_type === 'tv'
                    ? { season: entry.season ?? 1, episode: entry.episode ?? 1 }
                    : {}),
                });
              };

              return (
                <motion.div
                  key={entry.key}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{
                    opacity: { duration: 0.24, delay: Math.min(idx * 0.04, 0.2) },
                    y: CARD_SPRING,
                    layout: CARD_SPRING,
                  }}
                  whileHover={{ y: -4, transition: CARD_SPRING }}
                  className="group relative w-[256px] shrink-0 sm:w-[300px] lg:w-[324px]"
                >
                  {/* Card 16:9 */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={handleResume}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleResume();
                      }
                    }}
                    className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl bg-[var(--ph-surface)] ring-1 ring-[var(--ph-border)] transition-[ring-color] duration-300 group-hover:ring-[var(--ph-border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ph-text)]"
                  >
                    {imagePath && imageUrl && !isImageFailed ? (
                      <img
                        src={imageUrl}
                        alt={title}
                        loading="lazy"
                        draggable={false}
                        onError={(e) =>
                          handleTmdbImageError(e, imagePath, imageSize, () =>
                            setFailedImageKeys((prev) => ({ ...prev, [entry.key]: true }))
                          )
                        }
                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)]">
                        {entry.item.media_type === 'tv' ? (
                          <Tv className="h-6 w-6 opacity-50" />
                        ) : (
                          <Film className="h-6 w-6 opacity-50" />
                        )}
                      </div>
                    )}

                    {/* Vinheta suave inferior para contraste da barra de progresso */}
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

                    {/* Ícone discreto de retomar no centro/hover */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-zinc-950 shadow-lg">
                        <Play className="h-4 w-4 translate-x-[1px] fill-zinc-950" />
                      </span>
                    </div>

                    {/* Botão discreto para remover do histórico */}
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.85 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(entry.key);
                      }}
                      aria-label={`Remover ${title} do histórico`}
                      title="Remover do histórico"
                      className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-100 backdrop-blur-md transition-all hover:bg-black/85 hover:text-white md:opacity-0 md:group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </motion.button>

                    {/* Barra de progresso fina h-1 na base */}
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                      <div
                        className="h-full bg-white transition-all duration-300"
                        style={{ width: `${Math.max(4, Math.min(100, entry.progressPercent))}%` }}
                      />
                    </div>
                  </div>

                  {/* Título e metadado abaixo */}
                  <div className="mt-2.5 flex items-start justify-between gap-2 px-0.5">
                    <button
                      type="button"
                      onClick={() => onOpenDetails(entry.item)}
                      className="min-w-0 flex-1 text-left focus:outline-none"
                    >
                      <h3 className="truncate text-[13px] font-medium text-[var(--ph-text)] transition-opacity group-hover:opacity-100">
                        {title}
                      </h3>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--ph-text-muted)] tabular-nums">
                        <span>
                          {entry.item.media_type === 'tv'
                            ? `T${entry.season ?? 1} · E${entry.episode ?? 1}`
                            : 'Filme'}
                        </span>
                        <span className="opacity-40">·</span>
                        <span>{entry.progressPercent}%</span>
                      </div>
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByAmount('right')}
            aria-label="Avançar em Continuar Assistindo"
            className="absolute right-3 top-[38%] z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--ph-border)] bg-[var(--ph-surface-glass)] text-[var(--ph-text)] opacity-0 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-[var(--ph-surface-2)] group-hover/row:opacity-100 md:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </section>
  );
}
