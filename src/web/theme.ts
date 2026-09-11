import { useCallback, useEffect, useState } from 'react';

/**
 * Light, dark, or whatever the phone is doing.
 *
 * The phone's own setting is the default and always was — most dads never
 * touch this. But a dad reading in bed on a laptop that never flips to dark
 * has no way to ask for it, and telling him to change his OS is not an answer.
 * So: three states, and "system" is one of them rather than the absence of a
 * choice.
 *
 * The stylesheet holds all three: bare `:root` is light, the
 * prefers-color-scheme block is system dark, and `[data-theme]` on the root
 * element is an explicit override that beats both.
 */
export type Theme = 'system' | 'light' | 'dark';

const STORAGE = 'dads.theme';

export function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // A browser that refuses storage still gets the phone's setting.
  }
  return 'system';
}

/** --bg, light and dark. The one place outside tokens.css that needs them. */
const BAR = { light: '#fcfcfb', dark: '#121314' };

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;

  // The browser's own chrome — the bar above the page on a phone — follows a
  // change made now, not only one restored by the shell at boot. On 'system'
  // the media-query pair in index.html takes back over.
  const fixed = document.querySelector('meta[name="theme-color"]:not([media])');
  if (theme === 'system') {
    fixed?.remove();
    return;
  }
  const meta = fixed ?? document.head.appendChild(document.createElement('meta'));
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', BAR[theme]);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => storedTheme());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE, next);
    } catch {
      // Remembering is a convenience, not a requirement.
    }
  }, []);

  return [theme, setTheme];
}
