/**
 * 第一版 50 个品种（00-架构方案.md 第 3.6 节）。
 * 起始价、点差和后端模拟报价源 backend/src/main/resources/simulated-prices.csv 相同（2026-10-16 的市价，来源见 技术方案/v2-模拟报价起始价.md），仅作示意；杠杆上限按 A-03 沿用现有第一档；
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
  fx('EURUSD', '欧元/美元', 'Euro / US Dollar', '1.12500', '0.00012', 500, true),
  fx('GBPUSD', '英镑/美元', 'British Pound / US Dollar', '1.33420', '0.00015', 500, true),
  fx('USDJPY', '美元/日元', 'US Dollar / Japanese Yen', '157.915', '0.015', 500, true),
  fx('USDCHF', '美元/瑞郎', 'US Dollar / Swiss Franc', '0.82400', '0.00017', 500),
  fx('USDCAD', '美元/加元', 'US Dollar / Canadian Dollar', '1.41450', '0.00018', 500),
  fx('AUDUSD', '澳元/美元', 'Australian Dollar / US Dollar', '0.69600', '0.00015', 500),
  fx('NZDUSD', '纽元/美元', 'New Zealand Dollar / US Dollar', '0.56620', '0.00018', 500),
  // 外汇交叉盘 300×
  fx('EURGBP', '欧元/英镑', 'Euro / British Pound', '0.84290', '0.00019', 300),
  fx('EURJPY', '欧元/日元', 'Euro / Japanese Yen', '177.587', '0.022', 300),
  fx('GBPJPY', '英镑/日元', 'British Pound / Japanese Yen', '210.671', '0.031', 300),
  fx('EURCHF', '欧元/瑞郎', 'Euro / Swiss Franc', '0.92670', '0.00022', 300),
  fx('EURAUD', '欧元/澳元', 'Euro / Australian Dollar', '1.61610', '0.00027', 300),
  fx('EURCAD', '欧元/加元', 'Euro / Canadian Dollar', '1.59060', '0.00029', 300),
  fx('AUDJPY', '澳元/日元', 'Australian Dollar / Japanese Yen', '109.886', '0.022', 300),
  fx('CADJPY', '加元/日元', 'Canadian Dollar / Japanese Yen', '111.639', '0.025', 300),
  fx('CHFJPY', '瑞郎/日元', 'Swiss Franc / Japanese Yen', '191.605', '0.030', 300),
  fx('AUDCAD', '澳元/加元', 'Australian Dollar / Canadian Dollar', '0.98420', '0.00028', 300),
  fx('AUDNZD', '澳元/纽元', 'Australian Dollar / New Zealand Dollar', '1.22940', '0.00032', 300),
  fx('GBPAUD', '英镑/澳元', 'British Pound / Australian Dollar', '1.91710', '0.00038', 300),
  fx('GBPCHF', '英镑/瑞郎', 'British Pound / Swiss Franc', '1.09920', '0.00031', 300),
  // 离岸人民币 100×
  fx('USDCNH', '美元/离岸人民币', 'US Dollar / Offshore Chinese Yuan', '6.68420', '0.00075', 100, true),
  // 贵金属 200×
  { code: 'XAUUSD', zh: '黄金', en: 'Gold', cat: 'metal', digits: 2, price: '4197.70', spread: '0.41', lev: 200, hot: true },
  { code: 'XAGUSD', zh: '白银', en: 'Silver', cat: 'metal', digits: 3, price: '57.575', spread: '0.036', lev: 200, hot: true },
  // 指数 100×
  { code: 'US30', zh: '道琼斯 30', en: 'Dow Jones 30', cat: 'index', digits: 1, price: '52323.6', spread: '2.3', lev: 100 },
  { code: 'US500', zh: '标普 500', en: 'S&P 500', cat: 'index', digits: 1, price: '7717.6', spread: '0.6', lev: 100 },
  { code: 'NAS100', zh: '纳指 100', en: 'Nasdaq 100', cat: 'index', digits: 1, price: '29516.9', spread: '1.2', lev: 100, hot: true },
  { code: 'US2000', zh: '罗素 2000', en: 'Russell 2000', cat: 'index', digits: 1, price: '2753.8', spread: '0.4', lev: 100 },
  { code: 'GER40', zh: '德国 40', en: 'Germany 40', cat: 'index', digits: 1, price: '25650.8', spread: '1.3', lev: 100 },
  { code: 'UK100', zh: '英国 100', en: 'UK 100', cat: 'index', digits: 1, price: '10887.0', spread: '1.2', lev: 100 },
  { code: 'FRA40', zh: '法国 40', en: 'France 40', cat: 'index', digits: 1, price: '7963.6', spread: '1.0', lev: 100 },
  { code: 'JPN225', zh: '日经 225', en: 'Japan 225', cat: 'index', digits: 0, price: '65324', spread: '11', lev: 100 },
  { code: 'HK50', zh: '恒生 50', en: 'Hong Kong 50', cat: 'index', digits: 1, price: '24186.8', spread: '5.5', lev: 100 },
  { code: 'AUS200', zh: '澳洲 200', en: 'Australia 200', cat: 'index', digits: 1, price: '8806.7', spread: '1.0', lev: 100 },
  // 能源 100×
  { code: 'XTIUSD', zh: '美国原油（WTI 西德克萨斯中质原油）', en: 'US Crude Oil (West Texas Intermediate)', cat: 'energy', digits: 2, price: '95.60', spread: '0.05', lev: 100, hot: true },
  { code: 'XBRUSD', zh: '布伦特原油', en: 'Brent Crude Oil', cat: 'energy', digits: 2, price: '105.79', spread: '0.05', lev: 100 },
  // 加密货币：BTC、ETH 125×，其他 75×
  { code: 'BTCUSD', zh: '比特币', en: 'Bitcoin', cat: 'crypto', digits: 1, price: '81567.5', spread: '13.1', lev: 125, hot: true, paused: true },
  { code: 'ETHUSD', zh: '以太坊', en: 'Ethereum', cat: 'crypto', digits: 2, price: '2439.45', spread: '0.96', lev: 125, hot: true },
  { code: 'SOLUSD', zh: 'Solana', en: 'Solana', cat: 'crypto', digits: 2, price: '104.37', spread: '0.06', lev: 75 },
  { code: 'XRPUSD', zh: '瑞波币', en: 'XRP', cat: 'crypto', digits: 4, price: '1.3139', spread: '0.0010', lev: 75 },
  { code: 'BNBUSD', zh: '币安币', en: 'BNB', cat: 'crypto', digits: 2, price: '724.69', spread: '0.49', lev: 75 },
  { code: 'DOGEUSD', zh: '狗狗币', en: 'Dogecoin', cat: 'crypto', digits: 5, price: '0.08057', spread: '0.00008', lev: 75 },
  { code: 'ADAUSD', zh: '艾达币', en: 'Cardano', cat: 'crypto', digits: 4, price: '0.2248', spread: '0.0003', lev: 75 },
  { code: 'LTCUSD', zh: '莱特币', en: 'Litecoin', cat: 'crypto', digits: 2, price: '59.98', spread: '0.06', lev: 75 },
  { code: 'DOTUSD', zh: '波卡', en: 'Polkadot', cat: 'crypto', digits: 3, price: '1.177', spread: '0.002', lev: 75 },
  { code: 'BCHUSD', zh: '比特币现金', en: 'Bitcoin Cash', cat: 'crypto', digits: 2, price: '277.20', spread: '0.30', lev: 75 },
  // 美股 100×（原型中模拟为休市，用于展示"交易时段外"）
  { code: 'AAPL', zh: '苹果', en: 'Apple Inc.', cat: 'stock', digits: 2, price: '344.92', spread: '0.08', lev: 100, closed: true },
  { code: 'MSFT', zh: '微软', en: 'Microsoft Corp.', cat: 'stock', digits: 2, price: '530.57', spread: '0.10', lev: 100, closed: true },
  { code: 'NVDA', zh: '英伟达', en: 'NVIDIA Corp.', cat: 'stock', digits: 2, price: '217.14', spread: '0.06', lev: 100, closed: true },
  { code: 'TSLA', zh: '特斯拉', en: 'Tesla Inc.', cat: 'stock', digits: 2, price: '358.92', spread: '0.10', lev: 100, closed: true },
  { code: 'AMZN', zh: '亚马逊', en: 'Amazon.com Inc.', cat: 'stock', digits: 2, price: '254.07', spread: '0.07', lev: 100, closed: true },
];

/** 报价币种 → USD 的折算率（模拟值；正式环境由汇率模块实时提供） */
const QUOTE_TO_USD: Record<string, string> = {
  USD: '1',
  JPY: '0.0063325',
  CHF: '1.2135922',
  CAD: '0.7069636',
  GBP: '1.3342',
  AUD: '0.696',
  NZD: '0.5662',
  CNH: '0.1496065',
  EUR: '1.125',
  HKD: '0.1274307',
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

/**
 * 维持保证金率（示意值）：取最大杠杆下初始保证金的一半，保证用满杠杆开仓时也留有缓冲；
 * 上限 0.5%。正式值以后台"交易参数"为准。
 */
function maintenanceRate(maxLev: number): string {
  const bp = Math.min(50, Math.floor(5000 / maxLev)); // 万分之几
  return (bp / 10000).toFixed(4);
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
    maintenanceMarginRate: maintenanceRate(s.lev),
    hot: !!s.hot,
    openPaused: !!s.paused,
    tradingOpen: !s.closed,
  };
  return { info, price: s.price, spread: s.spread, quoteToUsd: QUOTE_TO_USD[quote] ?? '1' };
});
