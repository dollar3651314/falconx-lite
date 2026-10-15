/**
 * 下单界面的公共部件：桌面下单面板和手机下单抽屉共用。
 */
import { useTranslation } from 'react-i18next';
import type { SymbolInfo } from '../../api/types';
import { leverageChips, LOT_CHIPS, type OrderFormState } from '../../hooks/useOrderForm';
import { cmp, isDecimalString, ZERO } from '../../lib/decimal';
import { formatAmount, formatLots, formatPrice } from '../../lib/format';
import { symbolName } from '../../lib/symbol';
import { FieldErrors as Errors, Segmented, Switch, TextField } from '../Form';
import { Icon } from '../Icon';
import { ConfirmDialog } from '../Modal';

export function TypeSwitch({ f, symbol }: { f: OrderFormState; symbol: SymbolInfo }) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t('order.type')}
      value={f.form.type}
      onChange={f.setType}
      options={[
        { value: 'market', label: f.form.type === 'market' && f.marketPrice ? `${t('order.market')} ${formatPrice(f.marketPrice, symbol.digits)}` : t('order.market') },
        { value: 'limit', label: t('order.limit') },
      ]}
    />
  );
}

export function LimitPriceField({ f, symbol }: { f: OrderFormState; symbol: SymbolInfo }) {
  const { t } = useTranslation();
  if (f.form.type !== 'limit') return null;
  return (
    <TextField
      label={t('order.limitPrice')}
      value={f.form.limitPrice}
      onChange={(v) => f.set('limitPrice', v)}
      inputMode="decimal"
      mono
      errors={f.shown.limitPrice}
      suffix={symbol.quoteCcy}
      hint={t(f.form.side === 'buy' ? 'order.limitBuyHint' : 'order.limitSellHint')}
    />
  );
}

export function LotsField({ f, symbol, chips = LOT_CHIPS, big }: { f: OrderFormState; symbol: SymbolInfo; chips?: string[]; big?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="field lots-field">
      <div className="field-label">
        <label htmlFor="lots-input">{t('order.lots')}</label>
        <em className="lots-range">
          {formatLots(symbol.minLots)} – {formatLots(symbol.maxLots)}
        </em>
      </div>
      <div className={`stepper${big ? ' big' : ''}${f.shown.lots ? ' invalid' : ''}`}>
        <button type="button" onClick={() => f.stepLots(-1)} aria-label={t('order.lotsDec')}>
          −
        </button>
        <input id="lots-input" className="mono" inputMode="decimal" value={f.form.lots} onChange={(e) => f.setLots(e.target.value)} aria-invalid={!!f.shown.lots} aria-describedby="lots-err" />
        <button type="button" onClick={() => f.stepLots(1)} aria-label={t('order.lotsInc')}>
          +
        </button>
      </div>
      <div className="chips op-chips" role="group" aria-label={t('order.quickLots')}>
        {chips.map((c) => (
          <button key={c} type="button" className={`chip mono${f.form.lots === c ? ' on' : ''}`} onClick={() => f.set('lots', c)}>
            {c}
          </button>
        ))}
      </div>
      <Errors id="lots-err" errors={f.shown.lots} />
    </div>
  );
}

export function LeverageField({ f, symbol }: { f: OrderFormState; symbol: SymbolInfo }) {
  const { t } = useTranslation();
  return (
    <div className="lev-field">
      <TextField
        label={t('order.leverage')}
        labelExtra={<em>{t('order.leverageMax', { n: symbol.maxLeverage })}</em>}
        value={f.form.leverage}
        onChange={(v) => f.set('leverage', v.replace(/[^\d]/g, ''))}
        inputMode="numeric"
        mono
        suffix={t('order.times')}
        errors={f.shown.leverage}
      />
      <div className="chips op-chips" role="group" aria-label={t('order.quickLeverage')}>
        {leverageChips(symbol.maxLeverage).map((c) => (
          <button key={c} type="button" className={`chip mono${f.form.leverage === String(c) ? ' on' : ''}`} onClick={() => f.set('leverage', String(c))}>
            {c}×
          </button>
        ))}
      </div>
    </div>
  );
}

export function TpSlFields({ f }: { f: OrderFormState }) {
  const { t } = useTranslation();
  return (
    <div className="tpsl">
      {(['takeProfit', 'stopLoss'] as const).map((k) => {
        const on = k === 'takeProfit' ? f.form.tpOn : f.form.slOn;
        const val = f.form[k];
        const exp = on ? f.expected(val) : null;
        return (
          <div key={k} className="tpsl-item">
            <div className="field-label">
              <label htmlFor={`${k}-input`}>{t(`order.${k}`)}</label>
              <Switch checked={on} label={t(`order.${k}Toggle`)} onChange={(v) => f.toggleTpSl(k, v)} />
            </div>
            <div className={`input-wrap${f.shown[k] ? ' invalid' : ''}${on ? '' : ' disabled'}`}>
              <input id={`${k}-input`} className="mono" inputMode="decimal" value={on ? val : ''} placeholder={on ? '' : t('order.notSet')} disabled={!on} onChange={(e) => f.set(k, e.target.value)} aria-invalid={!!f.shown[k]} aria-describedby={`${k}-err`} />
            </div>
            {exp !== null && (
              <div className="tpsl-hint">
                {t(cmp(exp, ZERO) >= 0 ? 'order.expectedProfit' : 'order.expectedLoss')} <b className={`num ${cmp(exp, ZERO) >= 0 ? 'up' : 'down'}`}>{formatAmount(exp, { sign: true })}</b>
              </div>
            )}
            <Errors id={`${k}-err`} errors={f.shown[k]} />
          </div>
        );
      })}
    </div>
  );
}

export function Notice({ f }: { f: OrderFormState }) {
  if (!f.notice) return null;
  return (
    <div className="notice warn" role="note">
      <Icon name="pause" size={14} strokeWidth={2.4} />
      {f.notice}
    </div>
  );
}

export function RejectAndSummary({ f }: { f: OrderFormState }) {
  const { t } = useTranslation();
  return (
    <>
      {f.reject && (
        <div className="notice error" role="alert">
          <Icon name="warn" size={16} strokeWidth={2.2} />
          <div>
            <b>{t('order.rejected')}</b>
            <span>{f.reject}</span>
          </div>
        </div>
      )}
      {f.submitted && f.hasErrors && (
        <div className="form-summary" role="alert">
          {t('validation.fixAll')}
        </div>
      )}
    </>
  );
}

export function SubmitButton({ f, symbol }: { f: OrderFormState; symbol: SymbolInfo }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={`btn btn-lg btn-block btn-${f.form.side} op-submit`} onClick={f.submit}>
      {t(f.form.side === 'buy' ? 'order.submitBuy' : 'order.submitSell', { lots: isDecimalString(f.form.lots) ? formatLots(f.form.lots) : f.form.lots || '0', symbol: symbol.code })}
    </button>
  );
}

export function OrderConfirm({ f, symbol }: { f: OrderFormState; symbol: SymbolInfo }) {
  const { t, i18n } = useTranslation();
  const { form, est, refPrice } = f;
  return (
    <ConfirmDialog
      open={f.confirm}
      title={t('order.confirmTitle')}
      confirmText={t(form.side === 'buy' ? 'order.confirmBuy' : 'order.confirmSell')}
      tone={form.side}
      busy={f.busy}
      onConfirm={f.place}
      onClose={() => f.setConfirm(false)}
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
          <dt>{t('order.estLiq')}</dt>
          <dd className="num risk">{est ? formatPrice(est.liquidationPrice, symbol.digits) : '—'}</dd>
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
  );
}
