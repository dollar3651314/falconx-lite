/**
 * 模拟交易引擎：下单、挂单、持仓、止盈止损、强平（逐仓）。
 * 计算规则与 lib/trading.ts 同一口径，金额全部用定点小数。
 */
import { ApiError } from '../api/errors';
import type { Account, HistoryItem, HistoryKind, Page, PendingOrder, PlaceOrderRequest, PlaceOrderResult, Position, Quote, Side } from '../api/types';
import { add, cmp, dec, div, mul, neg, sub, toFixed, ZERO, type Dec } from '../lib/decimal';
import { validateCloseLots } from '../lib/validators';
import { formatAmount, formatLots, formatPrice } from '../lib/format';
import { availableFunds, closePrice, estimateOrder, execPrice, liquidationAfterAddMargin, notionalUsd, pnlAt, positionPnl } from '../lib/trading';
import { emit } from './bus';
import { db } from './db';
import { mutate, respond } from './delay';
import { nextId, snowflakeId } from './ids';
import { addTickHook, forcePrice, quote, symbolInfo } from './market';
import { getProtoState } from './scenario';
import { pushNotification } from './user';

/** 单用户持仓上限（USD 名义价值，T4）；原型取 3,000,000 */
export const POSITION_LIMIT_USD = '3000000';

const EMPTY_ACCOUNT: Account = { currency: 'USDT', balance: '0.00', withdrawFrozen: '0.00', orderFrozen: '0.00' };

export function getAccount(): Promise<Account> {
  return respond(() => ({ ...db.account }), () => ({ ...EMPTY_ACCOUNT }));
}

export function listPositions(): Promise<Position[]> {
  return respond(() => db.positions.map((p) => ({ ...p })), () => []);
}

export function listOrders(): Promise<PendingOrder[]> {
  return respond(() => db.orders.map((o) => ({ ...o })), () => []);
}

export function listHistory(page: number, pageSize: number): Promise<Page<HistoryItem>> {
  return respond(
    () => {
      const sorted = [...db.history].sort((a, b) => b.closedAt.localeCompare(a.closedAt));
      return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize };
    },
    () => ({ items: [], total: 0, page, pageSize }),
  );
}

// ---------- 资金计算 ----------
/** 可用 = 余额 − 挂单冻结 − 已用保证金 + 浮动亏损（浮动盈利不计入，和后端同一口径，DF-02） */
export function availableNow(): Dec {
  const positions = db.positions.map((p) => {
    const info = symbolInfo(p.symbol);
    const q = quote(p.symbol);
    return { margin: dec(p.margin), pnl: (info && q ? positionPnl(p, info, q) : null) ?? ZERO };
  });
  return availableFunds(dec(db.account.balance), dec(db.account.orderFrozen), positions);
}

function totalNotionalUsd(): Dec {
  let total = ZERO;
  for (const p of db.positions) {
    const info = symbolInfo(p.symbol)!;
    const q = quote(p.symbol)!;
    total = add(total, notionalUsd(dec(p.openPrice), dec(p.lots), info.contractSize, q.quoteToUsd));
  }
  return total;
}

function addLedger(type: 'pnl' | 'fee', amount: Dec, ref: string): void {
  db.ledger.unshift({ id: nextId('L'), type, amount: toFixed(amount, 2), ref, time: new Date().toISOString() });
}

const sideText = (s: Side): [string, string] => (s === 'buy' ? ['买入', 'buy'] : ['卖出', 'sell']);

// ---------- 下单 ----------
export function placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
  return mutate(() => {
    const info = symbolInfo(req.symbol);
    const q = quote(req.symbol);
    if (!info || !q) throw new ApiError('notFound');
    const forced = getProtoState().forceReject;
    if (forced !== 'none') throw new ApiError(forced);
    if (!info.tradingOpen) throw new ApiError('tradingClosed');
    if (info.openPaused) throw new ApiError('symbolPaused');
    if (req.leverage > info.maxLeverage) throw new ApiError('leverageExceeded');

    const price = req.type === 'market' ? dec(execPrice(req.side, q)) : dec(req.limitPrice!);
    const est = estimateOrder({ symbol: info, price, lots: dec(req.lots), leverage: req.leverage, side: req.side, quoteToUsd: q.quoteToUsd });
    if (cmp(add(totalNotionalUsd(), est.notional), dec(POSITION_LIMIT_USD)) > 0) throw new ApiError('positionLimit');
    if (cmp(add(est.margin, est.fee), availableNow()) > 0) throw new ApiError('insufficientBalance');

    const margin = toFixed(est.margin, 2);
    if (req.type === 'limit') {
      const order: PendingOrder = {
        id: snowflakeId(),
        symbol: req.symbol,
        side: req.side,
        lots: req.lots,
        leverage: req.leverage,
        limitPrice: toFixed(price, info.digits),
        takeProfit: req.takeProfit,
        stopLoss: req.stopLoss,
        frozenMargin: margin,
        createdAt: new Date().toISOString(),
      };
      db.orders.unshift(order);
      db.account.orderFrozen = toFixed(add(dec(db.account.orderFrozen), est.margin), 2);
      emit({ type: 'orders' });
      emit({ type: 'account' });
      return { kind: 'pending', id: order.id };
    }
    const pos = openPosition(req.symbol, req.side, req.lots, req.leverage, price, req.takeProfit, req.stopLoss);
    return { kind: 'filled', id: pos.id, price: pos.openPrice };
  });
}

function openPosition(symbol: string, side: Side, lots: string, leverage: number, price: Dec, tp?: string, sl?: string): Position {
  const info = symbolInfo(symbol)!;
  const q = quote(symbol)!;
  const est = estimateOrder({ symbol: info, price, lots: dec(lots), leverage, side, quoteToUsd: q.quoteToUsd });
  const pos: Position = {
    id: snowflakeId(),
    symbol,
    side,
    lots,
    leverage,
    openPrice: toFixed(price, info.digits),
    margin: toFixed(est.margin, 2),
    maintenanceMarginRate: info.maintenanceMarginRate,
    liquidationPrice: toFixed(est.liquidationPrice, info.digits),
    takeProfit: tp,
    stopLoss: sl,
    openedAt: new Date().toISOString(),
  };
  db.positions.unshift(pos);
  // 手续费开仓时收取
  db.account.balance = toFixed(sub(dec(db.account.balance), est.fee), 2);
  addLedger('fee', neg(est.fee), symbol);
  const [zh, en] = sideText(side);
  pushNotification(
    'fill',
    ['订单已成交', 'Order filled'],
    [`${symbol} ${zh} ${formatLots(lots)} 手已按 ${formatPrice(pos.openPrice, info.digits)} 成交。`, `${symbol} ${en} ${formatLots(lots)} lots filled at ${formatPrice(pos.openPrice, info.digits)}.`],
  );
  emit({ type: 'trade', kind: 'fill', symbol, price: pos.openPrice });
  emit({ type: 'positions' });
  emit({ type: 'account' });
  return pos;
}

function closeInternal(p: Position, exit: Dec, kind: HistoryKind): Dec {
  const info = symbolInfo(p.symbol)!;
  const q = quote(p.symbol)!;
  let pnl = pnlAt(p.side, dec(p.openPrice), exit, dec(p.lots), info.contractSize, q.quoteToUsd);
  // 逐仓：最多亏掉该持仓的保证金，余额不会被扣成负数（AC-14）
  const maxLoss = neg(dec(p.margin));
  if (cmp(pnl, maxLoss) < 0) pnl = maxLoss;
  db.positions = db.positions.filter((x) => x.id !== p.id);
  db.account.balance = toFixed(add(dec(db.account.balance), pnl), 2);
  addLedger('pnl', pnl, p.symbol);
  db.history.unshift({
    id: `P${p.id}`,
    symbol: p.symbol,
    side: p.side,
    lots: p.lots,
    openPrice: p.openPrice,
    closePrice: toFixed(exit, info.digits),
    pnl: toFixed(pnl, 2),
    fee: '0.00',
    kind,
    closedAt: new Date().toISOString(),
  });
  emit({ type: 'positions' });
  emit({ type: 'account' });
  return pnl;
}

/**
 * 平仓；lots 不传或等于持仓手数 = 全部平仓。
 * 部分平仓（体验优化 1021 第 6 条，方案 UX-6 的建议规则，后端还没做）：平掉的部分按比例拆出一笔已平仓记录
 * （保证金按手数比例释放、盈亏只算平掉的部分、亏损上限是这部分的保证金），剩下的持仓开仓价、强平价、止盈止损都不变。
 */
export function closePosition(id: string, lots?: string): Promise<{ pnl: string; price: string }> {
  return mutate(() => {
    const p = db.positions.find((x) => x.id === id);
    if (!p) throw new ApiError('notFound');
    const info = symbolInfo(p.symbol)!;
    if (!info.tradingOpen) throw new ApiError('tradingClosed');
    const exit = dec(closePrice(p.side, quote(p.symbol)!));
    if (lots !== undefined && cmp(dec(lots), dec(p.lots)) !== 0) {
      const errs = validateCloseLots(lots, p.lots, info);
      if (errs.length) throw new ApiError('validationFailed', { lots: errs });
      const total = dec(p.lots);
      const part = dec(lots);
      const partMargin = div(mul(dec(p.margin), part), total);
      // 拆出来的那部分有自己的编号（后端建议同样拆一行已平仓持仓，方案第 6 节），走和全部平仓同一套记账：盈亏进余额、写一条历史
      const closedPart: Position = { ...p, id: snowflakeId(), lots: toFixed(part, 2), margin: toFixed(partMargin, 2) };
      p.lots = toFixed(sub(total, part), 2);
      p.margin = toFixed(sub(dec(p.margin), dec(closedPart.margin)), 2);
      const pnl = closeInternal(closedPart, exit, 'closed');
      return { pnl: toFixed(pnl, 2), price: toFixed(exit, info.digits) };
    }
    const pnl = closeInternal(p, exit, 'closed');
    return { pnl: toFixed(pnl, 2), price: toFixed(exit, info.digits) };
  });
}

export function updateTpSl(id: string, tp?: string, sl?: string): Promise<Position> {
  return mutate(() => {
    const p = db.positions.find((x) => x.id === id);
    if (!p) throw new ApiError('notFound');
    p.takeProfit = tp;
    p.stopLoss = sl;
    emit({ type: 'positions' });
    return { ...p };
  });
}

export function addMargin(id: string, amount: string): Promise<Position> {
  return mutate(() => {
    const p = db.positions.find((x) => x.id === id);
    if (!p) throw new ApiError('notFound');
    const a = dec(amount);
    if (cmp(a, availableNow()) > 0) throw new ApiError('marginInsufficient');
    const info = symbolInfo(p.symbol)!;
    p.liquidationPrice = liquidationAfterAddMargin(p, info, quote(p.symbol)!.quoteToUsd, a);
    p.margin = toFixed(add(dec(p.margin), a), 2);
    emit({ type: 'positions' });
    emit({ type: 'account' });
    return { ...p };
  });
}

export function modifyOrder(id: string, patch: { limitPrice: string; lots: string; takeProfit?: string; stopLoss?: string }): Promise<PendingOrder> {
  return mutate(() => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new ApiError('notFound');
    const info = symbolInfo(o.symbol)!;
    const q = quote(o.symbol)!;
    const est = estimateOrder({ symbol: info, price: dec(patch.limitPrice), lots: dec(patch.lots), leverage: o.leverage, side: o.side, quoteToUsd: q.quoteToUsd });
    const delta = sub(est.margin, dec(o.frozenMargin));
    if (cmp(delta, availableNow()) > 0) throw new ApiError('insufficientBalance');
    db.account.orderFrozen = toFixed(add(dec(db.account.orderFrozen), delta), 2);
    Object.assign(o, { limitPrice: patch.limitPrice, lots: patch.lots, takeProfit: patch.takeProfit, stopLoss: patch.stopLoss, frozenMargin: toFixed(est.margin, 2) });
    emit({ type: 'orders' });
    emit({ type: 'account' });
    return { ...o };
  });
}

export function cancelOrder(id: string): Promise<void> {
  return mutate(() => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new ApiError('notFound');
    db.orders = db.orders.filter((x) => x.id !== id);
    db.account.orderFrozen = toFixed(sub(dec(db.account.orderFrozen), dec(o.frozenMargin)), 2);
    db.history.unshift({ id: `O${o.id}`, symbol: o.symbol, side: o.side, lots: o.lots, openPrice: o.limitPrice, fee: '0.00', kind: 'cancelled', closedAt: new Date().toISOString() });
    emit({ type: 'orders' });
    emit({ type: 'account' });
  });
}

// ---------- 行情驱动：挂单成交、止盈止损、强平 ----------
function onTick(quotes: Quote[]): void {
  for (const q of quotes) {
    // 挂单：买限价在 ask ≤ 限价时成交，卖限价在 bid ≥ 限价时成交
    for (const o of [...db.orders]) {
      if (o.symbol !== q.symbol) continue;
      const hit = o.side === 'buy' ? cmp(dec(q.ask), dec(o.limitPrice)) <= 0 : cmp(dec(q.bid), dec(o.limitPrice)) >= 0;
      if (!hit) continue;
      db.orders = db.orders.filter((x) => x.id !== o.id);
      db.account.orderFrozen = toFixed(sub(dec(db.account.orderFrozen), dec(o.frozenMargin)), 2);
      emit({ type: 'orders' });
      openPosition(o.symbol, o.side, o.lots, o.leverage, dec(o.limitPrice), o.takeProfit, o.stopLoss);
    }
    for (const p of [...db.positions]) {
      if (p.symbol !== q.symbol) continue;
      const info = symbolInfo(p.symbol)!;
      const px = dec(closePrice(p.side, q));
      const long = p.side === 'buy';
      const liq = dec(p.liquidationPrice);
      const [zh, en] = sideText(p.side);
      const lotsTxt = formatLots(p.lots);
      if (long ? cmp(px, liq) <= 0 : cmp(px, liq) >= 0) {
        const pnl = closeInternal(p, liq, 'liquidated');
        pushNotification(
          'liquidation',
          ['持仓被强平', 'Position liquidated'],
          [`${p.symbol} ${zh} ${lotsTxt} 手在 ${formatPrice(liq, info.digits)} 被强制平仓，盈亏 ${formatAmount(pnl, { sign: true })} USDT。`, `${p.symbol} ${en} ${lotsTxt} lots was liquidated at ${formatPrice(liq, info.digits)}, P/L ${formatAmount(pnl, { sign: true })} USDT.`],
        );
        emit({ type: 'trade', kind: 'liquidation', symbol: p.symbol, pnl: toFixed(pnl, 2) });
        continue;
      }
      const tpHit = p.takeProfit && (long ? cmp(px, dec(p.takeProfit)) >= 0 : cmp(px, dec(p.takeProfit)) <= 0);
      const slHit = p.stopLoss && (long ? cmp(px, dec(p.stopLoss)) <= 0 : cmp(px, dec(p.stopLoss)) >= 0);
      if (tpHit || slHit) {
        const kind = tpHit ? 'tp' : 'sl';
        const pnl = closeInternal(p, px, kind);
        const label: [string, string] = kind === 'tp' ? ['止盈', 'take profit'] : ['止损', 'stop loss'];
        pushNotification(
          'tpsl',
          [`${label[0]}已触发`, kind === 'tp' ? 'Take profit triggered' : 'Stop loss triggered'],
          [`${p.symbol} ${zh} ${lotsTxt} 手在 ${formatPrice(px, info.digits)} ${label[0]}平仓，盈亏 ${formatAmount(pnl, { sign: true })} USDT。`, `${p.symbol} ${en} ${lotsTxt} lots closed by ${label[1]} at ${formatPrice(px, info.digits)}, P/L ${formatAmount(pnl, { sign: true })} USDT.`],
        );
        emit({ type: 'trade', kind, symbol: p.symbol, pnl: toFixed(pnl, 2) });
      }
    }
  }
}

let hooked = false;
export function ensureEngine(): void {
  if (hooked) return;
  hooked = true;
  addTickHook(onTick);
}

/** 原型：把价格拨到触发位，演示止盈 / 止损 / 强平。返回是否找到可演示的持仓 */
export function protoTrigger(kind: 'tp' | 'sl' | 'liquidation'): boolean {
  ensureEngine();
  const p =
    kind === 'liquidation'
      ? db.positions.find((x) => symbolInfo(x.symbol)?.tradingOpen)
      : db.positions.find((x) => symbolInfo(x.symbol)?.tradingOpen && (kind === 'tp' ? x.takeProfit : x.stopLoss));
  if (!p) return false;
  const info = symbolInfo(p.symbol)!;
  const q = quote(p.symbol)!;
  const spread = sub(dec(q.ask), dec(q.bid));
  const target = kind === 'liquidation' ? dec(p.liquidationPrice) : dec(kind === 'tp' ? p.takeProfit! : p.stopLoss!);
  // 多单按 bid 判断；空单按 ask 判断，所以要把 bid 拨到 目标 − 点差
  const overshoot = mul(dec(info.digits === 0 ? '1' : `0.${'0'.repeat(info.digits - 1)}1`), dec(2));
  const beyond = (p.side === 'buy') === (kind !== 'tp') ? sub(target, overshoot) : add(target, overshoot);
  const bid = p.side === 'buy' ? beyond : sub(beyond, spread);
  forcePrice(p.symbol, toFixed(bid, info.digits));
  return true;
}
