import { useEffect, useState } from 'react';
import { readString, writeJson } from '../lib/storage';

export type Theme = 'dark' | 'warm';

/** Warm/dark variant, persisted locally. P2 in the roadmap. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readString('theme', 'dark');
    return stored === 'warm' ? 'warm' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeJson('theme', theme);
  }, [theme]);

  const toggle = () => setTheme((current) => (current === 'dark' ? 'warm' : 'dark'));

  return [theme, toggle];
}
