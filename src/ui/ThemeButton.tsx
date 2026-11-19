import { useEffect, useState } from 'react';

type Theme = 'auto' | 'light' | 'dark';
const KEY = 'wiring-sketchpad.theme';
const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
const LABEL: Record<Theme, string> = { auto: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' };

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* per-device convenience only */
    }
  }, [theme]);
  return (
    <button type="button" onClick={() => setTheme(NEXT[theme])} aria-label={LABEL[theme]} title={LABEL[theme]}>
      {theme === 'auto' ? '◐' : theme === 'light' ? '☀' : '☾'}
    </button>
  );
}
