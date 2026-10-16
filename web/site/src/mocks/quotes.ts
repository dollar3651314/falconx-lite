/**
 * 原型模式（VITE_API_MODE=mock，Vercel 预览站和单元测试）的模拟行情：浏览器内随机游走，每次调用都返回同样结构的结果。
 * 休市规则简化成和品种表一致的大框：加密货币全天；其他品种 UTC 周五 21:00 到周日 22:00 休市。
 * real 构建不含本文件（约定 20）。
 */
import type { PublicQuote, PublicQuotes } from '../api/types';

/** 模拟层特有的标记（scripts/check-no-mocks.mjs 用它判断模拟层有没有被打包进真实构建） */
export const MOCK_FEED_NAME = 'quickcome-site-browser-simulated-feed';

interface Sim {
  symbol: string;
  nameZh: string;
  nameEn: string;
  open: number;
  digits: number;
  crypto: boolean;
  last: number;
}

const BASE: [string, string, string, number, number, boolean][] = [
  ['XAUUSD', '黄金', 'Gold', 4126.35, 2, false],
  ['XAGUSD', '白银', 'Silver', 48.625, 3, false],
  ['EURUSD', '欧元/美元', 'Euro / US Dollar', 1.1642, 5, false],
  ['GBPUSD', '英镑/美元', 'British Pound / US Dollar', 1.33185, 5, false],
  ['USDJPY', '美元/日元', 'US Dollar / Japanese Yen', 151.842, 3, false],
  ['USDCNH', '美元/离岸人民币', 'US Dollar / Offshore Chinese Yuan', 7.1325, 5, false],
  ['NAS100', '纳指 100', 'Nasdaq 100', 24812.6, 1, false],
  ['XTIUSD', '美国原油（WTI 西德克萨斯中质原油）', 'US Crude Oil (West Texas Intermediate)', 61.82, 2, false],
  ['BTCUSD', '比特币', 'Bitcoin', 112480.5, 1, true],
  ['ETHUSD', '以太坊', 'Ethereum', 4086.2, 2, true],
];

// 开盘价在示例价上下 1.5% 以内，涨跌有正有负
const sims: Sim[] = BASE.map(([symbol, nameZh, nameEn, px, digits, crypto], i) => {
  const open = px * (1 + ((i % 3) - 1) * 0.006 + (i % 2 ? 0.003 : -0.004));
  return { symbol, nameZh, nameEn, open, digits, crypto, last: px };
});

/** UTC 周五 21:00 到周日 22:00 休市（加密货币除外） */
export function mockMarketOpen(crypto: boolean, now: Date): boolean {
  if (crypto) return true;
  const day = now.getUTCDay();
  const min = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (day === 6) return false;
  if (day === 5 && min >= 21 * 60) return false;
  if (day === 0 && min < 22 * 60) return false;
  return true;
}

/** 取一次模拟行情：每次随机挑几个品种走一步（约每秒调用一次，10 秒内每个品种都会变） */
export function mockPublicQuotes(now: Date = new Date()): Promise<PublicQuotes> {
  for (const s of sims) {
    if (Math.random() < 0.6) {
      const step = (Math.random() - 0.5) * 0.0008;
      s.last = Math.max(s.last * (1 + step), s.open * 0.9);
    }
  }
  const items: PublicQuote[] = sims.map((s) => {
    if (!mockMarketOpen(s.crypto, now)) {
      return { symbol: s.symbol, nameZh: s.nameZh, nameEn: s.nameEn, bid: null, changePct: null, time: null, status: 'CLOSED' };
    }
    const bid = s.last.toFixed(s.digits);
    const pct = (((Number(bid) - s.open) / s.open) * 100).toFixed(2);
    return { symbol: s.symbol, nameZh: s.nameZh, nameEn: s.nameEn, bid, changePct: pct === '-0.00' ? '0.00' : pct, time: now.toISOString(), status: 'OPEN' };
  });
  return Promise.resolve({ sample: true, items });
}
