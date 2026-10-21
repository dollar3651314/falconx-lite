/**
 * 已平仓记录的表格列（体验优化 1021 UX-6 部分平仓）：交易监控"持仓 → 已平仓"和客户详情"最近平仓"共用。
 * 部分平仓拆出来的记录在编号下标"部分平仓"，并显示原持仓编号（parentId）；整笔平仓不标。
 */
import type { TFunction } from 'i18next';
import type { ColumnsType } from 'antd/es/table';
import type { ClosedPosition } from '../../api/types';
import { Amount, Num } from '../../components/Num';
import { Pill } from '../../components/Pill';
import { shortTime } from '../../utils/display';

export function closedColumns(t: TFunction, opt: { withCustomer: boolean }): ColumnsType<ClosedPosition> {
  return [
    {
      title: t('trading.positionId'),
      dataIndex: 'id',
      render: (_: string, r) => (
        <div className="closed-id">
          <Num>{r.id}</Num>
          {r.partial && r.parentId ? (
            <small data-testid="partial-tag">
              <Pill tone="info">{t('positions.partial')}</Pill> <span className="muted">{t('positions.fromPosition', { id: r.parentId })}</span>
            </small>
          ) : null}
        </div>
      ),
    },
    ...(opt.withCustomer
      ? [
          {
            title: t('funds.user'),
            key: 'u',
            render: (_: unknown, r: ClosedPosition) => (
              <div className="user-cell">
                <b title={r.customerName}>{r.customerName}</b>
                <small>ID {r.customerId}</small>
              </div>
            ),
          },
        ]
      : []),
    { title: t('trading.symbol'), dataIndex: 'symbol', render: (v: string) => <b>{v}</b> },
    { title: t('trading.side'), dataIndex: 'side', render: (v: string) => <span className={v === 'buy' ? 'up' : 'down'}>{t(`side.${v}`)}</span> },
    { title: t('trading.lots'), dataIndex: 'lots', align: 'right', render: (v: string) => <Num>{v}</Num> },
    { title: t('trading.openPrice'), dataIndex: 'openPrice', align: 'right', render: (v: string) => <Num>{v}</Num> },
    { title: t('positions.closePrice'), dataIndex: 'closePrice', align: 'right', render: (v: string) => <Num>{v}</Num> },
    { title: t('positions.realizedPnl'), dataIndex: 'pnl', align: 'right', render: (v: string) => <Amount value={v} signed /> },
    { title: t('positions.reason'), dataIndex: 'reason', render: (v: string) => t(`positions.reasons.${v}`) },
    { title: t('positions.closedAt'), dataIndex: 'closedAt', render: (v: string) => <Num>{shortTime(v)}</Num> },
  ];
}
