import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem } from '../types/media';
import { MediaCard } from './MediaCard';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  ratings: Record<string, number>;
  watchlistKeys: Set<string>;
  onToggleWatchlist: (item: MediaItem) => void;
  onSelect: (item: MediaItem) => void;
  onViewAll?: () => void;
}

export function MediaRow({
  title,
  items,
  ratings,
  watchlistKeys,
  onToggleWatchlist,
  onSelect,
  onViewAll,
}: MediaRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
  }, [items, updateScrollState]);

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = Math.max(el.clientWidth * 0.78, 320);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  if (!items.length) return null;

  return (
    <section className="group/row relative">
      {/* Cabeçalho do trilho */}
      <div className="mb-4 flex items-baseline justify-between px-5 sm:px-10 lg:px-14">
        <h2 className="text-lg font-medium tracking-tight text-[var(--ph-text)] sm:text-xl">
          {title}
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-xs font-medium text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
          >
            Ver tudo
          </button>
        )}
      </div>

      {/* Área do carrossel */}
      <div className="relative">
        {/* Botão Voltar (discreto no hover em desktop) */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByAmount('left')}
            aria-label={`Voltar em ${title}`}
            className="absolute left-3 top-[38%] z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--ph-border)] bg-[var(--ph-surface-glass)] text-[var(--ph-text)] opacity-0 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-[var(--ph-surface-2)] group-hover/row:opacity-100 md:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {/* Lista horizontal */}
        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-5 pb-2 pt-1.5 sm:gap-5 sm:px-10 lg:px-14"
        >
          {items.map((item, idx) => {
            const key = `${item.media_type}-${item.id}`;
            return (
              <MediaCard
                key={key}
                item={item}
                index={idx}
                userRating={ratings[key]}
                inWatchlist={watchlistKeys.has(key)}
                onToggleWatchlist={onToggleWatchlist}
                onSelect={onSelect}
                className="w-[144px] shrink-0 sm:w-[168px] lg:w-[184px]"
              />
            );
          })}
        </div>

        {/* Botão Avançar (discreto no hover em desktop) */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByAmount('right')}
            aria-label={`Avançar em ${title}`}
            className="absolute right-3 top-[38%] z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--ph-border)] bg-[var(--ph-surface-glass)] text-[var(--ph-text)] opacity-0 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-[var(--ph-surface-2)] group-hover/row:opacity-100 md:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </section>
  );
}
