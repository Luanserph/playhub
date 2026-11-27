import { getApiBaseUrl, hasBackendServer, smartFetch } from './platform';

export const API_BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:3001'
).replace(/\/+$/, '');

export { getApiBaseUrl, hasBackendServer, smartFetch };

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Executa fetch com retry automático para absorver o tempo de inicialização
 * do sidecar local (127.0.0.1:3001) nos primeiros segundos do app desktop.
 */
export async function fetchWithBootRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { attempts?: number; delayMs?: number }
): Promise<Response> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const delayMs = options?.delayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await smartFetch(input, init);
    } catch (err) {
      if (
        init?.signal?.aborted ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        throw err;
      }
      lastError = err;
      if (attempt < attempts) {
        await sleepWithSignal(delayMs, init?.signal ?? undefined);
      }
    }
  }

  throw lastError;
}
