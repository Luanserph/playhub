import { isDesktopTauri, isTauri } from '../services/platform';

export function isTauriRuntime(): boolean {
  return isTauri();
}

export function isExternalHttpUrl(rawUrl: string): boolean {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
      return false;
    }
    if (
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      parsed.port === '3001'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  const cleaned = url.trim();
  if (!cleaned) return;

  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(cleaned);
      return;
    } catch {
      // Fallback para plugin-shell no Desktop
      if (isDesktopTauri()) {
        try {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(cleaned);
          return;
        } catch {
          // Segue para fallback web
        }
      }
    }
  }

  window.open(cleaned, '_blank', 'noopener,noreferrer');
}

export function installExternalLinkInterceptor(): () => void {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.hasAttribute('download')) return;

    const href = anchor.href;
    if (!isExternalHttpUrl(href)) return;

    event.preventDefault();
    void openExternalUrl(href);
  };

  document.addEventListener('click', handleClick);
  return () => {
    document.removeEventListener('click', handleClick);
  };
}
