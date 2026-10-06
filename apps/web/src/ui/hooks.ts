import { useEffect, useState } from 'react';

/** Vrai tant que la media query correspond (rotation, redimensionnement compris). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** État mémorisé dans le navigateur (préférence d'affichage) ; repli silencieux sans stockage. */
export function useStoredState<T extends string | boolean>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return initial;
      return (typeof initial === 'boolean' ? stored === 'true' : stored) as T;
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Navigation privée : la préférence vaut pour la session.
    }
  };
  return [value, update];
}
