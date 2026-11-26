import { useSyncExternalStore } from 'react';

export function useIsDesktop(breakpoint = 768): boolean {
  const query = `(min-width: ${breakpoint}px)`;

  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => true
  );
}
