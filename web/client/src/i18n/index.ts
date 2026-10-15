/**
 * 多语言：默认中文，可切换英文。两份翻译文件的键必须完全一致（见 i18n.test.ts）。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './zh-CN.json';
import en from './en.json';
import type { Lang } from '../api/types';
import { setPushLanguage } from '../api/notifications';

const LANG_KEY = 'fx.lang';

function initialLang(): Lang {
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
