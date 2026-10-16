/**
 * 多语言：默认中文，可切换英文。两份翻译文件的键必须完全一致（见 i18n.test.ts）。
 * 官网（web/site）跳到注册、登录页时带 `?lang=zh-CN|en`：有这个参数时以它为准并记住（v2 需求 4.4，到了客户端也是同一种语言）。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './zh-CN.json';
import en from './en.json';
import type { Lang } from '../api/types';
import { setPushLanguage } from '../api/notifications';
import { langFromSearch } from './urlLang';

const LANG_KEY = 'fx.lang';

function initialLang(): Lang {
  const fromUrl = typeof location !== 'undefined' ? langFromSearch(location.search) : null;
  if (fromUrl) {
    try {
      localStorage.setItem(LANG_KEY, fromUrl);
    } catch {
      /* 忽略 */
    }
    return fromUrl;
  }
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'zh-CN') return v;
  } catch {
    /* 忽略 */
  }
  return 'zh-CN';
}

const lng = initialLang();

void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false }, // React 自己会转义
  returnNull: false,
});

function applyLang(l: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  setPushLanguage(l);
}
applyLang(lng);

export function currentLang(): Lang {
  return i18n.language === 'en' ? 'en' : 'zh-CN';
}

export async function setLanguage(l: Lang): Promise<void> {
  await i18n.changeLanguage(l);
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* 忽略 */
  }
  applyLang(l);
}

export default i18n;
