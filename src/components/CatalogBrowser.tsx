import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SlidersHorizontal, X } from 'lucide-react';
import { getMediaKey } from '../services/storage';
import {
  discoverMedia,
  getGenres,
  type DiscoverSortBy,
  type GenreItem,
  type YearFilter,
} from '../services/tmdb';
import type { MediaItem, MediaType } from '../types/media';
import { MediaCard } from './MediaCard';

interface CatalogBrowserProps {
  type: MediaType;
  title: string;
  tmdbLang: string;
  initialSortBy?: DiscoverSortBy;
  ratings: Record<string, number>;
  watchlistKeys: Set<string>;
  onToggleWatchlist: (item: MediaItem) => void;
  onSelect: (item: MediaItem) => void;
}

const YEAR_OPTIONS: { id: YearFilter; label: string }[] = [
  { id: 'all', label: 'Todos os anos' },
  { id: '2026', label: '2026' },
  { id: '2025', label: '2025' },
  { id: '2024', label: '2024' },
  { id: '2020s', label: '2020s' },
  { id: '2010s', label: '2010s' },
  { id: 'classics', label: 'Clássicos' },
];

const TMDB_MAX_PAGE_PER_QUERY = 500;

function subtractOneDay(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  if (parsed.getUTCFullYear() < 1900) return null;
  return parsed.toISOString().slice(0, 10);
}

function computeNextDateWindow(
  items: MediaItem[],
  currentLte: string | null
): string | null {
  // Encontra a menor data válida no bloco carregado para recuar a janela de consulta
  let oldestDate: string | null = null;
  for (const item of items) {
    const raw = (item.release_date || item.first_air_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    if (currentLte && raw >= currentLte) continue;
    if (!oldestDate || raw < oldestDate) {
      oldestDate = raw;
    }
  }

  if (oldestDate) {
    return subtractOneDay(oldestDate);
  }

  // Fallback: recua 1 ano a partir da janela atual (ou do ano corrente)
  const anchorYear = currentLte
    ? Number.parseInt(currentLte.slice(0, 4), 10) - 1
    : new Date().getUTCFullYear() - 1;
  if (!Number.isFinite(anchorYear) || anchorYear < 1900) return null;
  return `${anchorYear}-12-31`;
}

export function CatalogBrowser({
  type,
  title,
  tmdbLang,
  initialSortBy = 'popularity.desc',
  ratings,
  watchlistKeys,
  onToggleWatchlist,
  onSelect,
}: CatalogBrowserProps) {
  const [genres, setGenres] = useState<GenreItem[]>([]);
  const [genreId, setGenreId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<DiscoverSortBy>(initialSortBy);
  const [year, setYear] = useState<YearFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(true);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [dateWindowLte, setDateWindowLte] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const sortOptions: { id: DiscoverSortBy; label: string }[] = [
    { id: 'popularity.desc', label: 'Populares' },
    { id: 'vote_average.desc', label: 'Melhores Notas' },
    {
      id: type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      label: 'Lançamentos',
    },
    { id: 'vote_count.desc', label: 'Mais Votados' },
  ];

  // Carrega gêneros do TMDB para o tipo/idioma
  useEffect(() => {
    let active = true;
    getGenres(type, tmdbLang)
      .then((list) => {
        if (active) setGenres(list);
      })
      .catch(() => {
        if (active) setGenres([]);
      });
    return () => {
      active = false;
    };
  }, [type, tmdbLang]);

  // Carrega página 1 sempre que filtros ou idioma mudarem
  useEffect(() => {
    let active = true;

    discoverMedia({
      type,
      page: 1,
      genreId,
      sortBy,
      year,
      lang: tmdbLang,
    })
      .then((data) => {
        if (!active) return;
        setItems(data.results);
        setPage(data.page);
        setTotalPages(data.total_pages);
        setTotalResults(data.total_results);
        setDateWindowLte(null);
        setExhausted(data.results.length === 0 || (data.total_pages <= 1 && data.total_results <= data.results.length));
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Não foi possível carregar o catálogo com os filtros selecionados.');
      })
      .finally(() => {
        if (active) setLoadingInitial(false);
      });

    return () => {
      active = false;
    };
  }, [type, genreId, sortBy, year, tmdbLang]);

  const handleFilterChange = (updater: () => void) => {
    setLoadingInitial(true);
    setError(null);
    updater();
  };

  // Carrega próxima página com Date Slicing automático ao cruzar o teto de 500 páginas do TMDB
  const loadNextPage = useCallback(async () => {
    if (loadingMoreRef.current || loadingInitial || exhausted) return;

    const maxPageInWindow = Math.min(totalPages, TMDB_MAX_PAGE_PER_QUERY);
    let nextPage = page + 1;
    let nextWindowLte = dateWindowLte;

    if (nextPage > maxPageInWindow) {
      // Se já atingiu a página 500 (teto por consulta do TMDB) ou o fim da janela, abre a janela anterior de data
      const canSliceMore = totalPages > TMDB_MAX_PAGE_PER_QUERY || dateWindowLte !== null;
      if (!canSliceMore) {
        setExhausted(true);
        return;
      }
      const nextBoundary = computeNextDateWindow(items, dateWindowLte);
      if (!nextBoundary) {
        setExhausted(true);
        return;
      }
      nextWindowLte = nextBoundary;
      nextPage = 1;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const data = await discoverMedia({
        type,
        page: nextPage,
        genreId,
        sortBy,
        year,
        releaseDateLte: nextWindowLte,
        lang: tmdbLang,
      });

      if (data.results.length === 0) {
        setExhausted(true);
        return;
      }

      setItems((prev) => {
        const seen = new Set(prev.map((m) => getMediaKey(m)));
        const fresh = data.results.filter((m) => !seen.has(getMediaKey(m)));
        return [...prev, ...fresh];
      });
      setPage(data.page);
      setTotalPages(data.total_pages);
      setDateWindowLte(nextWindowLte);
      // Preserva o total_results real da consulta principal (sem sobrescrever com o subtotal da janela)
      if (!nextWindowLte) {
        setTotalResults(data.total_results);
      }
    } catch {
      // Mantém itens já carregados
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    loadingInitial,
    exhausted,
    page,
    totalPages,
    dateWindowLte,
    items,
    type,
    genreId,
    sortBy,
    year,
    tmdbLang,
  ]);

  // IntersectionObserver no sentinela do rodapé
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadNextPage();
        }
      },
      { rootMargin: '420px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadNextPage]);

  const hasActiveFilters = genreId !== null || year !== 'all' || sortBy !== 'popularity.desc';

  const resetFilters = () => {
    handleFilterChange(() => {
      setGenreId(null);
      setSortBy('popularity.desc');
      setYear('all');
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="px-5 pt-8 sm:px-10 sm:pt-12 lg:px-14"
    >
      {/* Cabeçalho */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ph-border)] pb-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ph-text-muted)]">
            Catálogo TMDB
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--ph-text)] sm:text-4xl">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {totalResults > 0 && (
            <span className="text-xs text-[var(--ph-text-muted)] tabular-nums">
              {totalResults >= 20001
                ? 'Mais de 20.000 títulos · catálogo infinito'
                : `${totalResults.toLocaleString('pt-BR')} títulos`}
            </span>
          )}

          <button
            type="button"
            onClick={() => setFiltersOpen((prev) => !prev)}
            className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-xs font-medium transition-colors ${
              filtersOpen
                ? 'border-[var(--ph-border-strong)] bg-[var(--ph-surface-2)] text-[var(--ph-text)]'
                : 'border-[var(--ph-border)] bg-[var(--ph-surface)] text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Filtros</span>
          </button>
        </div>
      </div>

      {/* Barra de Filtros Recolhível */}
      <AnimatePresence initial={false}>
        {filtersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-8 overflow-hidden"
          >
            <div className="space-y-4 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] p-4">
              {/* Linha 1: Ordenação + Ano + Limpar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Ordenação */}
                  <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-1">
                    {sortOptions.map((opt) => {
                      const active = sortBy === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleFilterChange(() => setSortBy(opt.id))}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? 'bg-[var(--ph-btn-primary-bg)] text-[var(--ph-btn-primary-fg)]'
                              : 'text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Ano */}
                  <select
                    value={year}
                    onChange={(e) =>
                      handleFilterChange(() => setYear(e.target.value as YearFilter))
                    }
                    aria-label="Filtrar por ano"
                    className="h-9 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3 text-xs font-medium text-[var(--ph-text)] outline-none transition-colors focus:border-[var(--ph-border-strong)] tabular-nums"
                  >
                    {YEAR_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Limpar filtros</span>
                  </button>
                )}
              </div>

              {/* Linha 2: Pílulas de Gênero */}
              {genres.length > 0 && (
                <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  <button
                    type="button"
                    onClick={() => handleFilterChange(() => setGenreId(null))}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      genreId === null
                        ? 'border-transparent bg-[var(--ph-btn-primary-bg)] text-[var(--ph-btn-primary-fg)]'
                        : 'border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                    }`}
                  >
                    Todos os gêneros
                  </button>
                  {genres.map((g) => {
                    const active = genreId === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          handleFilterChange(() => setGenreId(active ? null : g.id))
                        }
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? 'border-transparent bg-[var(--ph-btn-primary-bg)] text-[var(--ph-btn-primary-fg)]'
                            : 'border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Erro */}
      {error && (
        <div className="mb-6 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] p-5 text-sm text-[var(--ph-text-muted)]">
          {error}
        </div>
      )}

      {/* Grid */}
      {loadingInitial ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-[var(--ph-surface)] ring-1 ring-[var(--ph-border)]" />
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--ph-surface-2)]" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--ph-surface)]" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-6 py-16 text-center">
          <p className="text-sm font-medium text-[var(--ph-text)]">
            Nenhum título encontrado com esses filtros.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex h-9 items-center rounded-xl bg-[var(--ph-btn-primary-bg)] px-4 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
          >
            Redefinir filtros
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item, idx) => {
              const key = getMediaKey(item);
              return (
                <MediaCard
                  key={key}
                  item={item}
                  index={idx % 20}
                  userRating={ratings[key]}
                  inWatchlist={watchlistKeys.has(key)}
                  onToggleWatchlist={onToggleWatchlist}
                  onSelect={onSelect}
                />
              );
            })}
          </div>

          {/* Sentinela do Scroll Infinito + Skeleton discreto */}
          <div ref={sentinelRef} className="mt-10">
            {loadingMore && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2.5">
                    <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-[var(--ph-surface)] ring-1 ring-[var(--ph-border)]" />
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--ph-surface-2)]" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.section>
  );
}
