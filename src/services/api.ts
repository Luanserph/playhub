export const API_BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:3001'
).replace(/\/+$/, '');
