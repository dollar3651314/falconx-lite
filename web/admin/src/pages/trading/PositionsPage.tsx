/**
 * 持仓监控：保证金水平、强平价；手动强平（高危，二次确认，写审计）。
 */
import { Alert } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { liquidatePosition, listPositions } from '../../api';
import type { Position } from '../../api/types';
import { usePagedList } from '../../hooks/usePagedList';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Amount, Num } from '../../components/Num';
import { compareAmounts, formatAmount } from '../../utils/money';
import { shortTime } from '../../utils/display';
import { TradeFilters, type TradeFilterValues } from './TradeFilters';

export function PositionsPage() {
  const { t } = useTranslation();
  const list = usePagedList<Position, TradeFilterValues>(listPositions, {});
  const hr = useHighRisk();

  const liquidate = (p: Position) =>
    hr.ask({
      title: t('positions.liquidate'),
      description: t('positions.liquidateDesc', { id: p.id, name: p.customerName, symbol: p.symbol, side: t(`side.${p.side}`), lots: p.lots, pnl: formatAmount(p.pnl, { showPlus: true }) }),
      confirmText: t('positions.confirmLiquidate'),
      successText: t('positions.liquidated'),
      onConfirm: (v) => liquidatePosition(p.id, v.reason),
      onDone: list.reload,
    });

  return (
    <>
      <PageHeader title={t('positions.title')} sub={t('positions.sub')} />
      <Alert type="info" showIcon message={t('positions.hint')} />
      <TradeFilters onChange={list.setFilters} />
      <DataTable<Position>
        rowKey="id"
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        dataSource={list.data?.items}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.onPageChange}
        rowClassName={(r) => (r.marginLevel && compareAmounts(r.marginLevel, '100') < 0 ? 'row-alert' : '')}
        columns={[
          { title: t('trading.positionId'), dataIndex: 'id', render: (v: string) => <Num>{v}</Num> },
          { title: t('funds.user'), key: 'u', render: (_, r) => <div className="user-cell"><b title={r.customerName}>{r.customerName}</b><small>ID {r.customerId}</small></div> },
          { title: t('trading.symbol'), dataIndex: 'symbol', render: (v: string) => <b>{v}</b> },
          { title: t('trading.side'), dataIndex: 'side', render: (v: string) => <span className={v === 'buy' ? 'up' : 'down'}>{t(`side.${v}`)}</span> },
          { title: t('trading.lots'), dataIndex: 'lots', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('trading.openPrice'), dataIndex: 'openPrice', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('trading.leverage'), dataIndex: 'leverage', align: 'right', render: (v: number) => <Num>{v}x</Num> },
          { title: t('trading.margin'), dataIndex: 'margin', align: 'right', render: (v: string) => <Amount value={v} /> },
          { title: t('trading.pnl'), dataIndex: 'pnl', align: 'right', render: (v: string) => <Amount value={v} signed /> },
          {
            title: t('positions.marginLevel'),
            dataIndex: 'marginLevel',
            align: 'right',
            // 没有报价时后端返回空（真实接口）
            render: (v: string | null) => (v ? <Num className={compareAmounts(v, '100') < 0 ? 'down strong' : ''}>{formatAmount(v)}%</Num> : '—'),
          },
          { title: t('positions.liqPrice'), dataIndex: 'liquidationPrice', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('positions.slTp'), key: 'sltp', render: (_, r) => <Num>{r.stopLoss ?? '—'} / {r.takeProfit ?? '—'}</Num> },
          { title: t('trading.openedAt'), dataIndex: 'openedAt', render: (v: string) => <Num>{shortTime(v)}</Num> },
          {
            title: t('common.actions'),
            key: 'op',
            fixed: 'right',
            render: (_, r) => (
              <PermButton perm="position:liquidate" size="small" danger icon={<ThunderboltOutlined />} onClick={() => liquidate(r)}>
                {t('positions.liquidate')}
              </PermButton>
            ),
          },
        ]}
      />
      {hr.element}
    </>
  );
}
