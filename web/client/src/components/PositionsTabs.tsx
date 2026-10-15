/**
 * 持仓 / 挂单 / 历史 三个页签（效果图 M1 下半部、M5 中下）。
 * 手机用卡片，桌面用表格。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listHistory } from '../api/trading';
import type { HistoryItem, PendingOrder, Position, SymbolInfo } from '../api/types';
import { useAccount, useSymbols } from '../app/contexts';
import { usePaged } from '../hooks/usePaged';
import { useQuotes } from '../hooks/useQuotes';
import { useServerEvent } from '../hooks/useServerEvent';
import { cmp, ZERO, type Dec } from '../lib/decimal';
import { formatAmount, formatDateTime, formatLots, formatPrice } from '../lib/format';
import { closePrice, positionPnl } from '../lib/trading';
import { EmptyState, ErrorState, Loading } from './AsyncView';
import { AddMarginDialog, CancelOrderDialog, ClosePositionDialog, ModifyOrderDialog, TpSlDialog } from './PositionDialogs';

type Tab = 'positions' | 'orders' | 'history';
type Dialog =
  | { kind: 'close' | 'tpsl' | 'margin'; position: Position; symbol: SymbolInfo }
  | { kind: 'modify' | 'cancel'; order: PendingOrder; symbol: SymbolInfo }
  | null;

const tone = (d: Dec | string | undefined) => (d === undefined ? '' : (typeof d === 'string' ? d.startsWith('-') : cmp(d, ZERO) < 0) ? 'down' : 'up');

function SideTag({ side }: { side: 'buy' | 'sell' }) {
  const { t } = useTranslation();
  return <span className={`side-tag ${side === 'buy' ? 'l' : 's'}`}>{t(`side.${side}Short`)}</span>;
}

export function PositionsTabs({ table, limit, onSelectSymbol }: { table?: boolean; limit?: number; onSelectSymbol?: (s: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('positions');
  const [dialog, setDialog] = useState<Dialog>(null);
  const { positions, orders, metrics, loading, error, reload } = useAccount();
  const tabs: Array<[Tab, string]> = [
    ['positions', `${t('positions.tab')} (${positions.length})`],
    ['orders', `${t('orders.tab')} (${orders.length})`],
    ['history', t('history.tab')],
  ];
  return (
    <section className={`ptabs-wrap${table ? ' as-table' : ''}`}>
      <div className="ptabs" role="tablist" aria-label={t('positions.tabsLabel')}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} id={`tab-${k}`} aria-controls={`panel-${k}`}>
            {label}
          </button>
        ))}
        {tab === 'positions' && metrics && positions.length > 0 && (
          <span className="ptabs-sum">
            {t('positions.floating')} <b className={`num ${tone(metrics.floatingPnl)}`}>{formatAmount(metrics.floatingPnl, { sign: true })}</b>
          </span>
        )}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ptabs-body">
        {tab !== 'history' && error && positions.length === 0 && orders.length === 0 ? (
          <ErrorState error={error} onRetry={reload} compact />
        ) : tab !== 'history' && loading ? (
          <Loading rows={2} />
        ) : tab === 'positions' ? (
          <PositionList positions={limit ? positions.slice(0, limit) : positions} table={table} onAction={setDialog} onSelectSymbol={onSelectSymbol} />
        ) : tab === 'orders' ? (
          <OrderList orders={orders} table={table} onAction={setDialog} />
        ) : (
          <HistoryList table={table} />
        )}
      </div>
      {dialog?.kind === 'close' && <ClosePositionDialog position={dialog.position} symbol={dialog.symbol} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'tpsl' && <TpSlDialog position={dialog.position} symbol={dialog.symbol} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'margin' && <AddMarginDialog position={dialog.position} symbol={dialog.symbol} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'modify' && <ModifyOrderDialog order={dialog.order} symbol={dialog.symbol} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cancel' && <CancelOrderDialog order={dialog.order} symbol={dialog.symbol} onClose={() => setDialog(null)} />}
    </section>
  );
}

function PositionList({ positions, table, onAction, onSelectSymbol }: { positions: Position[]; table?: boolean; onAction: (d: Dialog) => void; onSelectSymbol?: (s: string) => void }) {
  const { t } = useTranslation();
  const { map } = useSymbols();
  const quotes = useQuotes();
  if (positions.length === 0) return <EmptyState compact title={t('positions.empty')} hint={t('positions.emptyHint')} />;
  const rows = positions
    .map((p) => {
      const s = map[p.symbol];
      const q = quotes[p.symbol];
      return s ? { p, s, q, pnl: q ? positionPnl(p, s, q) : undefined } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const ops = (p: Position, s: SymbolInfo) => (
    <div className="ops">
      <button type="button" className="op-close" onClick={() => onAction({ kind: 'close', position: p, symbol: s })}>
        {t('positions.close')}
      </button>
      <button type="button" onClick={() => onAction({ kind: 'tpsl', position: p, symbol: s })}>
        {t('positions.tpsl')}
      </button>
      <button type="button" onClick={() => onAction({ kind: 'margin', position: p, symbol: s })}>
        {table ? t('positions.addMarginShort') : t('positions.addMargin')}
      </button>
    </div>
  );
  if (table) {
    return (
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('order.symbol')}</th>
              <th>{t('positions.lotsLev')}</th>
              <th>{t('positions.openPrice')}</th>
              <th>{t('positions.margin')}</th>
              <th>{t('positions.tpSlCol')}</th>
              <th>{t('positions.liq')}</th>
              <th>{t('positions.pnl')}</th>
              <th className="th-ops">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s, pnl }) => (
              <tr key={p.id}>
                <td className="tx">
                  <button type="button" className="link-btn num" onClick={() => onSelectSymbol?.(p.symbol)}>
                    {p.symbol}
                  </button>{' '}
                  <SideTag side={p.side} />
                </td>
                <td>
                  {formatLots(p.lots)} · {p.leverage}×
                </td>
                <td>{formatPrice(p.openPrice, s.digits)}</td>
                <td>{formatAmount(p.margin)}</td>
                <td>
                  <span className="sub">
                    {t('positions.tpShort')} <b>{p.takeProfit ? formatPrice(p.takeProfit, s.digits) : t('order.notSet')}</b>
                  </span>
                  <span className="sub">
                    {t('positions.slShort')} <b>{p.stopLoss ? formatPrice(p.stopLoss, s.digits) : t('order.notSet')}</b>
                  </span>
                </td>
                <td className="risk">{formatPrice(p.liquidationPrice, s.digits)}</td>
                <td className={tone(pnl)}>{pnl !== undefined ? formatAmount(pnl, { sign: true }) : '—'}</td>
                <td className="tx">{ops(p, s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="card-list">
      {rows.map(({ p, s, q, pnl }) => (
        <article key={p.id} className="pos-card">
          <div className="r1">
            <b className="num">{p.symbol}</b>
            <SideTag side={p.side} />
            <span className="meta">
              {t('positions.lotsMeta', { lots: formatLots(p.lots), lev: p.leverage })}
            </span>
            <span className={`pnl num ${tone(pnl)}`}>{pnl !== undefined ? formatAmount(pnl, { sign: true }) : '—'}</span>
          </div>
          <div className="grid4">
            <div>
              {t('positions.openPrice')}
              <span className="num">{formatPrice(p.openPrice, s.digits)}</span>
            </div>
            <div>
              {t('positions.current')}
              <span className="num">{q ? formatPrice(closePrice(p.side, q), s.digits) : '—'}</span>
            </div>
            <div>
              {t('positions.margin')}
              <span className="num">{formatAmount(p.margin)}</span>
            </div>
            <div>
              {t('positions.liq')}
              <span className="num risk">{formatPrice(p.liquidationPrice, s.digits)}</span>
            </div>
          </div>
          {(p.takeProfit || p.stopLoss) && (
            <div className="tpsl-line">
              {t('positions.tpShort')} <b className="num">{p.takeProfit ? formatPrice(p.takeProfit, s.digits) : t('order.notSet')}</b>
              <span aria-hidden="true"> · </span>
              {t('positions.slShort')} <b className="num">{p.stopLoss ? formatPrice(p.stopLoss, s.digits) : t('order.notSet')}</b>
            </div>
          )}
          {ops(p, s)}
        </article>
      ))}
    </div>
  );
}

function OrderList({ orders, table, onAction }: { orders: PendingOrder[]; table?: boolean; onAction: (d: Dialog) => void }) {
  const { t } = useTranslation();
  const { map } = useSymbols();
  if (orders.length === 0) return <EmptyState compact title={t('orders.empty')} hint={t('orders.emptyHint')} />;
  const ops = (o: PendingOrder, s: SymbolInfo) => (
    <div className="ops">
      <button type="button" onClick={() => onAction({ kind: 'modify', order: o, symbol: s })}>
        {t('orders.modify')}
      </button>
      <button type="button" className="op-danger" onClick={() => onAction({ kind: 'cancel', order: o, symbol: s })}>
        {t('orders.cancel')}
      </button>
    </div>
  );
  const rows = orders.map((o) => ({ o, s: map[o.symbol] })).filter((x) => x.s);
  if (table) {
    return (
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('order.symbol')}</th>
              <th>{t('positions.lotsLev')}</th>
              <th>{t('order.limitPrice')}</th>
              <th>{t('positions.tpSlCol')}</th>
              <th>{t('orders.frozen')}</th>
              <th>{t('orders.createdAt')}</th>
              <th className="th-ops">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, s }) => (
              <tr key={o.id}>
                <td className="tx">
                  <span className="num">{o.symbol}</span> <SideTag side={o.side} />
                </td>
                <td>
                  {formatLots(o.lots)} · {o.leverage}×
                </td>
                <td>{formatPrice(o.limitPrice, s.digits)}</td>
                <td>
                  <span className="sub">
                    {t('positions.tpShort')} <b>{o.takeProfit ? formatPrice(o.takeProfit, s.digits) : t('order.notSet')}</b>
                  </span>
                  <span className="sub">
                    {t('positions.slShort')} <b>{o.stopLoss ? formatPrice(o.stopLoss, s.digits) : t('order.notSet')}</b>
                  </span>
                </td>
                <td>{formatAmount(o.frozenMargin)}</td>
                <td>{formatDateTime(o.createdAt, { short: true })}</td>
                <td className="tx">{ops(o, s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="card-list">
      {rows.map(({ o, s }) => (
        <article key={o.id} className="pos-card">
          <div className="r1">
            <b className="num">{o.symbol}</b>
            <SideTag side={o.side} />
            <span className="meta">{t('orders.limitMeta', { lots: formatLots(o.lots), lev: o.leverage })}</span>
            <span className="pnl num">{formatPrice(o.limitPrice, s.digits)}</span>
          </div>
          <div className="grid4">
            <div>
              {t('positions.tpShort')}
              <span className="num">{o.takeProfit ? formatPrice(o.takeProfit, s.digits) : t('order.notSet')}</span>
            </div>
            <div>
              {t('positions.slShort')}
              <span className="num">{o.stopLoss ? formatPrice(o.stopLoss, s.digits) : t('order.notSet')}</span>
            </div>
            <div>
              {t('orders.frozen')}
              <span className="num">{formatAmount(o.frozenMargin)}</span>
            </div>
            <div>
              {t('orders.createdAt')}
              <span className="num">{formatDateTime(o.createdAt, { short: true })}</span>
            </div>
          </div>
          {ops(o, s)}
        </article>
      ))}
    </div>
  );
}

function HistoryList({ table }: { table?: boolean }) {
  const { t } = useTranslation();
  const { map } = useSymbols();
  const s = usePaged(listHistory, 'history');
  useServerEvent((e) => {
    if (e.type === 'positions' || e.type === 'orders') s.reload();
  });
  if (s.error && !s.data) return <ErrorState error={s.error} onRetry={s.reload} compact />;
  if (!s.data) return <Loading rows={3} />;
  const { items, total } = s.data;
  if (items.length === 0) return <EmptyState compact title={t('history.empty')} />;
  const digits = (h: HistoryItem) => map[h.symbol]?.digits ?? 2;
  const more =
    items.length < total ? (
      <button type="button" className="btn btn-ghost btn-block" onClick={s.loadMore} disabled={s.loading}>
        {s.loading ? t('common.loading') : t('common.loadMore', { shown: items.length, total })}
      </button>
    ) : (
      <p className="list-end">{t('common.noMore', { total })}</p>
    );
  if (table) {
    return (
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('order.symbol')}</th>
              <th>{t('history.kind')}</th>
              <th>{t('positions.lots')}</th>
              <th>{t('positions.openPrice')}</th>
              <th>{t('history.closePrice')}</th>
              <th>{t('order.fee')}</th>
              <th>{t('history.pnl')}</th>
              <th>{t('history.time')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id}>
                <td className="tx">
                  <span className="num">{h.symbol}</span> <SideTag side={h.side} />
                </td>
                <td className="tx">
                  <span className={`kind-tag k-${h.kind}`}>{t(`history.kinds.${h.kind}`)}</span>
                </td>
                <td>{formatLots(h.lots)}</td>
                <td>{formatPrice(h.openPrice, digits(h))}</td>
                <td>{h.closePrice ? formatPrice(h.closePrice, digits(h)) : '—'}</td>
                <td>{formatAmount(h.fee)}</td>
                <td className={tone(h.pnl)}>{h.pnl ? formatAmount(h.pnl, { sign: true }) : '—'}</td>
                <td>{formatDateTime(h.closedAt, { short: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {more}
      </div>
    );
  }
  return (
    <div className="card-list">
      {items.map((h) => (
        <article key={h.id} className="hist-row">
          <div className="r1">
            <b className="num">{h.symbol}</b>
            <SideTag side={h.side} />
            <span className={`kind-tag k-${h.kind}`}>{t(`history.kinds.${h.kind}`)}</span>
            <span className={`pnl num ${tone(h.pnl)}`}>{h.pnl ? formatAmount(h.pnl, { sign: true }) : '—'}</span>
          </div>
          <div className="r2">
            <span>
              {formatLots(h.lots)} {t('common.lots')} · {formatPrice(h.openPrice, digits(h))} → {h.closePrice ? formatPrice(h.closePrice, digits(h)) : '—'}
            </span>
            <span className="num">{formatDateTime(h.closedAt, { short: true })}</span>
          </div>
        </article>
      ))}
      {more}
    </div>
  );
}
