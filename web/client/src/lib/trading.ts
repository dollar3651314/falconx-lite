/**
 * 交易计算（逐仓）。与后端规则保持同一口径，前端只用于"预估"展示：
 * - 买入按卖方报价 ask，卖出按买方报价 bid（加点由后端在报价里一次性加好，前端不再加）；
 * - 名义价值 = 价格 × 手数 × 合约大小 × 报价币种折算 USD 的汇率；
 * - 保证金 = 名义价值 ÷ 杠杆；手续费 = 名义价值 × 费率（开仓收、平仓不收）；
 * - 强平价：亏损达到（保证金 − 维持保证金）时的价格，维持保证金 = 名义价值 × 维持保证金率。
 */
import { add, cmp, dec, div, mul, sub, toFixed, ZERO, type Dec } from './decimal';
import type { Position, Quote, Side, SymbolInfo } from '../api/types';

export interface OrderEstimate {
  /** 成交参考价 */
  price: Dec;
  notional: Dec;
  margin: Dec;
  fee: Dec;
  liquidationPrice: Dec;
}

/** 下单方向对应的成交参考价：买用 ask，卖用 bid */
export function execPrice(side: Side, quote: Pick<Quote, 'bid' | 'ask'>): string {
  return side === 'buy' ? quote.ask : quote.bid;
}

/** 平仓方向对应的价格：多单按 bid 平，空单按 ask 平 */
export function closePrice(side: Side, quote: Pick<Quote, 'bid' | 'ask'>): string {
  return side === 'buy' ? quote.bid : quote.ask;
}

export function notionalUsd(price: Dec, lots: Dec, contractSize: string, quoteToUsd: string): Dec {
  return mul(mul(mul(price, lots), dec(contractSize)), dec(quoteToUsd));
}

export function liquidationPrice(args: {
  side: Side;
  entry: Dec;
  lots: Dec;
  contractSize: string;
  quoteToUsd: string;
  margin: Dec;
  maintenanceMarginRate: string;
}): Dec {
  const notional = notionalUsd(args.entry, args.lots, args.contractSize, args.quoteToUsd);
  const buffer = sub(args.margin, mul(notional, dec(args.maintenanceMarginRate)));
  const perPrice = mul(mul(args.lots, dec(args.contractSize)), dec(args.quoteToUsd));
  if (perPrice === ZERO) return ZERO;
  const distance = div(buffer, perPrice);
  if (args.side === 'buy') {
    const p = sub(args.entry, distance);
    return cmp(p, ZERO) < 0 ? ZERO : p;
  }
  return add(args.entry, distance);
}

export function estimateOrder(args: {
  symbol: SymbolInfo;
  price: Dec;
  lots: Dec;
  leverage: number;
  side: Side;
  quoteToUsd: string;
}): OrderEstimate {
  const { symbol, price, lots, leverage, side, quoteToUsd } = args;
  const notional = notionalUsd(price, lots, symbol.contractSize, quoteToUsd);
  const margin = leverage > 0 ? div(notional, dec(leverage)) : ZERO;
  const fee = mul(notional, dec(symbol.feeRate));
  const liq = liquidationPrice({
    side,
    entry: price,
    lots,
    contractSize: symbol.contractSize,
    quoteToUsd,
    margin,
    maintenanceMarginRate: symbol.maintenanceMarginRate,
  });
  return { price, notional, margin, fee, liquidationPrice: liq };
}

/** 平仓到某个价格时的盈亏（USDT） */
export function pnlAt(side: Side, entry: Dec, exit: Dec, lots: Dec, contractSize: string, quoteToUsd: string): Dec {
  const diff = side === 'buy' ? sub(exit, entry) : sub(entry, exit);
  return mul(mul(mul(diff, lots), dec(contractSize)), dec(quoteToUsd));
}

/** 持仓的浮动盈亏 */
export function positionPnl(p: Position, symbol: SymbolInfo, quote: Quote): Dec {
  return pnlAt(p.side, dec(p.openPrice), dec(closePrice(p.side, quote)), dec(p.lots), symbol.contractSize, quote.quoteToUsd);
}

/** 追加保证金后的新强平价（按开仓时的维持保证金率重算，修复 T-11） */
export function liquidationAfterAddMargin(p: Position, symbol: SymbolInfo, quoteToUsd: string, extra: Dec): string {
  return toFixed(
    liquidationPrice({
      side: p.side,
      entry: dec(p.openPrice),
      lots: dec(p.lots),
      contractSize: symbol.contractSize,
      quoteToUsd,
      margin: add(dec(p.margin), extra),
      maintenanceMarginRate: p.maintenanceMarginRate,
    }),
    symbol.digits,
  );
}

/** 涨跌百分比（入参为今日开盘价和当前 bid），返回百分数 */
export function changePercent(open: string, last: string): Dec {
  const o = dec(open);
  if (o === ZERO) return ZERO;
  return mul(div(sub(dec(last), o), o), dec(100));
}

/** 保证金水平 = 净值 ÷ 已用保证金 × 100%；没有持仓时返回 null */
export function marginLevel(equity: Dec, usedMargin: Dec): Dec | null {
  if (usedMargin === ZERO) return null;
  return mul(div(equity, usedMargin), dec(100));
}

/** 保证金水平分级：≥200% 安全，100%~200% 注意，<100% 危险（示意阈值，以后台配置为准） */
export function marginLevelTone(level: Dec | null): 'safe' | 'warn' | 'danger' {
  if (level === null) return 'safe';
  if (cmp(level, dec(200)) >= 0) return 'safe';
  if (cmp(level, dec(100)) >= 0) return 'warn';
  return 'danger';
}
