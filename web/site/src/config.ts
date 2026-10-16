/**
 * 官网的固定配置：联系邮箱、客户端地址、品种的短名称和分类。
 * 行情显示哪些品种由后端配置决定（application.yml 的 falconx.market.public-quotes.symbols），这里只补充展示用的短名称和分类；
 * 后端返回了这里没有的代码时，名称用接口返回的中英文名，只出现在"热门"分类。
 */
import type { Lang } from './i18n/lang';

/** 联系邮箱（v2 需求第 10 节 F2-3） */
export const CONTACT_EMAIL = 'info@quickcome.online';

/** 分类（顺序就是行情面板的分类标签顺序，"热门"是全部） */
export const CATEGORIES = ['hot', 'fx', 'metal', 'index', 'energy', 'crypto'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface SymbolMeta {
  zh: string;
  en: string;
  category: Exclude<Category, 'hot'>;
}

/** 默认 10 个品种的短名称（品种表里的全称太长，例如原油），和 V4 品种表的代码一致 */
export const SYMBOL_META: Record<string, SymbolMeta> = {
  XAUUSD: { zh: '黄金', en: 'Gold', category: 'metal' },
  XAGUSD: { zh: '白银', en: 'Silver', category: 'metal' },
  EURUSD: { zh: '欧元/美元', en: 'EUR/USD', category: 'fx' },
  GBPUSD: { zh: '英镑/美元', en: 'GBP/USD', category: 'fx' },
  USDJPY: { zh: '美元/日元', en: 'USD/JPY', category: 'fx' },
  USDCNH: { zh: '美元/离岸人民币', en: 'USD/CNH', category: 'fx' },
  NAS100: { zh: '纳指 100', en: 'Nasdaq 100', category: 'index' },
  XTIUSD: { zh: '美国原油', en: 'US Crude Oil', category: 'energy' },
  BTCUSD: { zh: '比特币', en: 'Bitcoin', category: 'crypto' },
  ETHUSD: { zh: '以太坊', en: 'Ethereum', category: 'crypto' },
};

/** 默认品种顺序（第一次拿到行情之前先按这个显示占位行） */
export const DEFAULT_SYMBOLS = Object.keys(SYMBOL_META);

/** 品种的展示名：优先用短名称，没有时用接口返回的名称 */
export function symbolName(code: string, lang: Lang, fromApi?: { nameZh?: string; nameEn?: string }): string {
  const m = SYMBOL_META[code];
  if (m) return lang === 'en' ? m.en : m.zh;
  return (lang === 'en' ? fromApi?.nameEn : fromApi?.nameZh) || code;
}

const PLACEHOLDER = '__QC_CLIENT_URL__';

/**
 * 客户端地址（不带结尾的 /）。优先级：构建变量 VITE_CLIENT_URL → 页面 <meta name="qc-client-url">（部署时由 Nginx 替换）→ 空串（同源相对地址）。
 */
export function resolveClientUrl(buildValue: string | undefined, metaValue: string | null | undefined): string {
  const pick = (v: string | null | undefined) => {
    const s = (v || '').trim();
    return s && s !== PLACEHOLDER && /^https?:\/\/[^\s"'<>]+$/.test(s) ? s.replace(/\/+$/, '') : '';
  };
  return pick(buildValue) || pick(metaValue);
}

let cachedClientUrl: string | undefined;
export function clientUrl(): string {
  if (cachedClientUrl === undefined) {
    const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="qc-client-url"]')?.getAttribute('content') : null;
    cachedClientUrl = resolveClientUrl(import.meta.env.VITE_CLIENT_URL, meta);
  }
  return cachedClientUrl;
}

/** 注册、登录的地址：客户端的 /register、/login，带上当前语言（客户端读 ?lang=，web/client/src/i18n/urlLang.ts） */
export function clientLink(page: 'register' | 'login', lang: Lang, base = clientUrl()): string {
  return `${base}/${page}?lang=${lang}`;
}
