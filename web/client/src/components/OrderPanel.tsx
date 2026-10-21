/**
 * 桌面下单面板（UI 风格 C，交易页右栏常驻，效果图 assets/v1/ui-research/C-桌面-交易页.png）。
 * 从上到下：卖出 / 买入（显示实时价格）→ 市价 / 限价 → 手数 → 杠杆 → 止盈止损（默认折叠）→ 预估 → 提交。
 * 手机用 OrderSheet。两者共用 useOrderForm，计算和校验只有一份。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Side, SymbolInfo } from '../api/types';
import { tpSlSummary, useOrderForm } from '../hooks/useOrderForm';
import { formatAmount, formatPrice } from '../lib/format';
import { contractUnitText } from '../lib/symbol';
import { UX1021 } from '../lib/ux1021';
import { Icon } from './Icon';
import { LeverageField, LimitPriceField, LotsField, Notice, OrderConfirm, RejectAndSummary, SubmitButton, TpSlFields, TypeSwitch } from './order/parts';

/** sideRequest：图表上点"卖出 / 买入"时由交易页传入，n 每次点击加一 */
export function OrderPanel({ symbol, initialSide = 'buy', sideRequest }: { symbol: SymbolInfo; initialSide?: Side; sideRequest?: { side: Side; n: number }; inline?: boolean }) {
  const { t } = useTranslation();
  const f = useOrderForm(symbol, sideRequest?.side ?? initialSide);
  const [tpslOpen, setTpslOpen] = useState(false);
  const { set } = f;

  useEffect(() => {
    if (sideRequest) set('side', sideRequest.side);
    // 只响应新的点击
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideRequest?.n]);

  // 提交时止盈止损有错误，自动展开
  const tpslErr = !!(f.shown.takeProfit || f.shown.stopLoss);
  const showTpsl = tpslOpen || tpslErr;

  const sideBtn = (s: Side) => (
    <button type="button" role="radio" aria-checked={f.form.side === s} className={`dir-btn ${s}${f.form.side === s ? ' on' : ''}`} onClick={() => f.set('side', s)}>
      <small>{t(`side.${s}`)}</small>
      <b className="num">{f.quote ? formatPrice(s === 'buy' ? f.quote.ask : f.quote.bid, symbol.digits) : '—'}</b>
    </button>
  );

  return (
    <div className="order-panel">
      <h3 className="op-title">
        {t('order.title')}
        <span className="op-mode">{t('order.isolated')}</span>
      </h3>
      <Notice f={f} />
      <div className="dir" role="radiogroup" aria-label={t('order.side')}>
        {sideBtn('sell')}
        {sideBtn('buy')}
      </div>
      <TypeSwitch f={f} symbol={symbol} />
      <LimitPriceField f={f} symbol={symbol} />
      <LotsField f={f} symbol={symbol} />
      <LeverageField f={f} symbol={symbol} />

      <button type="button" className={`fold-row${showTpsl ? ' open' : ''}`} aria-expanded={showTpsl} onClick={() => setTpslOpen(!showTpsl)}>
        <span>{t('order.tpsl')}</span>
        <em>{tpSlSummary(f, symbol, t)}</em>
        <Icon name="chevronDown" size={14} strokeWidth={2.4} />
      </button>
      {showTpsl && <TpSlFields f={f} />}

      <dl className="est">
        <div>
          <dt>{t('order.estMargin')}</dt>
          <dd className="num">{f.est ? formatAmount(f.est.margin) : '—'}</dd>
        </div>
        <div>
          <dt>{t('order.fee')}</dt>
          <dd className="num">{f.est ? formatAmount(f.est.fee) : '—'}</dd>
        </div>
        <div>
          <dt>{t('order.estLiq')}</dt>
          <dd className="num risk">{f.est ? formatPrice(f.est.liquidationPrice, symbol.digits) : '—'}</dd>
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
      </dl>

      <RejectAndSummary f={f} />
      {UX1021 ? (
        // 体验优化 1021 第 3 条：确认按钮固定在右栏底部，笔记本屏幕上不用滚动也能看到（面板内容在它上面滚动）
        <div className="op-sticky">
          <SubmitButton f={f} symbol={symbol} />
          <div className="op-foot">{t('order.footNote')}</div>
        </div>
      ) : (
        <>
          <SubmitButton f={f} symbol={symbol} />
          <div className="op-foot">{t('order.footNote')}</div>
        </>
      )}
      <OrderConfirm f={f} symbol={symbol} />
    </div>
  );
}
