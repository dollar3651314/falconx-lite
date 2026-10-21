import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeContext, type Theme, type UpDown } from './contexts';

// 体验优化 1021（Amos 第 8 条"建议默认浅色，黑色太脏"，UX-8）：默认浅色。v2 的键 fx.theme.v2 每次打开页面都会写入当前主题，
// 分不清"自己选了深色"和"默认就是深色"，所以换新键 v3、旧键不再读，**只在客户自己切换时写入**：选过深色的人以后一直是深色。
// 页面打开前的预设（index.html 的 data-theme、theme-color，PWA 背景色）也是浅色，避免先闪一下黑屏。
const THEME_KEY = 'fx.theme.v3';
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
  return read(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [upDown, setUpDown] = useState<UpDown>(() => (read(UPDOWN_KEY) === 'red' ? 'red' : 'green'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#0e7490');
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.updown = upDown;
    write(UPDOWN_KEY, upDown);
  }, [upDown]);
  /** 客户自己切换：只在这里写入，没选过的人以后改默认值时跟着变 */
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    write(THEME_KEY, t);
  }, []);
  const value = useMemo(() => ({ theme, setTheme, upDown, setUpDown }), [theme, setTheme, upDown]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
