/**
 * 第一版 50 个品种（00-架构方案.md 第 3.6 节）。合约大小按 A-01 的行业惯例，杠杆按 A-03 沿用现有第一档。
 * 隔夜费率：现有数据只有 BTCUSD、XAUUSD 有值（A-02），这里再示意性地给几个已录入的，其余为 null（后台标红）。
 */
import type { SymbolCategory, TradingSymbol } from '../../api/types';

interface Seed {
  code: string;
  zh: string;
  en: string;
  cat: SymbolCategory;
  quote: string;
  digits: number;
}

const seeds: Seed[] = [
  // 外汇主要货币对 7
  { code: 'EURUSD', zh: '欧元/美元', en: 'Euro / US Dollar', cat: 'forex_major', quote: 'USD', digits: 5 },
  { code: 'GBPUSD', zh: '英镑/美元', en: 'British Pound / US Dollar', cat: 'forex_major', quote: 'USD', digits: 5 },
  { code: 'USDJPY', zh: '美元/日元', en: 'US Dollar / Japanese Yen', cat: 'forex_major', quote: 'JPY', digits: 3 },
  { code: 'USDCHF', zh: '美元/瑞郎', en: 'US Dollar / Swiss Franc', cat: 'forex_major', quote: 'CHF', digits: 5 },
  { code: 'USDCAD', zh: '美元/加元', en: 'US Dollar / Canadian Dollar', cat: 'forex_major', quote: 'CAD', digits: 5 },
  { code: 'AUDUSD', zh: '澳元/美元', en: 'Australian Dollar / US Dollar', cat: 'forex_major', quote: 'USD', digits: 5 },
  { code: 'NZDUSD', zh: '纽元/美元', en: 'New Zealand Dollar / US Dollar', cat: 'forex_major', quote: 'USD', digits: 5 },
  // 外汇交叉盘 13
  { code: 'EURGBP', zh: '欧元/英镑', en: 'Euro / British Pound', cat: 'forex_cross', quote: 'GBP', digits: 5 },
  { code: 'EURJPY', zh: '欧元/日元', en: 'Euro / Japanese Yen', cat: 'forex_cross', quote: 'JPY', digits: 3 },
  { code: 'GBPJPY', zh: '英镑/日元', en: 'British Pound / Japanese Yen', cat: 'forex_cross', quote: 'JPY', digits: 3 },
  { code: 'EURCHF', zh: '欧元/瑞郎', en: 'Euro / Swiss Franc', cat: 'forex_cross', quote: 'CHF', digits: 5 },
  { code: 'EURAUD', zh: '欧元/澳元', en: 'Euro / Australian Dollar', cat: 'forex_cross', quote: 'AUD', digits: 5 },
  { code: 'EURCAD', zh: '欧元/加元', en: 'Euro / Canadian Dollar', cat: 'forex_cross', quote: 'CAD', digits: 5 },
  { code: 'AUDJPY', zh: '澳元/日元', en: 'Australian Dollar / Japanese Yen', cat: 'forex_cross', quote: 'JPY', digits: 3 },
  { code: 'CADJPY', zh: '加元/日元', en: 'Canadian Dollar / Japanese Yen', cat: 'forex_cross', quote: 'JPY', digits: 3 },
  { code: 'CHFJPY', zh: '瑞郎/日元', en: 'Swiss Franc / Japanese Yen', cat: 'forex_cross', quote: 'JPY', digits: 3 },
  { code: 'AUDCAD', zh: '澳元/加元', en: 'Australian Dollar / Canadian Dollar', cat: 'forex_cross', quote: 'CAD', digits: 5 },
  { code: 'AUDNZD', zh: '澳元/纽元', en: 'Australian Dollar / New Zealand Dollar', cat: 'forex_cross', quote: 'NZD', digits: 5 },
  { code: 'GBPAUD', zh: '英镑/澳元', en: 'British Pound / Australian Dollar', cat: 'forex_cross', quote: 'AUD', digits: 5 },
  { code: 'GBPCHF', zh: '英镑/瑞郎', en: 'British Pound / Swiss Franc', cat: 'forex_cross', quote: 'CHF', digits: 5 },
  // 离岸人民币 1
  { code: 'USDCNH', zh: '美元/离岸人民币', en: 'US Dollar / Offshore Yuan', cat: 'cnh', quote: 'CNH', digits: 5 },
  // 贵金属 2
  { code: 'XAUUSD', zh: '黄金', en: 'Gold', cat: 'metal', quote: 'USD', digits: 2 },
  { code: 'XAGUSD', zh: '白银', en: 'Silver', cat: 'metal', quote: 'USD', digits: 3 },
  // 指数 10
  { code: 'US30', zh: '道琼斯 30', en: 'Dow Jones 30', cat: 'index', quote: 'USD', digits: 1 },
  { code: 'US500', zh: '标普 500', en: 'S&P 500', cat: 'index', quote: 'USD', digits: 1 },
  { code: 'NAS100', zh: '纳指 100', en: 'Nasdaq 100', cat: 'index', quote: 'USD', digits: 1 },
  { code: 'US2000', zh: '罗素 2000', en: 'Russell 2000', cat: 'index', quote: 'USD', digits: 1 },
  { code: 'GER40', zh: '德国 DAX 40', en: 'Germany DAX 40', cat: 'index', quote: 'EUR', digits: 1 },
  { code: 'UK100', zh: '英国富时 100', en: 'UK FTSE 100', cat: 'index', quote: 'GBP', digits: 1 },
  { code: 'FRA40', zh: '法国 CAC 40', en: 'France CAC 40', cat: 'index', quote: 'EUR', digits: 1 },
  { code: 'JPN225', zh: '日经 225', en: 'Nikkei 225', cat: 'index', quote: 'JPY', digits: 0 },
  { code: 'HK50', zh: '恒生 50', en: 'Hang Seng 50', cat: 'index', quote: 'HKD', digits: 0 },
  { code: 'AUS200', zh: '澳洲 200', en: 'Australia 200', cat: 'index', quote: 'AUD', digits: 1 },
  // 能源 2
  { code: 'XTIUSD', zh: '美国原油', en: 'WTI Crude Oil', cat: 'energy', quote: 'USD', digits: 2 },
  { code: 'XBRUSD', zh: '布伦特原油', en: 'Brent Crude Oil', cat: 'energy', quote: 'USD', digits: 2 },
  // 加密货币 10
  { code: 'BTCUSD', zh: '比特币', en: 'Bitcoin', cat: 'crypto', quote: 'USD', digits: 2 },
  { code: 'ETHUSD', zh: '以太坊', en: 'Ethereum', cat: 'crypto', quote: 'USD', digits: 2 },
  { code: 'SOLUSD', zh: 'Solana', en: 'Solana', cat: 'crypto', quote: 'USD', digits: 3 },
  { code: 'XRPUSD', zh: '瑞波币', en: 'XRP', cat: 'crypto', quote: 'USD', digits: 5 },
  { code: 'BNBUSD', zh: '币安币', en: 'BNB', cat: 'crypto', quote: 'USD', digits: 2 },
  { code: 'DOGEUSD', zh: '狗狗币', en: 'Dogecoin', cat: 'crypto', quote: 'USD', digits: 5 },
  { code: 'ADAUSD', zh: '艾达币', en: 'Cardano', cat: 'crypto', quote: 'USD', digits: 5 },
  { code: 'LTCUSD', zh: '莱特币', en: 'Litecoin', cat: 'crypto', quote: 'USD', digits: 2 },
  { code: 'DOTUSD', zh: '波卡', en: 'Polkadot', cat: 'crypto', quote: 'USD', digits: 4 },
  { code: 'BCHUSD', zh: '比特币现金', en: 'Bitcoin Cash', cat: 'crypto', quote: 'USD', digits: 2 },
  // 美股 5
  { code: 'AAPL', zh: '苹果', en: 'Apple Inc.', cat: 'stock', quote: 'USD', digits: 2 },
  { code: 'MSFT', zh: '微软', en: 'Microsoft Corp.', cat: 'stock', quote: 'USD', digits: 2 },
  { code: 'NVDA', zh: '英伟达', en: 'NVIDIA Corp.', cat: 'stock', quote: 'USD', digits: 2 },
  { code: 'TSLA', zh: '特斯拉', en: 'Tesla Inc.', cat: 'stock', quote: 'USD', digits: 2 },
  { code: 'AMZN', zh: '亚马逊', en: 'Amazon.com Inc.', cat: 'stock', quote: 'USD', digits: 2 },
];

const contractSize: Record<SymbolCategory, string> = {
  forex_major: '100000',
  forex_cross: '100000',
  cnh: '100000',
  metal: '100',
  index: '1',
  energy: '1000',
  crypto: '1',
  stock: '1',
};

function leverageOf(s: Seed): number {
  switch (s.cat) {
    case 'forex_major':
      return 500;
    case 'forex_cross':
      return 300;
    case 'metal':
      return 200;
    case 'crypto':
      return s.code === 'BTCUSD' || s.code === 'ETHUSD' ? 125 : 75;
    default:
      return 100;
  }
}

const sessionOf: Record<SymbolCategory, string> = {
  forex_major: 'S-FX',
  forex_cross: 'S-FX',
  cnh: 'S-FX',
  metal: 'S-METAL',
  energy: 'S-ENERGY',
  index: 'S-INDEX',
  crypto: 'S-CRYPTO',
  stock: 'S-USSTOCK',
};

/** 已录入隔夜费率的品种（示意） */
const swaps: Record<string, [string, string]> = {
  XAUUSD: ['-0.000192', '0.000061'],
  BTCUSD: ['-0.000548', '-0.000548'],
  EURUSD: ['-0.000071', '0.000025'],
  USDJPY: ['0.000118', '-0.000214'],
  GBPUSD: ['-0.000052', '0.000009'],
  XTIUSD: ['-0.000133', '-0.000041'],
  NAS100: ['-0.000155', '0.000037'],
  ETHUSD: ['-0.000548', '-0.000548'],
};

const HOT = new Set(['XAUUSD', 'BTCUSD', 'EURUSD', 'NAS100', 'XTIUSD', 'ETHUSD', 'USDJPY', 'NVDA']);

export function buildSymbols(): TradingSymbol[] {
  return seeds.map((s, i) => {
    const sw = swaps[s.code];
    const crypto = s.cat === 'crypto';
    return {
      code: s.code,
      nameZh: s.zh,
      nameEn: s.en,
      category: s.cat,
      quoteCurrency: s.quote,
      lpSymbol: `${s.code}${crypto ? '.c' : s.cat === 'stock' ? '.us' : '.lp'}`,
      contractSize: contractSize[s.cat],
      minLots: '0.01',
      maxLeverage: leverageOf(s),
      maintenanceMarginRate: crypto ? '0.5' : s.cat === 'stock' ? '0.4' : '0.3',
      openFeeRate: crypto ? '0.0006' : s.cat === 'stock' ? '0.0004' : '0.00007',
      swapLong: sw ? sw[0] : null,
      swapShort: sw ? sw[1] : null,
      spreadPoints: crypto ? 25 : s.cat === 'index' ? 12 : s.cat === 'metal' ? 18 : 8,
      digits: s.digits,
      hot: HOT.has(s.code),
      // XPD 不在清单；这里让 SOLUSD 处于暂停状态，演示"启用/暂停"
      enabled: s.code !== 'SOLUSD',
      sessionId: sessionOf[s.cat],
      updatedAt: `2026-10-${String(10 + (i % 4)).padStart(2, '0')} ${String(9 + (i % 8)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00`,
    };
  });
}

export const SYMBOL_COUNT = seeds.length;
