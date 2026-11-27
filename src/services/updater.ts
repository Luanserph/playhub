import type { Update } from '@tauri-apps/plugin-updater';
import { isDesktopTauri } from './platform';

export const FALLBACK_APP_VERSION = '0.3.0';

export type AppUpdate = Update;

export interface UpdateDownloadProgress {
  downloaded: number;
  contentLength: number | null;
  percent: number | null;
}

export async function getCurrentAppVersion(): Promise<string> {
  if (!isDesktopTauri()) {
    return FALLBACK_APP_VERSION;
  }
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return FALLBACK_APP_VERSION;
  }
}

export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!isDesktopTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  return await check();
}

export async function installAppUpdate(
  update: AppUpdate,
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<void> {
  if (!isDesktopTauri()) return;

  let downloaded = 0;
  let contentLength: number | null = null;

  await update.download((event) => {
    if (event.event === 'Started') {
      contentLength = event.data.contentLength ?? null;
      downloaded = 0;
      onProgress?.({ downloaded: 0, contentLength, percent: contentLength ? 0 : null });
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      const percent =
        contentLength && contentLength > 0
          ? Math.min(100, Math.round((downloaded / contentLength) * 100))
          : null;
      onProgress?.({ downloaded, contentLength, percent });
    } else if (event.event === 'Finished') {
      onProgress?.({
        downloaded: contentLength ?? downloaded,
        contentLength,
        percent: 100,
      });
    }
  });

  // Encerra o sidecar playhub-server.exe e sua árvore antes da instalação passiva do NSIS
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('stop_server_for_update');
  } catch {
    // Segue com a instalação mesmo se o sidecar já estiver encerrado
  }

  await update.install();

  // Caso o instalador não reinicie o app automaticamente
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch {
    // No Windows o instalador NSIS passivo costuma encerrar/reabrir o processo
  }
}
