/**
 * 挂单监控：限价单（可带止盈止损）；强制撤单（高危）。
 */
import { useTranslation } from 'react-i18next';
import { forceCancelPending, listPendingOrders } from '../../api';
import type { PendingOrder } from '../../api/types';
import { usePagedList } from '../../hooks/usePagedList';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Amount, Num } from '../../components/Num';
import { formatAmount } from '../../utils/money';
import { shortTime } from '../../utils/display';
import { TradeFilters, type TradeFilterValues } from './TradeFilters';

export function PendingPage() {
  const { t } = useTranslation();
  const list = usePagedList<PendingOrder, TradeFilterValues>(listPendingOrders, {});
  const hr = useHighRisk();

  const cancel = (p: PendingOrder) =>
    hr.ask({
      title: t('pending.forceCancel'),
      description: t('pending.forceCancelDesc', { id: p.id, name: p.customerName, symbol: p.symbol, side: t(`side.${p.side}`), lots: p.lots, price: p.limitPrice, margin: formatAmount(p.frozenMargin) }),
      confirmText: t('pending.confirmCancel'),
      successText: t('pending.cancelled'),
      onConfirm: (v) => forceCancelPending(p.id, v.reason),
      onDone: list.reload,
    });

  return (
    <>
      <PageHeader title={t('pending.title')} sub={t('pending.sub')} />
      <TradeFilters onChange={list.setFilters} />
      <DataTable<PendingOrder>
        rowKey="id"
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        dataSource={list.data?.items}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.onPageChange}
        columns={[
          { title: t('pending.id'), dataIndex: 'id', render: (v: string) => <Num>{v}</Num> },
          { title: t('funds.user'), key: 'u', render: (_, r) => <div className="user-cell"><b title={r.customerName}>{r.customerName}</b><small>ID {r.customerId}</small></div> },
          { title: t('trading.symbol'), dataIndex: 'symbol', render: (v: string) => <b>{v}</b> },
          { title: t('trading.side'), dataIndex: 'side', render: (v: string) => <span className={v === 'buy' ? 'up' : 'down'}>{t(`side.${v}`)}</span> },
          { title: t('trading.lots'), dataIndex: 'lots', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('pending.limitPrice'), dataIndex: 'limitPrice', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('trading.leverage'), dataIndex: 'leverage', align: 'right', render: (v: number) => <Num>{v}x</Num> },
          { title: t('pending.frozenMargin'), dataIndex: 'frozenMargin', align: 'right', render: (v: string) => <Amount value={v} /> },
          { title: t('positions.slTp'), key: 'sltp', render: (_, r) => <Num>{r.stopLoss ?? '—'} / {r.takeProfit ?? '—'}</Num> },
          { title: t('orders.createdAt'), dataIndex: 'createdAt', render: (v: string) => <Num>{shortTime(v)}</Num> },
          {
            title: t('common.actions'),
            key: 'op',
            fixed: 'right',
            render: (_, r) => (
              <PermButton perm="pending:force_cancel" size="small" danger onClick={() => cancel(r)}>
                {t('pending.forceCancel')}
              </PermButton>
            ),
          },
        ]}
      />
      {hr.element}
    </>
  );
}
