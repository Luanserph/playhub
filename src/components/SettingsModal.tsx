import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Compass,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  KeyRound,
  Link2,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useIsDesktop } from '../hooks/useIsDesktop';
import {
  fetchAddonDirectory,
  type DirectoryAddon,
  type SyncAddonListsResponse,
} from '../services/playerApi';
import type {
  AddonEntry,
  DefaultPlayerMode,
  PlaybackPreferences,
  SourcePreferences,
  ThemeMode,
  UserPreferences,
} from '../services/storage';
import { getTmdbKeySource, validateTmdbKey } from '../services/tmdb';
import { openExternalUrl } from '../utils/externalLink';
import {
  getSystemLocale,
  resolveLanguageConfig,
  type LanguagePreference,
} from '../utils/locale';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  tmdbApiKey: string;
  onSaveTmdbKey: (key: string) => void;
  onOpenGuide: () => void;
  preferences: UserPreferences;
  addons: AddonEntry[];
  addonListUrls: string[];
  onAddAddon: (url: string) => Promise<{ ok: boolean; error?: string; name?: string }>;
  onInstallDirectoryAddon: (url: string, name?: string) => void;
  onRemoveAddon: (url: string) => void;
  onAddAddonListUrl: (url: string) => boolean;
  onRemoveAddonListUrl: (url: string) => void;
  onSyncAddonLists: (overrideUrls?: string[]) => Promise<SyncAddonListsResponse>;
  onChangeTheme: (theme: ThemeMode) => void;
  onChangeLanguage: (language: LanguagePreference) => void;
  onChangePlayback: <K extends keyof PlaybackPreferences>(
    key: K,
    value: PlaybackPreferences[K]
  ) => void;
  onChangeSource: <K extends keyof SourcePreferences>(
    key: K,
    value: SourcePreferences[K]
  ) => void;
  resolvedDownloadDir?: string;
  onChangeDownloadDir?: (dir: string) => void;
  onExportBackup: (options?: { includeTmdbKey?: boolean }) => void;
  onImportBackup: (rawJson: string) => Promise<{ ok: boolean; error?: string }>;
}

const SHEET_SPRING = {
  type: 'spring' as const,
  stiffness: 340,
  damping: 34,
  mass: 0.9,
};

const TOGGLE_SPRING = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 32,
};

export function SettingsModal({
  open,
  onClose,
  tmdbApiKey,
  onSaveTmdbKey,
  onOpenGuide,
  preferences,
  addons,
  addonListUrls,
  onAddAddon,
  onInstallDirectoryAddon,
  onRemoveAddon,
  onAddAddonListUrl,
  onRemoveAddonListUrl,
  onSyncAddonLists,
  onChangeTheme,
  onChangeLanguage,
  onChangePlayback,
  onChangeSource,
  resolvedDownloadDir = '',
  onChangeDownloadDir,
  onExportBackup,
  onImportBackup,
}: SettingsModalProps) {
  const isDesktop = useIsDesktop(768);
  const systemLangConfig = resolveLanguageConfig(getSystemLocale());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tmdbInput, setTmdbInput] = useState(tmdbApiKey);
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [testingTmdb, setTestingTmdb] = useState(false);
  const [tmdbFeedback, setTmdbFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [includeTmdbInBackup, setIncludeTmdbInBackup] = useState(false);

  const [addonInput, setAddonInput] = useState('');
  const [addonError, setAddonError] = useState<string | null>(null);
  const [validatingAddon, setValidatingAddon] = useState(false);

  const [listInput, setListInput] = useState('');
  const [listFeedback, setListFeedback] = useState<string | null>(null);
  const [syncingLists, setSyncingLists] = useState(false);

  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryItems, setDirectoryItems] = useState<DirectoryAddon[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  const handleOpenDirectory = async () => {
    const next = !directoryOpen;
    setDirectoryOpen(next);
    if (next && directoryItems.length === 0) {
      setLoadingDirectory(true);
      try {
        const list = await fetchAddonDirectory();
        setDirectoryItems(list);
      } catch {
        setDirectoryItems([]);
      } finally {
        setLoadingDirectory(false);
      }
    }
  };

  const handleSubmitAddon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addonInput.trim() || validatingAddon) return;
    setValidatingAddon(true);
    setAddonError(null);

    try {
      const result = await onAddAddon(addonInput);
      if (!result.ok) {
        setAddonError(result.error || 'Não foi possível validar o add-on.');
        return;
      }
      setAddonInput('');
    } finally {
      setValidatingAddon(false);
    }
  };

  const handleSubmitListUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listInput.trim()) return;
    const ok = onAddAddonListUrl(listInput);
    if (!ok) {
      setListFeedback('Informe uma URL HTTP/HTTPS válida de arquivo .json.');
      return;
    }
    const nextUrls = Array.from(
      new Set([...addonListUrls, listInput.trim().replace(/^stremio:\/\//i, 'https://')])
    );
    setListInput('');
    setSyncingLists(true);
    setListFeedback('Sincronizando lista remota...');
    try {
      const res = await onSyncAddonLists(nextUrls);
      setListFeedback(
        `${res.onlineCount} add-on(s) online · +${res.addedCount} adicionado(s).`
      );
    } catch {
      setListFeedback('Lista salva. Erro ao sincronizar com o servidor local.');
    } finally {
      setSyncingLists(false);
    }
  };

  const handleSyncListsNow = async () => {
    if (syncingLists || addonListUrls.length === 0) return;
    setSyncingLists(true);
    setListFeedback('Atualizando listas...');
    try {
      const res = await onSyncAddonLists();
      setListFeedback(
        `${res.syncedLists} lista(s) lidas · ${res.onlineCount} online · +${res.addedCount} novo(s).`
      );
    } catch {
      setListFeedback('Não foi possível sincronizar as listas agora.');
    } finally {
      setSyncingLists(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const res = await onImportBackup(text);
      setBackupFeedback(
        res.ok
          ? 'Backup importado e sincronizado com sucesso.'
          : res.error || 'Falha ao importar JSON.'
      );
    } catch {
      setBackupFeedback('Erro ao ler o arquivo selecionado.');
    }
  };

  const tmdbKeySource = getTmdbKeySource();

  const handleTestAndSaveTmdb = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = tmdbInput.trim().replace(/^Bearer\s+/i, '');
    if (!cleaned || testingTmdb) return;
    setTestingTmdb(true);
    setTmdbFeedback(null);
    try {
      const result = await validateTmdbKey(cleaned);
      if (result.ok) {
        setTmdbInput(cleaned);
        onSaveTmdbKey(cleaned);
        setTmdbFeedback({
          type: 'success',
          message: 'Chave validada e salva. Catálogo atualizado automaticamente.',
        });
      } else {
        setTmdbFeedback({
          type: 'error',
          message:
            result.error || 'Chave inválida. Verifique sua API Key v3 ou Token Bearer v4.',
        });
      }
    } catch (err) {
      setTmdbFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Erro inesperado ao validar a chave TMDB.',
      });
    } finally {
      setTestingTmdb(false);
    }
  };

  const handleClearTmdb = () => {
    setTmdbInput('');
    onSaveTmdbKey('');
    setTmdbFeedback(null);
  };

  const installedUrls = new Set(addons.map((a) => a.url));

  const themeOptions: { id: ThemeMode; label: string; caption: string; icon: typeof Moon }[] = [
    { id: 'dark', label: 'Escuro Cinema', caption: '#09090B', icon: Moon },
    { id: 'light', label: 'Claro Editorial', caption: '#F8F8F9', icon: Sun },
  ];

  const playbackToggles: {
    key: 'prioritizePtBrAudio' | 'autoSubtitlesPtBr' | 'experimentalAiDubbing';
    title: string;
    description: string;
  }[] = [
    {
      key: 'prioritizePtBrAudio',
      title: 'Priorizar áudio Dublado / Dual-Audio (PT-BR)',
      description: 'Seleciona automaticamente faixas em português quando disponíveis.',
    },
    {
      key: 'autoSubtitlesPtBr',
      title: 'Buscar e traduzir legenda PT-BR automaticamente',
      description: 'Carrega legendas em português ou traduz a legenda original em tempo real.',
    },
    {
      key: 'experimentalAiDubbing',
      title: 'Ativar Dublagem IA experimental quando não houver áudio PT-BR',
      description: 'Recurso experimental para sintetizar faixa em português sob demanda.',
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch"
          role="dialog"
          aria-modal="true"
          aria-label="Configurações"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-[var(--ph-backdrop-overlay)] backdrop-blur-sm"
          />

          {/* Painel */}
          <motion.div
            initial={isDesktop ? { x: '100%' } : { y: '100%' }}
            animate={isDesktop ? { x: 0 } : { y: 0 }}
            exit={isDesktop ? { x: '100%' } : { y: '100%' }}
            transition={SHEET_SPRING}
            onClick={(e) => e.stopPropagation()}
            className={
              isDesktop
                ? 'relative z-10 flex h-full w-full max-w-[500px] flex-col overflow-y-auto border-l border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-2xl'
                : 'relative z-10 flex max-h-[90dvh] w-full flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--ph-border)] bg-[var(--ph-surface)] pb-[env(safe-area-inset-bottom)] shadow-2xl'
            }
          >
            {!isDesktop && (
              <div className="flex justify-center pt-3">
                <span className="h-1 w-10 rounded-full bg-[var(--ph-border-strong)]" />
              </div>
            )}

            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-[var(--ph-border)] px-6 py-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                  Preferências
                </p>
                <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-[var(--ph-text)]">
                  Configurações
                </h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar configurações"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-8 px-6 py-6">
              {/* Seção: Conexão com Catálogo (TMDB) */}
              <section className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5 text-[var(--ph-text-muted)]" />
                    <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                      Conexão com Catálogo (TMDB)
                    </h3>
                  </div>

                  <span className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--ph-text)]">
                    {tmdbKeySource === 'config'
                      ? 'Ativa via Configuração'
                      : tmdbKeySource === 'env'
                        ? 'Ativa via .env'
                        : 'Pendente'}
                  </span>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                  Crie uma conta gratuita no TMDB, abra Configurações → API e copie sua Chave da API (v3) ou Token de Leitura (v4). Cole abaixo para ativar todo o catálogo.
                </p>

                <a
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    void openExternalUrl('https://www.themoviedb.org/settings/api');
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ph-text)] underline-offset-4 hover:underline"
                >
                  <span>Obter chave gratuita no TMDB</span>
                  <ExternalLink className="h-3 w-3" />
                </a>

                <form onSubmit={handleTestAndSaveTmdb} className="mt-3 space-y-2.5">
                  <div className="relative">
                    <input
                      type={showTmdbKey ? 'text' : 'password'}
                      value={tmdbInput}
                      onChange={(e) => {
                        setTmdbInput(e.target.value);
                        if (tmdbFeedback) setTmdbFeedback(null);
                      }}
                      placeholder="Cole sua API Key v3 ou Token Bearer v4"
                      className="h-10 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] pl-3.5 pr-9 font-mono text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none focus:border-[var(--ph-border-strong)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTmdbKey((prev) => !prev)}
                      aria-label={showTmdbKey ? 'Ocultar chave' : 'Mostrar chave'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]"
                    >
                      {showTmdbKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={testingTmdb || !tmdbInput.trim()}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-4 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)] disabled:opacity-50"
                    >
                      {testingTmdb ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span>{testingTmdb ? 'Testando...' : 'Testar e Salvar'}</span>
                    </button>

                    {(tmdbApiKey || tmdbInput) && (
                      <button
                        type="button"
                        onClick={handleClearTmdb}
                        className="h-9 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3.5 text-xs font-medium text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  {tmdbFeedback && (
                    <p
                      className={`text-xs ${
                        tmdbFeedback.type === 'success'
                          ? 'font-medium text-[var(--ph-text)]'
                          : 'text-[var(--ph-text-muted)]'
                      }`}
                    >
                      {tmdbFeedback.message}
                    </p>
                  )}
                </form>
              </section>

              {/* Seção: Aparência */}
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                  Aparência
                </h3>
                <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                  Escolha o tema visual do catálogo.
                </p>

                <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-1.5">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const active = preferences.theme === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onChangeTheme(option.id)}
                        className={`relative flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                          active
                            ? 'text-[var(--ph-text)]'
                            : 'text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="themePill"
                            transition={SHEET_SPRING}
                            className="absolute inset-0 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-sm"
                          />
                        )}
                        <Icon className="relative z-10 h-4 w-4 shrink-0" />
                        <span className="relative z-10 min-w-0">
                          <span className="block truncate text-[13px] font-medium">
                            {option.label}
                          </span>
                          <span className="block font-mono text-[10px] opacity-65 tabular-nums">
                            {option.caption}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Seção: Idioma Preferido */}
              <section>
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-[var(--ph-text-muted)]" />
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                    Idioma Preferido
                  </h3>
                </div>
                <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                  Define o idioma do catálogo, legendas automáticas, tradução e voz neural.
                </p>

                <div className="mt-3.5">
                  <select
                    value={preferences.language}
                    onChange={(e) => onChangeLanguage(e.target.value as LanguagePreference)}
                    aria-label="Idioma preferido"
                    className="h-11 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3.5 text-sm text-[var(--ph-text)] outline-none transition-colors focus:border-[var(--ph-border-strong)]"
                  >
                    <option value="auto">
                      Automático — Idioma do sistema ({systemLangConfig.label})
                    </option>
                    <option value="pt-BR">Português (Brasil) · pt-BR</option>
                    <option value="en-US">English (US) · en-US</option>
                    <option value="es-ES">Español · es-ES</option>
                    <option value="fr-FR">Français · fr-FR</option>
                  </select>
                </div>
              </section>

              {/* Seção: Pasta de Downloads (Modo Offline) */}
              {onChangeDownloadDir && (
                <section>
                  <div className="flex items-center gap-2">
                    <Download className="h-3.5 w-3.5 text-[var(--ph-text-muted)]" />
                    <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                      Pasta de Downloads
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                    Local onde vídeos e legendas PT-BR baixados são salvos no seu computador.
                  </p>
                  <div className="mt-3">
                    <input
                      type="text"
                      value={preferences.downloadDir ?? ''}
                      onChange={(e) => onChangeDownloadDir(e.target.value)}
                      placeholder={resolvedDownloadDir || 'Padrão: ~/Downloads/PlayHub'}
                      className="h-10 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3.5 font-mono text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none focus:border-[var(--ph-border-strong)]"
                    />
                    {resolvedDownloadDir && !preferences.downloadDir && (
                      <p className="mt-1.5 truncate font-mono text-[11px] text-[var(--ph-text-muted)]">
                        Ativo: {resolvedDownloadDir}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {/* Seção: Preferências de Reprodução */}
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                  Preferências de Reprodução
                </h3>
                <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                  Configurações aplicadas automaticamente ao iniciar o player.
                </p>

                {/* Modo de Reprodução Padrão */}
                <div className="mt-3.5">
                  <p className="mb-2 text-xs font-medium text-[var(--ph-text)]">
                    Modo de Reprodução Padrão
                  </p>
                  <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-1.5">
                    {(
                      [
                        {
                          id: 'embed' as DefaultPlayerMode,
                          label: 'Embed imdb.su',
                          caption: 'Início Instantâneo',
                        },
                        {
                          id: 'native' as DefaultPlayerMode,
                          label: 'Player Nativo',
                          caption: 'Torrents / Add-ons',
                        },
                      ] as const
                    ).map((opt) => {
                      const active = preferences.playback.defaultPlayerMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onChangePlayback('defaultPlayerMode', opt.id)}
                          className={`relative rounded-xl px-3 py-2.5 text-left transition-colors ${
                            active
                              ? 'text-[var(--ph-text)]'
                              : 'text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="defaultPlayerPill"
                              transition={SHEET_SPRING}
                              className="absolute inset-0 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-sm"
                            />
                          )}
                          <span className="relative z-10 block text-[12px] font-medium">
                            {opt.label}
                          </span>
                          <span className="relative z-10 block text-[10px] opacity-65">
                            {opt.caption}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3.5 divide-y divide-[var(--ph-border)] overflow-hidden rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)]">
                  {playbackToggles.map((item) => {
                    const checked = preferences.playback[item.key];
                    return (
                      <div
                        key={item.key}
                        className="flex items-start justify-between gap-4 px-4 py-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium leading-snug text-[var(--ph-text)]">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                            {item.description}
                          </p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={item.title}
                          onClick={() => onChangePlayback(item.key, !checked)}
                          className={`relative mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--ph-border)] p-0.5 transition-colors ${
                            checked
                              ? 'justify-end bg-[var(--ph-btn-primary-bg)]'
                              : 'justify-start bg-[var(--ph-hover)]'
                          }`}
                        >
                          <motion.span
                            layout
                            transition={TOGGLE_SPRING}
                            className={`h-4 w-4 rounded-full shadow-sm ${
                              checked
                                ? 'bg-[var(--ph-btn-primary-fg)]'
                                : 'bg-[var(--ph-text-muted)]'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Seção: Fontes / Add-ons (Padrão Stremio) */}
              <section>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                    Fontes / Add-ons (Padrão Stremio)
                  </h3>
                  <span className="text-[11px] text-[var(--ph-text-muted)] tabular-nums">
                    {addons.length} {addons.length === 1 ? 'ativo' : 'ativos'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                  Cole URLs <span className="font-mono">https://</span> ou{' '}
                  <span className="font-mono">stremio://</span>, assine listas remotas ou explore o catálogo comunitário.
                </p>

                {/* Adicionar add-on individual */}
                <form onSubmit={handleSubmitAddon} className="mt-3.5 flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ph-text-muted)]" />
                    <input
                      type="text"
                      value={addonInput}
                      onChange={(e) => {
                        setAddonInput(e.target.value);
                        if (addonError) setAddonError(null);
                      }}
                      placeholder="stremio://... ou https://.../manifest.json"
                      className="h-10 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] pl-9 pr-3 text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none transition-colors focus:border-[var(--ph-border-strong)]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={validatingAddon}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-3.5 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)] disabled:opacity-60"
                  >
                    {validatingAddon ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    <span>{validatingAddon ? 'Validando...' : 'Adicionar'}</span>
                  </button>
                </form>

                {addonError && (
                  <p className="mt-2 text-xs text-[var(--ph-text-muted)]">{addonError}</p>
                )}

                {/* Botão Explorar Catálogo de Add-ons */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleOpenDirectory}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3.5 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                  >
                    <Compass className="h-3.5 w-3.5" />
                    <span>
                      {directoryOpen
                        ? 'Ocultar Catálogo de Add-ons'
                        : 'Explorar Catálogo de Add-ons'}
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {directoryOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-2.5 overflow-hidden rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)]"
                      >
                        <div className="max-h-64 space-y-2 overflow-y-auto p-3">
                          {loadingDirectory ? (
                            <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--ph-text-muted)]">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Carregando diretório comunitário...</span>
                            </div>
                          ) : directoryItems.length === 0 ? (
                            <p className="py-4 text-center text-xs text-[var(--ph-text-muted)]">
                              Não foi possível carregar o diretório agora.
                            </p>
                          ) : (
                            directoryItems.map((dirAddon) => {
                              const installed = installedUrls.has(dirAddon.transportUrl);
                              return (
                                <div
                                  key={dirAddon.transportUrl}
                                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] p-3"
                                >
                                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                                    {dirAddon.logo && (
                                      <img
                                        src={dirAddon.logo}
                                        alt=""
                                        className="mt-0.5 h-7 w-7 shrink-0 rounded-lg object-cover ring-1 ring-[var(--ph-border)]"
                                      />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-semibold text-[var(--ph-text)]">
                                        {dirAddon.name}
                                      </p>
                                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--ph-text-muted)]">
                                        {dirAddon.description}
                                      </p>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      installed
                                        ? onRemoveAddon(dirAddon.transportUrl)
                                        : onInstallDirectoryAddon(
                                            dirAddon.transportUrl,
                                            dirAddon.name
                                          )
                                    }
                                    className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
                                      installed
                                        ? 'border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]'
                                        : 'bg-[var(--ph-btn-primary-bg)] text-[var(--ph-btn-primary-fg)] hover:bg-[var(--ph-btn-primary-hover)]'
                                    }`}
                                  >
                                    {installed ? (
                                      <>
                                        <Check className="h-3 w-3" />
                                        <span>Remover</span>
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="h-3 w-3" />
                                        <span>Instalar</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Assinar Lista Remota (.json) */}
                <div className="mt-4 space-y-2.5 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-[var(--ph-text)]">
                      Assinar Lista Remota (.json)
                    </p>
                    {addonListUrls.length > 0 && (
                      <button
                        type="button"
                        disabled={syncingLists}
                        onClick={handleSyncListsNow}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)] disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${syncingLists ? 'animate-spin' : ''}`}
                        />
                        <span>Atualizar listas agora</span>
                      </button>
                    )}
                  </div>

                  <form onSubmit={handleSubmitListUrl} className="flex gap-2">
                    <input
                      type="url"
                      value={listInput}
                      onChange={(e) => {
                        setListInput(e.target.value);
                        if (listFeedback) setListFeedback(null);
                      }}
                      placeholder="https://.../addons-list.json"
                      className="h-9 flex-1 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none focus:border-[var(--ph-border-strong)]"
                    />
                    <button
                      type="submit"
                      disabled={syncingLists}
                      className="inline-flex h-9 shrink-0 items-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)] disabled:opacity-50"
                    >
                      Assinar
                    </button>
                  </form>

                  {listFeedback && (
                    <p className="text-[11px] text-[var(--ph-text-muted)]">{listFeedback}</p>
                  )}

                  {addonListUrls.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {addonListUrls.map((url) => (
                        <div
                          key={url}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ph-border)] bg-[var(--ph-surface)] px-2.5 py-1.5"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--ph-text-muted)]">
                            {url}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemoveAddonListUrl(url)}
                            aria-label={`Remover lista ${url}`}
                            className="p-1 text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Provedores embutidos + Torznab + Lista de Add-ons ativos */}
                <div className="mt-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--ph-text)]">
                        Provedores Embutidos (YTS / EZTV / APIBay)
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--ph-text-muted)]">
                        Busca automaticamente torrents para filmes e séries em paralelo sem depender de add-ons.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preferences.sources.enableBuiltInProviders}
                      aria-label="Ativar provedores embutidos"
                      onClick={() =>
                        onChangeSource(
                          'enableBuiltInProviders',
                          !preferences.sources.enableBuiltInProviders
                        )
                      }
                      className={`relative mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--ph-border)] p-0.5 transition-colors ${
                        preferences.sources.enableBuiltInProviders
                          ? 'justify-end bg-[var(--ph-btn-primary-bg)]'
                          : 'justify-start bg-[var(--ph-hover)]'
                      }`}
                    >
                      <motion.span
                        layout
                        transition={TOGGLE_SPRING}
                        className={`h-4 w-4 rounded-full shadow-sm ${
                          preferences.sources.enableBuiltInProviders
                            ? 'bg-[var(--ph-btn-primary-fg)]'
                            : 'bg-[var(--ph-text-muted)]'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Torznab / Jackett / Prowlarr (opcional) */}
                  <div className="space-y-2.5 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4">
                    <p className="text-[12px] font-medium text-[var(--ph-text)]">
                      Torznab / Prowlarr / Jackett (Opcional)
                    </p>
                    <input
                      type="url"
                      value={preferences.sources.torznabUrl}
                      onChange={(e) => onChangeSource('torznabUrl', e.target.value)}
                      placeholder="URL Torznab (ex: http://localhost:9696/1/api)"
                      className="h-9 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none focus:border-[var(--ph-border-strong)]"
                    />
                    <input
                      type="password"
                      value={preferences.sources.torznabApiKey}
                      onChange={(e) => onChangeSource('torznabApiKey', e.target.value)}
                      placeholder="API Key do Torznab"
                      className="h-9 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-3 text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none focus:border-[var(--ph-border-strong)]"
                    />
                  </div>

                  {addons.length === 0 ? (
                    <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 py-4 text-xs text-[var(--ph-text-muted)]">
                      Nenhum add-on externo instalado. Use o catálogo acima ou os provedores embutidos.
                    </div>
                  ) : (
                    addons.map((addon) => (
                      <div
                        key={addon.url}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3.5 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--ph-text)]">
                            {addon.name || 'Add-on Stremio'}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--ph-text-muted)]">
                            {addon.url}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveAddon(addon.url)}
                          aria-label={`Remover add-on ${addon.name || addon.url}`}
                          title="Remover add-on"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Seção: Backup e Migração */}
              <section>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ph-text-muted)]">
                  Backup e Migração
                </h3>
                <p className="mt-1 text-xs text-[var(--ph-text-muted)]">
                  Sincronizado automaticamente em <span className="font-mono">server/data/store.json</span> entre navegadores.
                </p>

                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[var(--ph-text-muted)]">
                  <input
                    type="checkbox"
                    checked={includeTmdbInBackup}
                    onChange={(e) => setIncludeTmdbInBackup(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[var(--ph-btn-primary-bg)]"
                  />
                  <span>Incluir minha chave pessoal do TMDB ao exportar JSON</span>
                </label>

                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onExportBackup({ includeTmdbKey: includeTmdbInBackup });
                      setBackupFeedback(
                        includeTmdbInBackup
                          ? 'Backup exportado (com chave TMDB).'
                          : 'Backup exportado (sem chave TMDB).'
                      );
                    }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Exportar JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Importar JSON</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFile}
                    className="hidden"
                  />
                </div>

                {backupFeedback && (
                  <p className="mt-2 text-xs text-[var(--ph-text-muted)]">{backupFeedback}</p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGuide();
                  }}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-4 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  <span>Abrir Tutorial / Guia Inicial</span>
                </button>
              </section>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
