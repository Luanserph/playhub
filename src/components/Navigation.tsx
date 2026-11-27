import { motion } from 'framer-motion';
import {
  Bookmark,
  Download,
  Film,
  HelpCircle,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Star,
  Tv,
} from 'lucide-react';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { PlayHubLogo } from './PlayHubLogo';

export type NavTab = 'home' | 'movie' | 'tv' | 'watchlist' | 'rated' | 'downloads';

interface NavigationProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  watchlistCount: number;
  ratedCount: number;
  activeDownloadsCount?: number;
}

const NAV_ITEMS: { id: NavTab; label: string; mobileLabel: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Início', mobileLabel: 'Início', icon: Home },
  { id: 'movie', label: 'Filmes', mobileLabel: 'Filmes', icon: Film },
  { id: 'tv', label: 'Séries', mobileLabel: 'Séries', icon: Tv },
  { id: 'watchlist', label: 'Minha Lista', mobileLabel: 'Lista', icon: Bookmark },
  { id: 'rated', label: 'Avaliados', mobileLabel: 'Avaliados', icon: Star },
  { id: 'downloads', label: 'Downloads', mobileLabel: 'Offline', icon: Download },
];

const NAV_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 32,
};

export function Navigation({
  activeTab,
  onSelectTab,
  onOpenSearch,
  onOpenSettings,
  onOpenGuide,
  collapsed,
  onToggleCollapse,
  watchlistCount,
  ratedCount,
  activeDownloadsCount = 0,
}: NavigationProps) {
  const isDesktop = useIsDesktop(768);

  const getCount = (id: NavTab): number => {
    if (id === 'watchlist') return watchlistCount;
    if (id === 'rated') return ratedCount;
    if (id === 'downloads') return activeDownloadsCount;
    return 0;
  };

  if (!isDesktop) {
    const mobileActions: {
      id: string;
      label: string;
      icon: typeof Home;
      isActive: boolean;
      count?: number;
      onClick: () => void;
    }[] = [
      {
        id: 'home',
        label: 'Início',
        icon: Home,
        isActive: activeTab === 'home',
        onClick: () => onSelectTab('home'),
      },
      {
        id: 'search',
        label: 'Buscar',
        icon: Search,
        isActive: false,
        onClick: onOpenSearch,
      },
      {
        id: 'watchlist',
        label: 'Lista',
        icon: Bookmark,
        isActive: activeTab === 'watchlist',
        count: watchlistCount,
        onClick: () => onSelectTab('watchlist'),
      },
      {
        id: 'settings',
        label: 'Configurações',
        icon: Settings,
        isActive: false,
        onClick: onOpenSettings,
      },
    ];

    return (
      <nav
        aria-label="Navegação principal"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(var(--safe-bottom)+10px)] pt-2"
      >
        <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-1 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-glass)] p-1.5 shadow-2xl shadow-black/25 backdrop-blur-xl">
          {mobileActions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className={`relative flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-colors ${
                  item.isActive
                    ? 'text-[var(--ph-text)]'
                    : 'text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                }`}
              >
                {item.isActive && (
                  <motion.span
                    layoutId="activeNav"
                    transition={NAV_SPRING}
                    className="absolute inset-0 rounded-xl bg-[var(--ph-hover)] ring-1 ring-[var(--ph-border)]"
                  />
                )}
                <span className="relative z-10 flex items-center justify-center">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={item.isActive ? 2.1 : 1.75} />
                  {item.count && item.count > 0 ? (
                    <span className="ml-0.5 text-[9px] text-[var(--ph-text-muted)] tabular-nums">
                      {item.count}
                    </span>
                  ) : null}
                </span>
                <span className="relative z-10 leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 228 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-[var(--ph-border)] bg-[var(--ph-sidebar)] backdrop-blur-xl"
    >
      {/* Topo: Logo */}
      <div className="flex h-16 items-center justify-between px-4">
        <button
          type="button"
          onClick={() => onSelectTab('home')}
          className="flex items-center overflow-hidden text-left focus:outline-none"
        >
          <PlayHubLogo size={32} showWordmark={!collapsed} />
        </button>

        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Recolher menu"
            title="Recolher menu"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Busca rápida (Ctrl+K) */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSearch}
          title="Buscar (Ctrl+K)"
          className={`group flex w-full items-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] text-sm text-[var(--ph-text-muted)] transition-colors hover:border-[var(--ph-border-strong)] hover:bg-[var(--ph-surface-2)] hover:text-[var(--ph-text)] ${
            collapsed ? 'h-10 justify-center px-0' : 'h-10 justify-between px-3'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="text-[13px]">Buscar</span>}
          </span>
          {!collapsed && (
            <kbd className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ph-text-muted)] tabular-nums">
              Ctrl K
            </kbd>
          )}
        </button>
      </div>

      {/* Navegação principal */}
      <nav aria-label="Menu lateral" className="flex flex-1 flex-col gap-1 px-3 py-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const count = getCount(item.id);

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`relative flex h-10 w-full items-center rounded-xl text-[13px] font-medium transition-colors ${
                collapsed ? 'justify-center px-0' : 'justify-between px-3'
              } ${
                isActive
                  ? 'text-[var(--ph-text)]'
                  : 'text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="activeNav"
                  transition={NAV_SPRING}
                  className="absolute inset-0 rounded-xl bg-[var(--ph-hover)] ring-1 ring-[var(--ph-border)]"
                />
              )}

              <span className="relative z-10 flex items-center gap-3">
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.75} />
                {!collapsed && <span>{item.label}</span>}
              </span>

              {!collapsed && count > 0 && (
                <span className="relative z-10 rounded-md bg-[var(--ph-hover)] px-1.5 py-0.5 text-[11px] text-[var(--ph-text-muted)] tabular-nums">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Rodapé: Tutorial/Ajuda + Configurações + Expandir (se recolhido) */}
      <div className="flex flex-col gap-1 border-t border-[var(--ph-border)] p-3">
        <button
          type="button"
          onClick={onOpenGuide}
          title={collapsed ? 'Tutorial / Ajuda' : undefined}
          className={`flex h-10 w-full items-center rounded-xl text-[13px] font-medium text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)] ${
            collapsed ? 'justify-center px-0' : 'gap-3 px-3'
          }`}
        >
          <HelpCircle className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          {!collapsed && <span>Tutorial / Ajuda</span>}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title={collapsed ? 'Configurações' : undefined}
          className={`flex h-10 w-full items-center rounded-xl text-[13px] font-medium text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)] ${
            collapsed ? 'justify-center px-0' : 'gap-3 px-3'
          }`}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          {!collapsed && <span>Configurações</span>}
        </button>

        {collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="flex h-10 w-full items-center justify-center rounded-xl text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.aside>
  );
}
