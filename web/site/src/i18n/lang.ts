/**
 * 官网语言（v2 需求第 10 节 W6）：默认跟随浏览器——浏览器首选语言以 zh 开头用中文，否则英文；访客手动切换后记住（localStorage）。
 */
export type Lang = 'zh-CN' | 'en';

export const LANG_KEY = 'qc.site.lang';

/** 记住的语言优先；没有时看浏览器的首选语言（navigator.languages 的第一个，没有时 navigator.language） */
export function detectLang(stored: string | null | undefined, languages: readonly string[] | undefined, language?: string): Lang {
  if (stored === 'zh-CN' || stored === 'en') return stored;
  const first = (languages && languages.length > 0 ? languages[0] : language) || '';
  return first.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function readStoredLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

export function storeLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* 隐私模式等：不记住也能用 */
  }
}

export function initialLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return detectLang(readStoredLang(), nav?.languages, nav?.language);
}
