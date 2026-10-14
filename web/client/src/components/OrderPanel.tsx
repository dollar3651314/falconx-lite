/**
 * 下单面板（效果图 M2 / M5 右栏）。
 * 手机：底部弹出；桌面：交易页右栏常驻。
 * 市价 / 限价；买入按 ask、卖出按 bid；数量（手，最小 0.01）、杠杆（不超过品种上限）；
 * 两种订单都可以带止盈止损；提交前二次确认；被拒时显示具体原因。
 */
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../api/errors';
import { placeOrder } from '../api/trading';
import type { Side, SymbolInfo } from '../api/types';
import { useAccount, useToast } from '../app/contexts';
import { useQuote } from '../hooks/useQuotes';
import { add, cmp, dec, isDecimalString, mul, sub, toFixed, toPlain, ZERO, type Dec } from '../lib/decimal';
import { formatAmount, formatLots, formatPrice } from '../lib/format';
import { contractUnitText, symbolName } from '../lib/symbol';
import { estimateOrder, execPrice, pnlAt } from '../lib/trading';
import { hasErrors, sanitizeLots, validateOrder, type FieldErrors, type OrderForm } from '../lib/validators';
import { FieldErrors as Errors, Segmented, Switch, TextField } from './Form';
import { ConfirmDialog } from './Modal';
import { Icon } from './Icon';

const LOT_CHIPS = ['0.01', '0.10', '0.50', '1.00', '2.00'];

function leverageChips(max: number): number[] {
  const base = [10, 20, 50, 100, 200, 500].filter((x) => x < max);
  return [...base.slice(-3), max];
}

export function OrderPanel({ symbol, initialSide = 'buy', inline, onDone }: { symbol: SymbolInfo; initialSide?: Side; inline?: boolean; onDone?: () => void }) {
  const { t, i18n } = useTranslation();
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

  const expected = (v: string): Dec | null => {
    if (!est || !quote || !isDecimalString(v) || !isDecimalString(form.lots)) return null;
    return pnlAt(form.side, est.price, dec(v), dec(form.lots), symbol.contractSize, quote.quoteToUsd);
  };

  const stepLots = (dir: 1 | -1) => {
    const cur = isDecimalString(form.lots) ? dec(form.lots) : dec(symbol.minLots);
    let next = dir > 0 ? add(cur, dec(symbol.lotStep)) : sub(cur, dec(symbol.lotStep));
    if (cmp(next, dec(symbol.minLots)) < 0) next = dec(symbol.minLots);
    if (cmp(next, dec(symbol.maxLots)) > 0) next = dec(symbol.maxLots);
    set('lots', formatLots(next).replace(/,/g, ''));
  };

  const onSubmit = () => {
    setSubmitted(true);
    setReject(null);
    if (hasErrors(errors)) return;
    setConfirm(true);
  };

  const doPlace = async () => {
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

  const sideBtn = (s: Side) => (
    <button type="button" role="radio" aria-checked={form.side === s} className={`dir-btn ${s}${form.side === s ? ' on' : ''}`} onClick={() => set('side', s)}>
      <small>{t(`side.${s}`)}</small>
      <b className="num">{quote ? formatPrice(s === 'buy' ? quote.ask : quote.bid, symbol.digits) : '—'}</b>
    </button>
  );

  const available = metrics?.available ?? ZERO;
  const notice = !symbol.tradingOpen ? t('order.noticeClosed') : symbol.openPaused ? t('order.noticePaused') : null;
  const levChips = leverageChips(symbol.maxLeverage);

  return (
    <div className={`order-panel${inline ? ' inline' : ''}`}>
      {inline && (
        <h3 className="op-title">
          {t('order.title')} <span className="num">{symbol.code}</span>
        </h3>
      )}
      {notice && (
        <div className="notice warn" role="note">
          <Icon name="pause" size={14} strokeWidth={2.4} />
          {notice}
        </div>
      )}
      <Segmented
        label={t('order.type')}
        value={form.type}
        onChange={(v) => {
          set('type', v);
          if (v === 'limit' && !form.limitPrice && marketPrice) set('limitPrice', marketPrice);
        }}
        options={[
          { value: 'market', label: t('order.market') },
          { value: 'limit', label: t('order.limit') },
        ]}
      />
      <div className="dir" role="radiogroup" aria-label={t('order.side')}>
        {sideBtn('sell')}
        {sideBtn('buy')}
      </div>

      {form.type === 'market' ? (
        <div className="mkt-note">
          <span>{t(form.side === 'buy' ? 'order.marketBuyNote' : 'order.marketSellNote')}</span>
          <span>
            {t('order.current')} <b className="num">{marketPrice ? formatPrice(marketPrice, symbol.digits) : '—'}</b>
          </span>
        </div>
      ) : (
        <TextField
          label={t('order.limitPrice')}
          value={form.limitPrice}
          onChange={(v) => set('limitPrice', v)}
          inputMode="decimal"
          mono
          errors={shown.limitPrice}
          suffix={symbol.quoteCcy}
          hint={t(form.side === 'buy' ? 'order.limitBuyHint' : 'order.limitSellHint')}
        />
      )}

      <div className="row2">
        <div className="field">
          <div className="field-label">
            <label htmlFor="lots-input">{t('order.lots')}</label>
            <em className="lots-range">
              {formatLots(symbol.minLots)} – {formatLots(symbol.maxLots)}
            </em>
          </div>
          <div className={`stepper${shown.lots ? ' invalid' : ''}`}>
            <button type="button" onClick={() => stepLots(-1)} aria-label={t('order.lotsDec')}>
              −
            </button>
            <input id="lots-input" className="mono" inputMode="decimal" value={form.lots} onChange={(e) => set('lots', sanitizeLots(form.lots, e.target.value))} aria-invalid={!!shown.lots} aria-describedby="lots-err" />
            <button type="button" onClick={() => stepLots(1)} aria-label={t('order.lotsInc')}>
              +
            </button>
          </div>
          <Errors id="lots-err" errors={shown.lots} />
        </div>
        <TextField
          label={t('order.leverage')}
          labelExtra={<em>{t('order.leverageMax', { n: symbol.maxLeverage })}</em>}
          value={form.leverage}
          onChange={(v) => set('leverage', v.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          mono
          suffix={t('order.times')}
          errors={shown.leverage}
        />
      </div>
      <div className="quick-chips">
        <div className="chips" role="group" aria-label={t('order.quickLots')}>
          {LOT_CHIPS.map((c) => (
            <button key={c} type="button" className={`chip mono${form.lots === c ? ' on' : ''}`} onClick={() => set('lots', c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label={t('order.quickLeverage')}>
          {levChips.map((c) => (
            <button key={c} type="button" className={`chip mono${form.leverage === String(c) ? ' on' : ''}`} onClick={() => set('leverage', String(c))}>
              {c}×
            </button>
          ))}
        </div>
      </div>

      <div className="tpsl">
        {(['takeProfit', 'stopLoss'] as const).map((k) => {
          const on = k === 'takeProfit' ? form.tpOn : form.slOn;
          const val = form[k];
          const exp = on ? expected(val) : null;
          return (
            <div key={k} className="tpsl-item">
              <div className="field-label">
                <label htmlFor={`${k}-input`}>{t(`order.${k}`)}</label>
                <Switch
                  checked={on}
                  label={t(`order.${k}Toggle`)}
                  onChange={(v) => {
                    set(k === 'takeProfit' ? 'tpOn' : 'slOn', v);
                    if (v && !val && refPrice && isDecimalString(refPrice)) {
                      // 默认填在参考价 ±1% 处，方向符合止盈止损规则
                      const above = (k === 'takeProfit') === (form.side === 'buy');
                      set(k, toFixed(mul(dec(refPrice), dec(above ? '1.01' : '0.99')), symbol.digits));
                    }
                  }}
                />
              </div>
              <div className={`input-wrap${shown[k] ? ' invalid' : ''}${on ? '' : ' disabled'}`}>
                <input id={`${k}-input`} className="mono" inputMode="decimal" value={on ? val : ''} placeholder={on ? '' : t('order.notSet')} disabled={!on} onChange={(e) => set(k, e.target.value)} aria-invalid={!!shown[k]} aria-describedby={`${k}-err`} />
              </div>
              {exp !== null && (
                <div className="tpsl-hint">
                  {t(cmp(exp, ZERO) >= 0 ? 'order.expectedProfit' : 'order.expectedLoss')} <b className={`num ${cmp(exp, ZERO) >= 0 ? 'up' : 'down'}`}>{formatAmount(exp, { sign: true })}</b>
                </div>
              )}
              <Errors id={`${k}-err`} errors={shown[k]} />
            </div>
          );
        })}
      </div>

      <dl className="est">
        <div>
          <dt>{t('order.estMargin')}</dt>
          <dd className="num">{est ? formatAmount(est.margin) : '—'}</dd>
        </div>
        <div>
          <dt>{t('order.fee')}</dt>
          <dd className="num">{est ? formatAmount(est.fee) : '—'}</dd>
        </div>
        <div>
          <dt>{t('order.notional')}</dt>
          <dd className="num">{est ? formatAmount(est.notional) : '—'}</dd>
        </div>
        <div>
          <dt>{t('order.estLiq')}</dt>
          <dd className="num risk">{est ? formatPrice(est.liquidationPrice, symbol.digits) : '—'}</dd>
        </div>
        <div>
          <dt>{t('account.available')}</dt>
          <dd className="num">{formatAmount(available)}</dd>
        </div>
        <div>
          <dt>{t('order.contractUnit')}</dt>
          <dd className="num">{contractUnitText(t, symbol)}</dd>
        </div>
        <p className="est-note">{t('order.isolatedNote')}</p>
      </dl>

      {reject && (
        <div className="notice error" role="alert">
          <Icon name="warn" size={16} strokeWidth={2.2} />
          <div>
            <b>{t('order.rejected')}</b>
            <span>{reject}</span>
          </div>
        </div>
      )}
      {submitted && hasErrors(errors) && (
        <div className="form-summary" role="alert">
          {t('validation.fixAll')}
        </div>
      )}
      <button type="button" className={`btn btn-lg btn-block btn-${form.side}`} onClick={onSubmit}>
        {t(form.side === 'buy' ? 'order.submitBuy' : 'order.submitSell', { lots: form.lots || '0', symbol: symbol.code })}
      </button>
      <div className="op-foot">{t('order.footNote')}</div>

      <ConfirmDialog
        open={confirm}
        title={t('order.confirmTitle')}
        confirmText={t(form.side === 'buy' ? 'order.confirmBuy' : 'order.confirmSell')}
        tone={form.side}
        busy={busy}
        onConfirm={doPlace}
        onClose={() => setConfirm(false)}
      >
        <dl className="kv-list">
          <div>
            <dt>{t('order.symbol')}</dt>
            <dd>
              <b className="num">{symbol.code}</b> {symbolName(symbol, i18n.language)}
            </dd>
          </div>
          <div>
            <dt>{t('order.sideAndType')}</dt>
            <dd className={form.side === 'buy' ? 'up' : 'down'}>
              {t(`side.${form.side}`)} · {t(`order.${form.type}`)}
            </dd>
          </div>
          <div>
            <dt>{form.type === 'market' ? t('order.refPrice') : t('order.limitPrice')}</dt>
            <dd className="num">{refPrice && isDecimalString(refPrice) ? formatPrice(refPrice, symbol.digits) : '—'}</dd>
          </div>
          <div>
            <dt>{t('order.lotsAndLeverage')}</dt>
            <dd className="num">
              {isDecimalString(form.lots) ? formatLots(form.lots) : '—'} · {form.leverage}×
            </dd>
          </div>
          <div>
            <dt>{t('order.estMargin')}</dt>
            <dd className="num">{est ? `${formatAmount(est.margin)} USDT` : '—'}</dd>
          </div>
          <div>
            <dt>{t('order.fee')}</dt>
            <dd className="num">{est ? `${formatAmount(est.fee)} USDT` : '—'}</dd>
          </div>
          <div>
            <dt>{t('order.takeProfit')}</dt>
            <dd className="num">{form.tpOn ? formatPrice(form.takeProfit, symbol.digits) : t('order.notSet')}</dd>
          </div>
          <div>
            <dt>{t('order.stopLoss')}</dt>
            <dd className="num">{form.slOn ? formatPrice(form.stopLoss, symbol.digits) : t('order.notSet')}</dd>
          </div>
        </dl>
        {form.type === 'market' && <p className="muted small">{t('order.confirmMarketNote')}</p>}
      </ConfirmDialog>
    </div>
  );
}
