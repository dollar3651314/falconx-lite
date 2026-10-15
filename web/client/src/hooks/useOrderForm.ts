/**
 * 下单表单的状态和逻辑，桌面下单面板（OrderPanel）和手机下单抽屉（OrderSheet）共用，计算口径只有一份。
 * 市价 / 限价；买入按 ask、卖出按 bid；数量（手，最小 0.01）、杠杆（不超过品种上限）；
 * 两种订单都可以带止盈止损；提交前二次确认；被拒时显示具体原因。
 */
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../api/errors';
import { placeOrder } from '../api/trading';
import type { Side, SymbolInfo } from '../api/types';
import { useAccount, useToast } from '../app/contexts';
import { add, cmp, dec, isDecimalString, mul, sub, toFixed, toPlain, ZERO, type Dec } from '../lib/decimal';
import { formatLots, formatPrice } from '../lib/format';
import { estimateOrder, execPrice, pnlAt } from '../lib/trading';
import { hasErrors, sanitizeLots, validateOrder, type FieldErrors, type OrderForm } from '../lib/validators';
import { useQuote } from './useQuotes';

export const LOT_CHIPS = ['0.01', '0.10', '0.50', '1.00', '2.00'];

/** 杠杆快捷档位：不超过品种上限的最高三档常用值 + 上限本身 */
export function leverageChips(max: number): number[] {
  const base = [10, 20, 50, 100, 200, 500].filter((x) => x < max);
  return [...base.slice(-3), max];
}

export function useOrderForm(symbol: SymbolInfo, initialSide: Side, onDone?: () => void) {
  const { t } = useTranslation();
  const toast = useToast();
  const quote = useQuote(symbol.code);
  const { metrics } = useAccount();
  const [form, setForm] = useState<OrderForm>({
    type: 'market',
    side: initialSide,
    lots: '0.10',
    leverage: String(Math.min(50, symbol.maxLeverage)),
    limitPrice: '',
    tpOn: false,
    takeProfit: '',
    slOn: false,
    stopLoss: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState<string | null>(null);
  const clientOrderId = useRef(crypto.randomUUID?.() ?? String(Date.now()));

  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setReject(null);
  };

  const marketPrice = quote ? execPrice(form.side, quote) : null;
  const refPrice = form.type === 'market' ? marketPrice : form.limitPrice;
  const errors: FieldErrors<keyof OrderForm> = useMemo(() => validateOrder(form, symbol, marketPrice), [form, symbol, marketPrice]);
  const shown = submitted ? errors : {};

  const est = useMemo(() => {
    if (!quote || !refPrice || !isDecimalString(refPrice) || !isDecimalString(form.lots) || !/^\d+$/.test(form.leverage)) return null;
    const lev = Number(form.leverage);
    if (lev < 1) return null;
    return estimateOrder({ symbol, price: dec(refPrice), lots: dec(form.lots), leverage: lev, side: form.side, quoteToUsd: quote.quoteToUsd });
  }, [quote, refPrice, form.lots, form.leverage, form.side, symbol]);

  /** 按当前手数，价格到 v 时的预计盈亏 */
  const expected = (v: string): Dec | null => {
    if (!est || !quote || !isDecimalString(v) || !isDecimalString(form.lots)) return null;
    return pnlAt(form.side, est.price, dec(v), dec(form.lots), symbol.contractSize, quote.quoteToUsd);
  };

  const setLots = (raw: string) => set('lots', sanitizeLots(form.lots, raw));

  const stepLots = (dir: 1 | -1) => {
    const cur = isDecimalString(form.lots) ? dec(form.lots) : dec(symbol.minLots);
    let next = dir > 0 ? add(cur, dec(symbol.lotStep)) : sub(cur, dec(symbol.lotStep));
    if (cmp(next, dec(symbol.minLots)) < 0) next = dec(symbol.minLots);
    if (cmp(next, dec(symbol.maxLots)) > 0) next = dec(symbol.maxLots);
    set('lots', formatLots(next).replace(/,/g, ''));
  };

  const setType = (v: OrderForm['type']) => {
    set('type', v);
    if (v === 'limit' && !form.limitPrice && marketPrice) set('limitPrice', marketPrice);
  };

  /** 打开止盈或止损时，默认填在参考价 ±1% 处，方向符合止盈止损规则 */
  const toggleTpSl = (k: 'takeProfit' | 'stopLoss', on: boolean) => {
    set(k === 'takeProfit' ? 'tpOn' : 'slOn', on);
    if (on && !form[k] && refPrice && isDecimalString(refPrice)) {
      const above = (k === 'takeProfit') === (form.side === 'buy');
      set(k, toFixed(mul(dec(refPrice), dec(above ? '1.01' : '0.99')), symbol.digits));
    }
  };

  const submit = () => {
    setSubmitted(true);
    setReject(null);
    if (hasErrors(errors)) return false;
    setConfirm(true);
    return true;
  };

  const place = async () => {
    setBusy(true);
    try {
      const r = await placeOrder({
        symbol: symbol.code,
        type: form.type,
        side: form.side,
        lots: toPlain(dec(form.lots), 2),
        leverage: Number(form.leverage),
        limitPrice: form.type === 'limit' ? form.limitPrice.trim() : undefined,
        takeProfit: form.tpOn ? form.takeProfit.trim() : undefined,
        stopLoss: form.slOn ? form.stopLoss.trim() : undefined,
        clientOrderId: clientOrderId.current,
      });
      clientOrderId.current = crypto.randomUUID?.() ?? String(Date.now());
      setConfirm(false);
      setSubmitted(false);
      // 市价成交的提示由推送（站内信）展示；挂单在这里提示
      if (r.kind === 'pending') toast.show({ tone: 'success', title: t('order.pendingPlaced'), body: `${symbol.code} ${t(`side.${form.side}`)} ${formatLots(form.lots)} @ ${formatPrice(form.limitPrice, symbol.digits)}` });
      onDone?.();
    } catch (e) {
      setConfirm(false);
      setReject(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const notice = !symbol.tradingOpen ? t('order.noticeClosed') : symbol.openPaused ? t('order.noticePaused') : null;

  return {
    form,
    set,
    setLots,
    stepLots,
    setType,
    toggleTpSl,
    quote,
    marketPrice,
    refPrice,
    errors,
    shown,
    submitted,
    est,
    expected,
    available: metrics?.available ?? ZERO,
    notice,
    reject,
    confirm,
    setConfirm,
    busy,
    submit,
    place,
    hasErrors: hasErrors(errors),
  };
}

export type OrderFormState = ReturnType<typeof useOrderForm>;

/** 止盈止损的一行摘要："止盈 4,180.00 · 止损 未设置" */
export function tpSlSummary(f: OrderFormState, symbol: SymbolInfo, t: (k: string) => string): string {
  const one = (on: boolean, v: string) => (on && isDecimalString(v) ? formatPrice(v, symbol.digits) : t('order.notSet'));
  if (!f.form.tpOn && !f.form.slOn) return t('order.notSet');
  return `${t('positions.tpShort')} ${one(f.form.tpOn, f.form.takeProfit)} · ${t('positions.slShort')} ${one(f.form.slOn, f.form.stopLoss)}`;
}
