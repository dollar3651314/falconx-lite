/**
 * 持仓和挂单的操作弹窗：平仓、修改止盈止损、追加保证金、改单、撤单。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../api/errors';
import { addMargin, cancelOrder, closePosition, modifyOrder, updateTpSl } from '../api/trading';
import type { PendingOrder, Position, SymbolInfo } from '../api/types';
import { useAccount, useToast } from '../app/contexts';
import { useQuote } from '../hooks/useQuotes';
import { cmp, dec, isDecimalString, ZERO } from '../lib/decimal';
import { formatAmount, formatLots, formatPrice } from '../lib/format';
import { closePrice, liquidationAfterAddMargin, positionPnl } from '../lib/trading';
import { hasErrors, validateOrder, type FieldErrors } from '../lib/validators';
import { Switch, TextField } from './Form';
import { ConfirmDialog, Modal } from './Modal';

function useAction() {
  const toast = useToast();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, okTitle?: string, onOk?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (okTitle) toast.show({ tone: 'success', title: okTitle });
      onOk?.();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function ErrorBox({ text }: { text: string | null }) {
  return text ? (
    <div className="notice error" role="alert">
      {text}
    </div>
  ) : null;
}

export function ClosePositionDialog({ position, symbol, onClose }: { position: Position; symbol: SymbolInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuote(position.symbol);
  const a = useAction();
  const pnl = q ? positionPnl(position, symbol, q) : null;
  return (
    <ConfirmDialog
      open
      title={t('positions.closeTitle')}
      confirmText={t('positions.closeConfirm')}
      tone="primary"
      busy={a.busy}
      onClose={onClose}
      onConfirm={() =>
        a.run(
          () => closePosition(position.id),
          t('positions.closed'),
          onClose,
        )
      }
    >
      <dl className="kv-list">
        <div>
          <dt>{t('order.symbol')}</dt>
          <dd>
            <b className="num">{position.symbol}</b> <span className={position.side === 'buy' ? 'up' : 'down'}>{t(`side.${position.side}`)}</span>
          </dd>
        </div>
        <div>
          <dt>{t('positions.lots')}</dt>
          <dd className="num">{formatLots(position.lots)}</dd>
        </div>
        <div>
          <dt>{t('positions.closePrice')}</dt>
          <dd className="num">{q ? formatPrice(closePrice(position.side, q), symbol.digits) : '—'}</dd>
        </div>
        <div>
          <dt>{t('positions.estPnl')}</dt>
          <dd className={`num ${pnl && cmp(pnl, ZERO) < 0 ? 'down' : 'up'}`}>{pnl !== null ? `${formatAmount(pnl, { sign: true })} USDT` : '—'}</dd>
        </div>
      </dl>
      <p className="muted small">{t('positions.closeNote')}</p>
      <ErrorBox text={a.error} />
    </ConfirmDialog>
  );
}

export function TpSlDialog({ position, symbol, onClose }: { position: Position; symbol: SymbolInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuote(position.symbol);
  const a = useAction();
  const [tpOn, setTpOn] = useState(!!position.takeProfit);
  const [slOn, setSlOn] = useState(!!position.stopLoss);
  const [tp, setTp] = useState(position.takeProfit ?? '');
  const [sl, setSl] = useState(position.stopLoss ?? '');
  const [submitted, setSubmitted] = useState(false);
  // 止盈止损的基准是当前平仓价
  const ref = q ? closePrice(position.side, q) : position.openPrice;
  const errs = validateOrder(
    { type: 'market', side: position.side, lots: position.lots, leverage: String(position.leverage), limitPrice: '', tpOn, takeProfit: tp, slOn, stopLoss: sl },
    { ...symbol, maxLeverage: Math.max(symbol.maxLeverage, position.leverage) },
    ref,
  );
  const shown: FieldErrors = submitted ? errs : {};
  const submit = () => {
    setSubmitted(true);
    if (hasErrors(errs)) return;
    void a.run(() => updateTpSl(position.id, tpOn ? tp.trim() : undefined, slOn ? sl.trim() : undefined), t('positions.tpslSaved'), onClose);
  };
  return (
    <Modal
      open
      title={t('positions.tpslTitle')}
      subtitle={`${position.symbol} · ${t(`side.${position.side}`)} ${formatLots(position.lots)}`}
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={submit} disabled={a.busy}>
          {a.busy ? t('common.submitting') : t('common.save')}
        </button>
      }
    >
      <p className="muted small">
        {t('positions.currentClosePrice')} <b className="num">{formatPrice(ref, symbol.digits)}</b>
      </p>
      {(
        [
          ['takeProfit', tpOn, setTpOn, tp, setTp],
          ['stopLoss', slOn, setSlOn, sl, setSl],
        ] as const
      ).map(([k, on, setOn, v, setV]) => (
        <TextField
          key={k}
          label={t(`order.${k}`)}
          labelExtra={<Switch checked={on} onChange={setOn} label={t(`order.${k}Toggle`)} />}
          value={on ? v : ''}
          placeholder={on ? '' : t('order.notSet')}
          disabled={!on}
          onChange={setV}
          inputMode="decimal"
          mono
          errors={shown[k]}
        />
      ))}
      <ErrorBox text={a.error} />
    </Modal>
  );
}

export function AddMarginDialog({ position, symbol, onClose }: { position: Position; symbol: SymbolInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuote(position.symbol);
  const { metrics } = useAccount();
  const a = useAction();
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const available = metrics?.available ?? ZERO;
  const errs: string[] = [];
  if (!amount.trim()) errs.push('validation.required');
  else if (!isDecimalString(amount) || cmp(dec(amount), ZERO) <= 0) errs.push('validation.positiveNumber');
  else {
    if ((amount.split('.')[1]?.length ?? 0) > 2) errs.push('validation.amountDigits');
    if (cmp(dec(amount), available) > 0) errs.push('validation.marginExceedsAvailable');
  }
  const newLiq = errs.length === 0 && q ? liquidationAfterAddMargin(position, symbol, q.quoteToUsd, dec(amount)) : null;
  const submit = () => {
    setSubmitted(true);
    if (errs.length) return;
    void a.run(() => addMargin(position.id, amount.trim()), t('positions.marginAdded'), onClose);
  };
  return (
    <Modal
      open
      title={t('positions.addMarginTitle')}
      subtitle={`${position.symbol} · ${t(`side.${position.side}`)} ${formatLots(position.lots)}`}
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={submit} disabled={a.busy}>
          {a.busy ? t('common.submitting') : t('positions.addMarginConfirm')}
        </button>
      }
    >
      <TextField
        label={t('positions.addAmount')}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        mono
        suffix="USDT"
        errors={submitted ? errs : undefined}
        hint={`${t('account.available')} ${formatAmount(available)} USDT`}
      />
      <dl className="kv-list">
        <div>
          <dt>{t('positions.margin')}</dt>
          <dd className="num">{formatAmount(position.margin)}</dd>
        </div>
        <div>
          <dt>{t('positions.liqNow')}</dt>
          <dd className="num risk">{formatPrice(position.liquidationPrice, symbol.digits)}</dd>
        </div>
        <div>
          <dt>{t('positions.liqAfter')}</dt>
          <dd className="num risk">{newLiq ? formatPrice(newLiq, symbol.digits) : '—'}</dd>
        </div>
      </dl>
      <p className="muted small">{t('positions.addMarginNote')}</p>
      <ErrorBox text={a.error} />
    </Modal>
  );
}

export function ModifyOrderDialog({ order, symbol, onClose }: { order: PendingOrder; symbol: SymbolInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [price, setPrice] = useState(order.limitPrice);
  const [lots, setLots] = useState(order.lots);
  const [tpOn, setTpOn] = useState(!!order.takeProfit);
  const [slOn, setSlOn] = useState(!!order.stopLoss);
  const [tp, setTp] = useState(order.takeProfit ?? '');
  const [sl, setSl] = useState(order.stopLoss ?? '');
  const [submitted, setSubmitted] = useState(false);
  const errs = validateOrder({ type: 'limit', side: order.side, lots, leverage: String(order.leverage), limitPrice: price, tpOn, takeProfit: tp, slOn, stopLoss: sl }, symbol, price);
  const shown: FieldErrors = submitted ? errs : {};
  const submit = () => {
    setSubmitted(true);
    if (hasErrors(errs)) return;
    void a.run(() => modifyOrder(order.id, { limitPrice: price.trim(), lots: lots.trim(), takeProfit: tpOn ? tp.trim() : undefined, stopLoss: slOn ? sl.trim() : undefined }), t('orders.modified'), onClose);
  };
  return (
    <Modal
      open
      title={t('orders.modifyTitle')}
      subtitle={`${order.symbol} · ${t(`side.${order.side}`)} · ${order.leverage}×`}
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={submit} disabled={a.busy}>
          {a.busy ? t('common.submitting') : t('common.save')}
        </button>
      }
    >
      <div className="row2">
        <TextField label={t('order.limitPrice')} value={price} onChange={setPrice} inputMode="decimal" mono errors={shown.limitPrice} />
        <TextField label={t('order.lots')} value={lots} onChange={setLots} inputMode="decimal" mono errors={shown.lots} />
      </div>
      <div className="row2">
        <TextField label={t('order.takeProfit')} labelExtra={<Switch checked={tpOn} onChange={setTpOn} label={t('order.takeProfitToggle')} />} value={tpOn ? tp : ''} placeholder={tpOn ? '' : t('order.notSet')} disabled={!tpOn} onChange={setTp} inputMode="decimal" mono errors={shown.takeProfit} />
        <TextField label={t('order.stopLoss')} labelExtra={<Switch checked={slOn} onChange={setSlOn} label={t('order.stopLossToggle')} />} value={slOn ? sl : ''} placeholder={slOn ? '' : t('order.notSet')} disabled={!slOn} onChange={setSl} inputMode="decimal" mono errors={shown.stopLoss} />
      </div>
      <p className="muted small">{t('orders.modifyNote')}</p>
      <ErrorBox text={a.error} />
    </Modal>
  );
}

export function CancelOrderDialog({ order, symbol, onClose }: { order: PendingOrder; symbol: SymbolInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  return (
    <ConfirmDialog open title={t('orders.cancelTitle')} confirmText={t('orders.cancelConfirm')} tone="danger" busy={a.busy} onClose={onClose} onConfirm={() => a.run(() => cancelOrder(order.id), t('orders.cancelled'), onClose)}>
      <p>
        {t('orders.cancelBody', {
          symbol: order.symbol,
          side: t(`side.${order.side}`),
          lots: formatLots(order.lots),
          price: formatPrice(order.limitPrice, symbol.digits),
          margin: formatAmount(order.frozenMargin),
        })}
      </p>
      <ErrorBox text={a.error} />
    </ConfirmDialog>
  );
}
