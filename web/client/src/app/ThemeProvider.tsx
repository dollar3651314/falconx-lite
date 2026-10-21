import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { UX1021 } from '../lib/ux1021';
import { ThemeContext, type Theme, type UpDown } from './contexts';

// v2：默认改为深色（UI 风格 C），换新键名，旧的浅色记录不再沿用
const THEME_KEY = 'fx.theme.v2';
// 体验优化 1021（Amos 第 8 条"建议默认浅色，黑色太脏"）：默认浅色。v2 的键每次打开页面都会写入当前主题，
// 分不清"自己选了深色"和"默认就是深色"，所以换新键 v3，只在客户自己切换时写入（UX-8，方案第 8 节）
const THEME_KEY_V3 = 'fx.theme.v3';
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

function initialTheme(): Theme {
  if (UX1021) return read(THEME_KEY_V3) === 'dark' ? 'dark' : 'light';
  return read(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [upDown, setUpDown] = useState<UpDown>(() => (read(UPDOWN_KEY) === 'red' ? 'red' : 'green'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#0e7490');
    if (!UX1021) write(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.updown = upDown;
    write(UPDOWN_KEY, upDown);
  }, [upDown]);
  /** 客户自己切换：v3 只在这里写入，没选过的人以后改默认值时跟着变 */
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (UX1021) write(THEME_KEY_V3, t);
  }, []);
  const value = useMemo(() => ({ theme, setTheme, upDown, setUpDown }), [theme, setTheme, upDown]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
