/**
 * 手机下单抽屉（UI 风格 C，效果图 assets/v1/ui-research/C-手机.png 第 ③ 屏）。
 * 在品种页点"卖出 / 买入"后从底部弹出，方向已定；常用操作只有：选手数 → 确认。
 * 杠杆、止盈止损、费用明细各占一行，点开再设置。和桌面下单面板共用 useOrderForm。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Side, SymbolInfo } from '../api/types';
import { tpSlSummary, useOrderForm } from '../hooks/useOrderForm';
import { formatAmount, formatPrice } from '../lib/format';
import { contractUnitText } from '../lib/symbol';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { LeverageField, LimitPriceField, LotsField, Notice, OrderConfirm, RejectAndSummary, SubmitButton, TpSlFields, TypeSwitch } from './order/parts';

const SHEET_LOTS = ['0.01', '0.10', '0.50', '1.00'];

function SheetBody({ symbol, side, onDone }: { symbol: SymbolInfo; side: Side; onDone: () => void }) {
  const { t } = useTranslation();
  const f = useOrderForm(symbol, side, onDone);
  const [open, setOpen] = useState<{ lev: boolean; tpsl: boolean; detail: boolean }>({ lev: false, tpsl: false, detail: false });
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // 提交时被折叠的字段有错误，自动展开
  const levOpen = open.lev || !!f.shown.leverage;
  const tpslOpen = open.tpsl || !!(f.shown.takeProfit || f.shown.stopLoss);
  const other: Side = f.form.side === 'buy' ? 'sell' : 'buy';

  return (
    <div className="order-sheet">
      <div className="os-top">
        <span className={`os-side ${f.form.side === 'buy' ? 'up' : 'down'}`}>
          {t(`side.${f.form.side}`)} · {t('order.isolated')}
        </span>
        <button type="button" className="os-switch" onClick={() => f.set('side', other)} data-autofocus>
          {t('order.switchTo', { side: t(`side.${other}`) })}
          <Icon name="swap" size={14} strokeWidth={2.2} />
        </button>
      </div>
      <Notice f={f} />
      <TypeSwitch f={f} symbol={symbol} />
      <LimitPriceField f={f} symbol={symbol} />
      <LotsField f={f} symbol={symbol} chips={SHEET_LOTS} big />

      <button type="button" className={`fold-row${levOpen ? ' open' : ''}`} aria-expanded={levOpen} onClick={() => toggle('lev')}>
        <span>{t('order.leverage')}</span>
        <em className="num accent">{f.form.leverage || '—'}×</em>
        <Icon name="chevronDown" size={14} strokeWidth={2.4} />
      </button>
      {levOpen && <LeverageField f={f} symbol={symbol} />}

      <button type="button" className={`fold-row${tpslOpen ? ' open' : ''}`} aria-expanded={tpslOpen} onClick={() => toggle('tpsl')}>
        <span>{t('order.tpsl')}</span>
        <em>{tpSlSummary(f, symbol, t)}</em>
        <Icon name="chevronDown" size={14} strokeWidth={2.4} />
      </button>
      {tpslOpen && <TpSlFields f={f} />}

      <dl className="os-sum">
        <div>
          <dt>{t('order.estMargin')}</dt>
          <dd className="num strong">{f.est ? `${formatAmount(f.est.margin)} USDT` : '—'}</dd>
        </div>
        <div>
          <dt>{t('order.estLiq')}</dt>
          <dd className="num risk">
            {f.est ? formatPrice(f.est.liquidationPrice, symbol.digits) : '—'}
            <button type="button" className="os-detail" aria-expanded={open.detail} onClick={() => toggle('detail')}>
              {t('order.detail')}
              <Icon name="chevronDown" size={12} strokeWidth={2.4} />
            </button>
          </dd>
        </div>
        {open.detail && (
          <>
            <div>
              <dt>{t('order.fee')}</dt>
              <dd className="num">{f.est ? formatAmount(f.est.fee) : '—'}</dd>
            </div>
            <div>
              <dt>{t('order.notional')}</dt>
              <dd className="num">{f.est ? formatAmount(f.est.notional) : '—'}</dd>
            </div>
            <div>
              <dt>{t('account.available')}</dt>
              <dd className="num">{formatAmount(f.available)}</dd>
            </div>
            <div>
              <dt>{t('order.contractUnit')}</dt>
              <dd className="num">{contractUnitText(t, symbol)}</dd>
            </div>
            <p className="est-note">{t('order.isolatedNote')}</p>
          </>
        )}
      </dl>

      <RejectAndSummary f={f} />
      <SubmitButton f={f} symbol={symbol} />
      <OrderConfirm f={f} symbol={symbol} />
    </div>
  );
}

export function OrderSheet({ symbol, side, onClose }: { symbol: SymbolInfo; side: Side | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={side !== null} title={<span className="num">{symbol.code}</span>} subtitle={t('order.title')} onClose={onClose} size="md">
      {side && <SheetBody key={`${symbol.code}-${side}`} symbol={symbol} side={side} onDone={onClose} />}
    </Modal>
  );
}
