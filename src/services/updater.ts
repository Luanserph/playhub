import type { Update } from '@tauri-apps/plugin-updater';
import { openExternalUrl } from '../utils/externalLink';
import { isAndroid, isDesktopTauri, smartFetch } from './platform';

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/Luanserph/playhub/releases/latest';

export const FALLBACK_APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
    ? __APP_VERSION__.trim()
    : '0.3.0';

export type AppUpdate =
  | {
      kind: 'desktop';
      version: string;
      notes?: string;
      tauriUpdate: Update;
    }
  | {
      kind: 'android';
      version: string;
      notes?: string;
      downloadUrl: string;
    };

export interface UpdateDownloadProgress {
  downloaded: number;
  contentLength: number | null;
  percent: number | null;
}

function normalizeVersion(raw: string): number[] {
  const cleaned = raw.trim().replace(/^v/i, '').split('-')[0];
  return cleaned
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function isVersionNewer(remoteVersion: string, currentVersion: string): boolean {
  const remote = normalizeVersion(remoteVersion);
  const current = normalizeVersion(currentVersion);
  const len = Math.max(remote.length, current.length, 3);

  for (let i = 0; i < len; i++) {
    const r = remote[i] ?? 0;
    const c = current[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
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

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubLatestReleaseResponse {
  tag_name?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
}

async function checkForAndroidUpdate(): Promise<AppUpdate | null> {
  const res = await smartFetch(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as GitHubLatestReleaseResponse;
  const rawTag = typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
  if (!rawTag) return null;

  const remoteVersion = rawTag.replace(/^v/i, '');
  const currentVersion = FALLBACK_APP_VERSION;
  if (!isVersionNewer(remoteVersion, currentVersion)) {
    return null;
  }

  const assets = Array.isArray(data.assets) ? data.assets : [];
  const apkAsset = assets.find(
    (asset) =>
      typeof asset.name === 'string' &&
      asset.name.toLowerCase().endsWith('.apk') &&
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.startsWith('https://')
  );

  if (!apkAsset?.browser_download_url) {
    return null;
  }

  return {
    kind: 'android',
    version: remoteVersion,
    notes: typeof data.body === 'string' ? data.body : undefined,
    downloadUrl: apkAsset.browser_download_url,
  };
}

export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (isDesktopTauri()) {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return null;
    return {
      kind: 'desktop',
      version: update.version,
      notes: update.body ?? undefined,
      tauriUpdate: update,
    };
  }

  if (isAndroid()) {
    return checkForAndroidUpdate();
  }

  return null;
}

export async function installAppUpdate(
  update: AppUpdate,
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<void> {
  if (update.kind === 'android') {
    await openExternalUrl(update.downloadUrl);
    return;
  }

  if (!isDesktopTauri()) return;

  let downloaded = 0;
  let contentLength: number | null = null;

  await update.tauriUpdate.download((event) => {
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

  await update.tauriUpdate.install();

  // Caso o instalador não reinicie o app automaticamente
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch {
    // No Windows o instalador NSIS passivo costuma encerrar/reabrir o processo
  }
}
