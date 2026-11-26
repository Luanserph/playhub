import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Film, Loader2, Search, Star, Tv, X } from 'lucide-react';
import { extractImdbId, IMG_BASE, searchCatalogPaginated } from '../services/tmdb';
import type { MediaItem } from '../types/media';

interface CommandSearchProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: MediaItem) => void;
}

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.035,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 380, damping: 30 },
  },
};

export function CommandSearch({ open, onClose, onSelect }: CommandSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const detectedImdb = extractImdbId(query);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    let cancelled = false;

    const debounce = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchCatalogPaginated(trimmed, 1);
        if (!cancelled) {
          setResults(data.results);
          setPage(data.page);
          setTotalPages(data.total_pages);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) {
          setError('Não foi possível concluir a busca.');
          setResults([]);
          setPage(1);
          setTotalPages(1);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
    };
  }, [query, open]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      setPage(1);
      setTotalPages(1);
      setError(null);
      setLoading(false);
      setActiveIndex(0);
    }
  };

  const handleLoadMore = async () => {
    const trimmed = query.trim();
    if (!trimmed || loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    try {
      const next = await searchCatalogPaginated(trimmed, page + 1);
      setResults((prev) => {
        const existing = new Set(prev.map((i) => `${i.media_type}-${i.id}`));
        const appended = next.results.filter((i) => !existing.has(`${i.media_type}-${i.id}`));
        return [...prev, ...appended];
      });
      setPage(next.page);
      setTotalPages(next.total_pages);
    } catch {
      // Ignora erro de paginação mantendo resultados atuais
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSelectItem = (item: MediaItem) => {
    onSelect(item);
    onClose();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex];
      if (target) handleSelectItem(target);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh] sm:pt-[14vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Busca rápida"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[var(--ph-backdrop-overlay)] backdrop-blur-md"
          />

          {/* Painel Spotlight */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-2xl"
          >
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-[var(--ph-border)] px-4 py-3.5">
              {loading ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--ph-text-muted)]" />
              ) : (
                <Search className="h-5 w-5 shrink-0 text-[var(--ph-text-muted)]" />
              )}

              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Buscar filme, série ou colar link/ID do IMDb (ex: tt0371746)"
                className="flex-1 bg-transparent text-[15px] text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none"
              />

              {detectedImdb && (
                <span className="hidden rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--ph-text)] sm:inline-block">
                  IMDb {detectedImdb}
                </span>
              )}

              {query && (
                <button
                  type="button"
                  onClick={() => {
                    handleQueryChange('');
                    inputRef.current?.focus();
                  }}
                  aria-label="Limpar busca"
                  className="rounded-lg p-1 text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              <kbd className="hidden rounded-md border border-[var(--ph-border)] bg-[var(--ph-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ph-text-muted)] sm:inline-block">
                ESC
              </kbd>
            </div>

            {/* Corpo de resultados */}
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {!query.trim() && (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-[var(--ph-text)]">Busca instantânea no catálogo</p>
                  <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                    Digite um título ou cole um link/ID do IMDb como{' '}
                    <span className="font-mono text-[var(--ph-text)] opacity-85">tt0371746</span>
                  </p>
                </div>
              )}

              {error && (
                <div className="px-4 py-8 text-center text-sm text-[var(--ph-text-muted)]">
                  {error}
                </div>
              )}

              {query.trim() && !loading && !error && results.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-[var(--ph-text-muted)]">
                  Nenhum título encontrado para &ldquo;{query}&rdquo;.
                </div>
              )}

              {results.length > 0 && (
                <motion.ul
                  key={`${query}-${results.length}`}
                  variants={listVariants}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-col gap-1"
                >
                  {results.map((item, idx) => {
                    const title = item.title || item.name || 'Sem título';
                    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
                    const score = item.vote_average ? item.vote_average.toFixed(1) : null;
                    const isFocused = idx === activeIndex;

                    return (
                      <motion.li key={`${item.media_type}-${item.id}`} variants={itemVariants}>
                        <button
                          type="button"
                          onClick={() => handleSelectItem(item)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={`flex w-full items-center gap-3.5 rounded-xl px-3 py-2 text-left transition-colors ${
                            isFocused ? 'bg-[var(--ph-surface-2)]' : 'hover:bg-[var(--ph-hover-subtle)]'
                          }`}
                        >
                          <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-[var(--ph-surface-2)] ring-1 ring-[var(--ph-border)]">
                            {item.poster_path ? (
                              <img
                                src={`${IMG_BASE.poster}${item.poster_path}`}
                                alt={title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[var(--ph-text-muted)]">
                                {item.media_type === 'tv' ? (
                                  <Tv className="h-4 w-4" />
                                ) : (
                                  <Film className="h-4 w-4" />
                                )}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[var(--ph-text)]">
                              {title}
                            </p>
                            <div className="mt-1 flex items-center gap-2.5 text-xs text-[var(--ph-text-muted)]">
                              <span>{item.media_type === 'tv' ? 'Série' : 'Filme'}</span>
                              {year && (
                                <>
                                  <span className="opacity-40">•</span>
                                  <span className="tabular-nums">{year}</span>
                                </>
                              )}
                              {score && (
                                <>
                                  <span className="opacity-40">•</span>
                                  <span className="inline-flex items-center gap-1 tabular-nums text-[var(--ph-text)]">
                                    <Star className="h-3 w-3 fill-[#E5A93C] text-[#E5A93C]" />
                                    {score}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <ArrowUpRight
                            className={`h-4 w-4 shrink-0 transition-opacity ${
                              isFocused
                                ? 'text-[var(--ph-text)] opacity-100'
                                : 'text-[var(--ph-text-muted)] opacity-0'
                            }`}
                          />
                        </button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              )}

              {results.length > 0 && page < totalPages && (
                <div className="mt-2 flex justify-center pb-1">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={handleLoadMore}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)] disabled:opacity-50"
                  >
                    {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>{loadingMore ? 'Carregando...' : 'Carregar mais resultados'}</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
