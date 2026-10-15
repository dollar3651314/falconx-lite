/**
 * 订单监控：市价单、限价单的成交、挂单中、撤销、被拒（显示具体拒单原因）。
 */
import { useTranslation } from 'react-i18next';
import { listOrders } from '../../api';
import type { Order } from '../../api/types';
import { usePagedList } from '../../hooks/usePagedList';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { Pill } from '../../components/Pill';
import { Amount, Num } from '../../components/Num';
import { orderTone } from '../../utils/status';
import { shortTime } from '../../utils/display';
import { TradeFilters, type TradeFilterValues } from './TradeFilters';

export function OrdersPage() {
  const { t } = useTranslation();
  const list = usePagedList<Order, TradeFilterValues>(listOrders, {});
  return (
    <>
      <PageHeader title={t('orders.title')} sub={t('orders.sub')} />
      <TradeFilters onChange={list.setFilters} withStatus />
      <DataTable<Order>
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
          { title: t('orders.id'), dataIndex: 'id', render: (v: string) => <Num>{v}</Num> },
          { title: t('funds.user'), key: 'u', render: (_, r) => <div className="user-cell"><b title={r.customerName}>{r.customerName}</b><small>ID {r.customerId}</small></div> },
          { title: t('trading.symbol'), dataIndex: 'symbol', render: (v: string) => <b>{v}</b> },
          { title: t('trading.side'), dataIndex: 'side', render: (v: string) => <span className={v === 'buy' ? 'up' : 'down'}>{t(`side.${v}`)}</span> },
          { title: t('orders.type'), dataIndex: 'type', render: (v: string) => t(`orderType.${v}`) },
          { title: t('trading.lots'), dataIndex: 'lots', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('orders.price'), dataIndex: 'price', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('trading.leverage'), dataIndex: 'leverage', align: 'right', render: (v: number) => <Num>{v}x</Num> },
          { title: t('orders.fee'), dataIndex: 'fee', align: 'right', render: (v: string) => <Amount value={v} /> },
          {
            title: t('trading.status'),
            dataIndex: 'status',
            render: (v: string, r) => (
              <span className="nowrap">
                <Pill tone={orderTone[v]}>{t(`orderStatus.${v}`)}</Pill>
                {r.rejectReason ? <span className="muted"> · {t(`rejectReason.${r.rejectReason}`)}</span> : null}
              </span>
            ),
          },
          { title: t('orders.createdAt'), dataIndex: 'createdAt', render: (v: string) => <Num>{shortTime(v)}</Num> },
        ]}
      />
    </>
  );
}
