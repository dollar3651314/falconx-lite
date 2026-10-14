/**
 * 第一版 50 个品种（00-架构方案.md 第 3.6 节）。
 * 价格按 2026 年的大致水平取值，仅作示意；杠杆上限按 A-03 沿用现有第一档；
 * 合约大小按 A-01：外汇 100,000、黄金 100 盎司、白银 5,000 盎司、原油 1,000 桶、指数和加密 1、股票 1 股。
 */
import type { SymbolCategory, SymbolInfo } from '../../api/types';

interface Seed {
  code: string;
  zh: string;
  en: string;
  cat: SymbolCategory;
  digits: number;
  price: string;
  spread: string;
  lev: number;
  hot?: boolean;
  paused?: boolean;
  closed?: boolean;
}

const fx = (code: string, zh: string, en: string, price: string, spread: string, lev: number, hot = false): Seed => ({
  code,
  zh,
  en,
  cat: 'fx',
  digits: price.split('.')[1]?.length ?? 0,
  price,
  spread,
  lev,
  hot,
});

const SEEDS: Seed[] = [
  // 外汇主要货币对 500×
  fx('EURUSD', '欧元/美元', 'Euro / US Dollar', '1.16420', '0.00012', 500, true),
  fx('GBPUSD', '英镑/美元', 'British Pound / US Dollar', '1.33185', '0.00015', 500, true),
  fx('USDJPY', '美元/日元', 'US Dollar / Japanese Yen', '151.842', '0.014', 500, true),
  fx('USDCHF', '美元/瑞郎', 'US Dollar / Swiss Franc', '0.79850', '0.00016', 500),
  fx('USDCAD', '美元/加元', 'US Dollar / Canadian Dollar', '1.39720', '0.00018', 500),
  fx('AUDUSD', '澳元/美元', 'Australian Dollar / US Dollar', '0.65412', '0.00014', 500),
  fx('NZDUSD', '纽元/美元', 'New Zealand Dollar / US Dollar', '0.57630', '0.00018', 500),
  // 外汇交叉盘 300×
  fx('EURGBP', '欧元/英镑', 'Euro / British Pound', '0.87410', '0.00020', 300),
  fx('EURJPY', '欧元/日元', 'Euro / Japanese Yen', '176.780', '0.022', 300),
  fx('GBPJPY', '英镑/日元', 'British Pound / Japanese Yen', '202.230', '0.030', 300),
  fx('EURCHF', '欧元/瑞郎', 'Euro / Swiss Franc', '0.92960', '0.00022', 300),
  fx('EURAUD', '欧元/澳元', 'Euro / Australian Dollar', '1.77980', '0.00030', 300),
  fx('EURCAD', '欧元/加元', 'Euro / Canadian Dollar', '1.62660', '0.00030', 300),
  fx('AUDJPY', '澳元/日元', 'Australian Dollar / Japanese Yen', '99.320', '0.020', 300),
  fx('CADJPY', '加元/日元', 'Canadian Dollar / Japanese Yen', '108.670', '0.024', 300),
  fx('CHFJPY', '瑞郎/日元', 'Swiss Franc / Japanese Yen', '190.150', '0.030', 300),
  fx('AUDCAD', '澳元/加元', 'Australian Dollar / Canadian Dollar', '0.91390', '0.00026', 300),
  fx('AUDNZD', '澳元/纽元', 'Australian Dollar / New Zealand Dollar', '1.13500', '0.00030', 300),
  fx('GBPAUD', '英镑/澳元', 'British Pound / Australian Dollar', '2.03610', '0.00040', 300),
  fx('GBPCHF', '英镑/瑞郎', 'British Pound / Swiss Franc', '1.06350', '0.00030', 300),
  // 离岸人民币 100×
  fx('USDCNH', '美元/离岸人民币', 'US Dollar / Offshore Chinese Yuan', '7.13250', '0.00080', 100, true),
  // 贵金属 200×
  { code: 'XAUUSD', zh: '黄金', en: 'Gold', cat: 'metal', digits: 2, price: '4126.35', spread: '0.40', lev: 200, hot: true },
  { code: 'XAGUSD', zh: '白银', en: 'Silver', cat: 'metal', digits: 3, price: '48.625', spread: '0.030', lev: 200, hot: true },
  // 指数 100×
  { code: 'US30', zh: '道琼斯 30', en: 'Dow Jones 30', cat: 'index', digits: 1, price: '46385.2', spread: '2.0', lev: 100 },
  { code: 'US500', zh: '标普 500', en: 'S&P 500', cat: 'index', digits: 1, price: '6712.4', spread: '0.5', lev: 100 },
  { code: 'NAS100', zh: '纳指 100', en: 'Nasdaq 100', cat: 'index', digits: 1, price: '24812.6', spread: '1.0', lev: 100, hot: true },
  { code: 'US2000', zh: '罗素 2000', en: 'Russell 2000', cat: 'index', digits: 1, price: '2468.3', spread: '0.4', lev: 100 },
  { code: 'GER40', zh: '德国 40', en: 'Germany 40', cat: 'index', digits: 1, price: '24310.5', spread: '1.2', lev: 100 },
  { code: 'UK100', zh: '英国 100', en: 'UK 100', cat: 'index', digits: 1, price: '9428.7', spread: '1.0', lev: 100 },
  { code: 'FRA40', zh: '法国 40', en: 'France 40', cat: 'index', digits: 1, price: '7985.2', spread: '1.0', lev: 100 },
  { code: 'JPN225', zh: '日经 225', en: 'Japan 225', cat: 'index', digits: 0, price: '47820', spread: '8', lev: 100 },
  { code: 'HK50', zh: '恒生 50', en: 'Hong Kong 50', cat: 'index', digits: 1, price: '26150.3', spread: '6.0', lev: 100 },
  { code: 'AUS200', zh: '澳洲 200', en: 'Australia 200', cat: 'index', digits: 1, price: '8975.6', spread: '1.0', lev: 100 },
  // 能源 100×
  { code: 'XTIUSD', zh: '美国原油（WTI 西德克萨斯中质原油）', en: 'US Crude Oil (West Texas Intermediate)', cat: 'energy', digits: 2, price: '61.82', spread: '0.03', lev: 100, hot: true },
  { code: 'XBRUSD', zh: '布伦特原油', en: 'Brent Crude Oil', cat: 'energy', digits: 2, price: '65.47', spread: '0.03', lev: 100 },
  // 加密货币：BTC、ETH 125×，其他 75×
  { code: 'BTCUSD', zh: '比特币', en: 'Bitcoin', cat: 'crypto', digits: 1, price: '112480.5', spread: '18.0', lev: 125, hot: true, paused: true },
  { code: 'ETHUSD', zh: '以太坊', en: 'Ethereum', cat: 'crypto', digits: 2, price: '4086.20', spread: '1.60', lev: 125, hot: true },
  { code: 'SOLUSD', zh: 'Solana', en: 'Solana', cat: 'crypto', digits: 2, price: '196.35', spread: '0.12', lev: 75 },
  { code: 'XRPUSD', zh: '瑞波币', en: 'XRP', cat: 'crypto', digits: 4, price: '2.5841', spread: '0.0020', lev: 75 },
  { code: 'BNBUSD', zh: '币安币', en: 'BNB', cat: 'crypto', digits: 2, price: '1185.40', spread: '0.80', lev: 75 },
  { code: 'DOGEUSD', zh: '狗狗币', en: 'Dogecoin', cat: 'crypto', digits: 5, price: '0.20315', spread: '0.00020', lev: 75 },
  { code: 'ADAUSD', zh: '艾达币', en: 'Cardano', cat: 'crypto', digits: 4, price: '0.7124', spread: '0.0008', lev: 75 },
  { code: 'LTCUSD', zh: '莱特币', en: 'Litecoin', cat: 'crypto', digits: 2, price: '98.65', spread: '0.10', lev: 75 },
  { code: 'DOTUSD', zh: '波卡', en: 'Polkadot', cat: 'crypto', digits: 3, price: '3.982', spread: '0.006', lev: 75 },
  { code: 'BCHUSD', zh: '比特币现金', en: 'Bitcoin Cash', cat: 'crypto', digits: 2, price: '548.30', spread: '0.60', lev: 75 },
  // 美股 100×（原型中模拟为休市，用于展示"交易时段外"）
  { code: 'AAPL', zh: '苹果', en: 'Apple Inc.', cat: 'stock', digits: 2, price: '247.66', spread: '0.06', lev: 100, closed: true },
  { code: 'MSFT', zh: '微软', en: 'Microsoft Corp.', cat: 'stock', digits: 2, price: '513.57', spread: '0.10', lev: 100, closed: true },
  { code: 'NVDA', zh: '英伟达', en: 'NVIDIA Corp.', cat: 'stock', digits: 2, price: '183.16', spread: '0.05', lev: 100, closed: true },
  { code: 'TSLA', zh: '特斯拉', en: 'Tesla Inc.', cat: 'stock', digits: 2, price: '435.15', spread: '0.12', lev: 100, closed: true },
  { code: 'AMZN', zh: '亚马逊', en: 'Amazon.com Inc.', cat: 'stock', digits: 2, price: '216.37', spread: '0.06', lev: 100, closed: true },
];

/** 报价币种 → USD 的折算率（模拟值；正式环境由汇率模块实时提供） */
const QUOTE_TO_USD: Record<string, string> = {
  USD: '1',
  JPY: '0.0065858',
  CHF: '1.2523481',
  CAD: '0.7157171',
  GBP: '1.33185',
  AUD: '0.65412',
  NZD: '0.5763',
  CNH: '0.1402033',
  EUR: '1.1642',
  HKD: '0.1285841',
};

function ccyOf(s: Seed): { base: string; quote: string } {
  if (s.cat === 'fx') return { base: s.code.slice(0, 3), quote: s.code.slice(3) };
  const quoteByIndex: Record<string, string> = { GER40: 'EUR', FRA40: 'EUR', UK100: 'GBP', JPN225: 'JPY', HK50: 'HKD', AUS200: 'AUD' };
  return { base: s.code.replace(/USD$/, ''), quote: quoteByIndex[s.code] ?? 'USD' };
}

function contract(s: Seed): Pick<SymbolInfo, 'contractSize' | 'unit'> {
  switch (s.cat) {
    case 'fx':
      return { contractSize: '100000', unit: 'baseCcy' };
    case 'metal':
      return s.code === 'XAUUSD' ? { contractSize: '100', unit: 'ounce' } : { contractSize: '5000', unit: 'ounce' };
    case 'energy':
      return { contractSize: '1000', unit: 'barrel' };
    case 'stock':
      return { contractSize: '1', unit: 'share' };
    default:
      return { contractSize: '1', unit: 'unit' };
  }
}

export interface SymbolSeed {
  info: SymbolInfo;
  price: string;
  spread: string;
  quoteToUsd: string;
}

export const SYMBOL_SEEDS: SymbolSeed[] = SEEDS.map((s) => {
  const { base, quote } = ccyOf(s);
  const info: SymbolInfo = {
    code: s.code,
    nameZh: s.zh,
    nameEn: s.en,
    category: s.cat,
    digits: s.digits,
    ...contract(s),
    baseCcy: base,
    quoteCcy: quote,
    maxLeverage: s.lev,
    minLots: '0.01',
    maxLots: s.cat === 'fx' ? '50' : '20',
    lotStep: '0.01',
    feeRate: '0.00005',
    maintenanceMarginRate: '0.005',
    hot: !!s.hot,
    openPaused: !!s.paused,
    tradingOpen: !s.closed,
  };
  return { info, price: s.price, spread: s.spread, quoteToUsd: QUOTE_TO_USD[quote] ?? '1' };
});
