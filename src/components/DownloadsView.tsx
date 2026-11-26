import {
  AlertCircle,
  Download,
  Film,
  FolderOpen,
  HardDrive,
  Pause,
  Play,
  RotateCw,
  Subtitles,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import {
  getOfflineFileDownloadUrl,
  type DownloadItem,
} from '../services/playerApi';
import { getImageUrl, handleTmdbImageError } from '../services/tmdb';

interface DownloadsViewProps {
  downloads: DownloadItem[];
  downloadDir: string;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string, deleteFiles: boolean) => void;
  onPlayOffline: (item: DownloadItem) => void;
  onOpenSettings: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 10 || idx < 2 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

export function DownloadsView({
  downloads,
  downloadDir,
  onPause,
  onResume,
  onDelete,
  onPlayOffline,
  onOpenSettings,
}: DownloadsViewProps) {
  const activeList = downloads.filter((d) => d.status !== 'completed');
  const completedList = downloads.filter((d) => d.status === 'completed');

  return (
    <div className="space-y-10">
      {/* Pasta de destino atual */}
      {downloadDir && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-4 py-3 text-xs">
          <div className="flex min-w-0 items-center gap-2.5 text-[var(--ph-text-muted)]">
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate font-mono text-[var(--ph-text)]">{downloadDir}</span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-lg border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3 py-1.5 font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
          >
            Alterar pasta
          </button>
        </div>
      )}

      {downloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] px-6 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)]">
            <HardDrive className="h-5 w-5 text-[var(--ph-text-muted)]" />
          </div>
          <h2 className="mt-4 text-base font-medium text-[var(--ph-text)]">
            Nenhum download ainda
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-[var(--ph-text-muted)]">
            Clique em <strong className="text-[var(--ph-text)]">Baixar</strong> nos detalhes de
            qualquer filme, episódio ou diretamente no player para montar sua biblioteca offline.
          </p>
        </div>
      ) : (
        <>
          {/* Seção 1: Em andamento / Pausados */}
          {activeList.length > 0 && (
            <section className="space-y-3.5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ph-text-muted)]">
                  Em andamento / Pausados
                </h2>
                <span className="text-xs text-[var(--ph-text-muted)] tabular-nums">
                  {activeList.length}
                </span>
              </div>

              <div className="space-y-3">
                {activeList.map((dl) => {
                  const thumbPath = dl.backdropPath || dl.posterPath;
                  const thumbSize = dl.backdropPath ? 'w500' : 'w342';
                  const thumbUrl = getImageUrl(thumbPath, thumbSize);
                  const isPaused = dl.status === 'paused' || dl.status === 'error';

                  return (
                    <div
                      key={dl.id}
                      className="flex flex-col gap-4 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] p-4 sm:flex-row sm:items-center"
                    >
                      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-[var(--ph-surface-2)] ring-1 ring-[var(--ph-border)] sm:w-44">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={dl.title}
                            onError={(e) => handleTmdbImageError(e, thumbPath, thumbSize)}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--ph-text-muted)] opacity-45">
                            {dl.mediaType === 'tv' ? (
                              <Tv className="h-5 w-5" />
                            ) : (
                              <Film className="h-5 w-5" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-[var(--ph-text)]">
                              {dl.title}
                            </h3>
                            {dl.mediaType === 'tv' && (
                              <span className="shrink-0 rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ph-text-muted)] tabular-nums">
                                T{dl.season ?? 1} · E{String(dl.episode ?? 1).padStart(2, '0')}
                              </span>
                            )}
                            {dl.quality && (
                              <span className="shrink-0 rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ph-text)]">
                                {dl.quality}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs font-semibold text-[var(--ph-text)] tabular-nums">
                            {dl.progress.toFixed(1)}%
                          </span>
                        </div>

                        {/* Barra de progresso fina */}
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ph-surface-2)]">
                          <div
                            className="h-full bg-[var(--ph-btn-primary-bg)] transition-[width] duration-300"
                            style={{ width: `${Math.max(2, Math.min(100, dl.progress))}%` }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ph-text-muted)] tabular-nums">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>
                              {formatBytes(dl.downloadedBytes)} /{' '}
                              {dl.totalBytes > 0 ? formatBytes(dl.totalBytes) : 'calculando...'}
                            </span>
                            {dl.status === 'downloading' && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>{formatSpeed(dl.speed)}</span>
                                <span className="opacity-40">·</span>
                                <span>{dl.peers} peers</span>
                              </>
                            )}
                            {dl.status === 'paused' && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>Pausado</span>
                              </>
                            )}
                            {dl.status === 'queued' && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>Conectando aos peers...</span>
                              </>
                            )}
                            {dl.status === 'error' && (
                              <span className="inline-flex items-center gap-1 text-red-400">
                                <AlertCircle className="h-3.5 w-3.5" />
                                {dl.error || 'Erro no download'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {isPaused ? (
                              <button
                                type="button"
                                onClick={() => onResume(dl.id)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                                <span>Retomar</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onPause(dl.id)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                              >
                                <Pause className="h-3.5 w-3.5" />
                                <span>Pausar</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => onDelete(dl.id, true)}
                              aria-label={`Cancelar ${dl.title}`}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ph-border)] bg-transparent px-2.5 text-xs text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>Cancelar</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Seção 2: Biblioteca Offline (Concluídos) */}
          {completedList.length > 0 && (
            <section className="space-y-3.5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ph-text-muted)]">
                  Biblioteca Offline
                </h2>
                <span className="text-xs text-[var(--ph-text-muted)] tabular-nums">
                  {completedList.length}{' '}
                  {completedList.length === 1 ? 'arquivo' : 'arquivos'}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {completedList.map((dl) => {
                  const thumbPath = dl.backdropPath || dl.posterPath;
                  const thumbSize = dl.backdropPath ? 'w500' : 'w342';
                  const thumbUrl = getImageUrl(thumbPath, thumbSize);

                  return (
                    <div
                      key={dl.id}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface)] transition-colors hover:border-[var(--ph-border-strong)]"
                    >
                      <button
                        type="button"
                        onClick={() => onPlayOffline(dl)}
                        className="relative aspect-video w-full overflow-hidden bg-[var(--ph-surface-2)] text-left"
                      >
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={dl.title}
                            onError={(e) => handleTmdbImageError(e, thumbPath, thumbSize)}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--ph-text-muted)] opacity-45">
                            {dl.mediaType === 'tv' ? (
                              <Tv className="h-6 w-6" />
                            ) : (
                              <Film className="h-6 w-6" />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg">
                            <Play className="h-4 w-4 translate-x-[1px] fill-zinc-950" />
                          </span>
                        </div>
                        <div className="absolute bottom-2 left-2.5 flex items-center gap-1.5">
                          {dl.quality && (
                            <span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                              {dl.quality}
                            </span>
                          )}
                          {dl.subtitlePath && (
                            <span className="inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                              <Subtitles className="h-3 w-3" />
                              PT-BR
                            </span>
                          )}
                        </div>
                      </button>

                      <div className="flex flex-1 flex-col justify-between p-4">
                        <div>
                          <h3 className="truncate text-sm font-semibold text-[var(--ph-text)]">
                            {dl.title}
                          </h3>
                          <p className="mt-0.5 text-xs text-[var(--ph-text-muted)] tabular-nums">
                            {dl.mediaType === 'tv'
                              ? `T${dl.season ?? 1} · E${String(dl.episode ?? 1).padStart(2, '0')}`
                              : 'Filme'}
                            {dl.totalBytes > 0 ? ` · ${formatBytes(dl.totalBytes)}` : ''}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onPlayOffline(dl)}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-3 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Assistir Offline</span>
                          </button>

                          <a
                            href={getOfflineFileDownloadUrl(dl.id)}
                            download={dl.fileName || undefined}
                            title="Baixar cópia do arquivo"
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-[var(--ph-text)]"
                          >
                            <Download className="h-4 w-4" />
                          </a>

                          <button
                            type="button"
                            onClick={() => onDelete(dl.id, true)}
                            title="Excluir arquivo do disco"
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] transition-colors hover:bg-[var(--ph-hover)] hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
