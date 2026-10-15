import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeContext, type Theme, type UpDown } from './contexts';

// v2：默认改为深色（UI 风格 C），换新键名，旧的浅色记录不再沿用
const THEME_KEY = 'fx.theme.v2';
const UPDOWN_KEY = 'fx.updown';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 忽略 */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (read(THEME_KEY) === 'light' ? 'light' : 'dark'));
  const [upDown, setUpDown] = useState<UpDown>(() => (read(UPDOWN_KEY) === 'red' ? 'red' : 'green'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#0e7490');
    write(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.updown = upDown;
    write(UPDOWN_KEY, upDown);
  }, [upDown]);
  const value = useMemo(() => ({ theme, setTheme, upDown, setUpDown }), [theme, upDown]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
