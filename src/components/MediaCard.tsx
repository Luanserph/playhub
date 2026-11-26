import { motion } from 'framer-motion';
import { Bookmark, Check, Film, Star, Tv } from 'lucide-react';
import { IMG_BASE } from '../services/tmdb';
import type { MediaItem } from '../types/media';

interface MediaCardProps {
  item: MediaItem;
  userRating?: number;
  inWatchlist?: boolean;
  onToggleWatchlist?: (item: MediaItem) => void;
  onSelect: (item: MediaItem) => void;
  index?: number;
  className?: string;
}

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 28,
};

export function MediaCard({
  item,
  userRating,
  inWatchlist = false,
  onToggleWatchlist,
  onSelect,
  index = 0,
  className = '',
}: MediaCardProps) {
  const title = item.title || item.name || 'Sem título';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const tmdbScore = item.vote_average ? item.vote_average.toFixed(1) : null;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item);
        }
      }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        opacity: { duration: 0.28, delay: Math.min(index * 0.03, 0.24) },
        y: { ...CARD_SPRING, delay: Math.min(index * 0.03, 0.24) },
      }}
      whileHover={{ y: -5, transition: CARD_SPRING }}
      className={`group flex cursor-pointer flex-col text-left focus:outline-none ${className}`}
    >
      {/* Pôster 2:3 */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-[var(--ph-surface)] ring-1 ring-[var(--ph-border)] transition-[box-shadow,ring-color] duration-300 group-hover:ring-[var(--ph-border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--ph-text)]">
        {item.poster_path ? (
          <img
            src={`${IMG_BASE.poster}${item.poster_path}`}
            alt={title}
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)]">
            {item.media_type === 'tv' ? (
              <Tv className="h-6 w-6 opacity-50" />
            ) : (
              <Film className="h-6 w-6 opacity-50" />
            )}
            <span className="text-[11px] opacity-60">Sem pôster</span>
          </div>
        )}

        {/* Botão discreto Minha Lista no hover (ou sempre visível quando salvo) */}
        {onToggleWatchlist && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.82 }}
            transition={{ type: 'spring', stiffness: 460, damping: 24 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatchlist(item);
            }}
            aria-label={
              inWatchlist
                ? `Remover ${title} da Minha Lista`
                : `Salvar ${title} na Minha Lista`
            }
            title={inWatchlist ? 'Na Minha Lista' : 'Adicionar à Minha Lista'}
            className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg backdrop-blur-md transition-all duration-200 ${
              inWatchlist
                ? 'bg-white text-zinc-950 opacity-100 shadow-sm'
                : 'bg-black/60 text-white/90 opacity-0 ring-1 ring-white/15 hover:bg-black/80 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {inWatchlist ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            ) : (
              <Bookmark className="h-3.5 w-3.5" />
            )}
          </motion.button>
        )}

        {/* Nota minimalista no canto */}
        {tmdbScore && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-[#FAFAFA] backdrop-blur-md tabular-nums">
            <Star className="h-2.5 w-2.5 fill-[#E5A93C] text-[#E5A93C]" />
            <span>{tmdbScore}</span>
          </div>
        )}

        {/* Avaliação pessoal discreta (se avaliado) */}
        {userRating && userRating > 0 && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-[#FAFAFA] ring-1 ring-white/10 backdrop-blur-md tabular-nums">
            <Star className="h-2.5 w-2.5 fill-[#E5A93C] text-[#E5A93C]" />
            <span>{userRating}/5</span>
          </div>
        )}
      </div>

      {/* Título e ano discretos abaixo do pôster */}
      <div className="mt-2.5 px-0.5">
        <h3 className="truncate text-[13px] font-medium text-[var(--ph-text)] opacity-90 transition-opacity group-hover:opacity-100">
          {title}
        </h3>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--ph-text-muted)]">
          <span className="tabular-nums">{year || '—'}</span>
          <span className="opacity-40">·</span>
          <span>{item.media_type === 'tv' ? 'Série' : 'Filme'}</span>
        </div>
      </div>
    </motion.div>
  );
}
