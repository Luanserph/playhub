const LAN_SERVER_STORAGE_KEY = 'playhub_lan_server_url';
const DEFAULT_LOCAL_API_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:3001'
).replace(/\/+$/, '');

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isTauri() && /Android/i.test(navigator.userAgent);
}

export function applyPlatformDocumentClasses(): void {
  if (typeof document === 'undefined') return;
  if (isAndroid()) {
    document.documentElement.classList.add('is-android');
  } else {
    document.documentElement.classList.remove('is-android');
  }
}

applyPlatformDocumentClasses();

export function isDesktopTauri(): boolean {
  return isTauri() && !isAndroid();
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    isAndroid() ||
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
}

export function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function getLanServerUrl(): string {
  try {
    const raw = localStorage.getItem(LAN_SERVER_STORAGE_KEY) || '';
    return normalizeServerUrl(raw);
  } catch {
    return '';
  }
}

export function setLanServerUrl(rawUrl: string): string {
  const normalized = normalizeServerUrl(rawUrl);
  try {
    if (normalized) {
      localStorage.setItem(LAN_SERVER_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(LAN_SERVER_STORAGE_KEY);
    }
  } catch {
    // storage indisponível
  }
  return normalized;
}

export function hasBackendServer(): boolean {
  if (!isAndroid()) return true;
  return Boolean(getLanServerUrl());
}

export function getApiBaseUrl(): string {
  if (isAndroid()) {
    return getLanServerUrl();
  }
  return DEFAULT_LOCAL_API_URL;
}

/**
 * Executa fetch usando @tauri-apps/plugin-http no Android (contornando CORS
 * no WebView Android para TMDB, add-ons Stremio, legendas e servidor LAN)
 * e mantém o window.fetch padrão no Windows/Web.
 */
export async function smartFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (isAndroid()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return await tauriFetch(input, init);
  }
  return await window.fetch(input, init);
}

export async function testLanServerConnection(
  rawUrl: string
): Promise<{ ok: boolean; normalizedUrl: string; error?: string }> {
  const normalizedUrl = normalizeServerUrl(rawUrl);
  if (!normalizedUrl) {
    return {
      ok: false,
      normalizedUrl: '',
      error: 'Informe um endereço válido (ex: http://192.168.1.10:3001).',
    };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);
  try {
    const res = await smartFetch(`${normalizedUrl}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        ok: false,
        normalizedUrl,
        error: `Servidor respondeu com HTTP ${res.status}.`,
      };
    }
    const data = (await res.json()) as { ok?: boolean };
    if (!data?.ok) {
      return {
        ok: false,
        normalizedUrl,
        error: 'Resposta inesperada do servidor PlayHub.',
      };
    }
    return { ok: true, normalizedUrl };
  } catch {
    return {
      ok: false,
      normalizedUrl,
      error: 'Não foi possível conectar. Verifique se o PlayHub PC está aberto na mesma rede Wi-Fi.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}
