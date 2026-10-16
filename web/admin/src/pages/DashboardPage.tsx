/**
 * 仪表盘：今日注册、今日入金和出金、持仓数、平台盈亏、平台总净敞口和阈值、待审核 KYC 和出金数。
 * v2 E7：每 30 秒自动刷新（汇总数字，不需要和风控看板一样快），可暂停，页面不可见时停止。
 */
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getDashboard } from '../api';
import { useApi } from '../hooks/useApi';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { AutoRefreshControl } from '../components/AutoRefreshControl';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { Amount, Num } from '../components/Num';
import { formatAmount, usagePercent } from '../utils/money';
import { fullTime } from '../utils/display';
import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fetcher = useCallback(() => getDashboard(), []);
  const { data, loading, error, reload, refresh } = useApi(fetcher);
  const auto = useAutoRefresh(refresh, 30_000);

  const usage = data ? usagePercent(data.platformNetExposure, data.platformThreshold) : 0;

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        sub={data ? t('dashboard.updatedAt', { time: fullTime(data.updatedAt) }) : t('dashboard.sub')}
        extra={
          <>
            <AutoRefreshControl auto={auto} />
            <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
              {t('common.refresh')}
            </Button>
          </>
        }
      />
      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <div className="card card-pad">
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : (
        <>
          <section className="kpis" aria-label={t('dashboard.todo')}>
            <div className="card kpi orange">
              <div className="k">{t('dashboard.pendingKyc')}</div>
              <div className="v">
                <b>{t('common.countItems', { count: data.pendingKyc })}</b>
                {can('kyc:view') ? <Link className="kpi-link" to="/kyc">{t('dashboard.goReview')}</Link> : null}
              </div>
            </div>
            <div className="card kpi orange">
              <div className="k">{t('dashboard.pendingWithdrawals')}</div>
              <div className="v">
                <b>{t('common.countUnit', { count: data.pendingWithdrawals })}</b>
                {can('withdrawal:view') ? <Link className="kpi-link" to="/funds/withdrawals">{t('dashboard.goReview')}</Link> : null}
              </div>
            </div>
            <div className={`card kpi ${data.failedTasks > 0 ? 'red' : ''}`}>
              <div className="k">{t('dashboard.failedTasks')}</div>
              <div className="v">
                <b>{t('common.countItems', { count: data.failedTasks })}</b>
                {can('task:view') ? <Link className="kpi-link" to="/funds/tasks">{t('common.view')}</Link> : null}
              </div>
            </div>
            <div className={`card kpi ${data.openReconciliations > 0 ? 'red' : ''}`}>
              <div className="k">{t('dashboard.openRecon')}</div>
              <div className="v">
                <b>{t('common.countItems', { count: data.openReconciliations })}</b>
                {can('recon:view') ? <Link className="kpi-link" to="/funds/reconciliation">{t('common.view')}</Link> : null}
              </div>
            </div>
          </section>

          <section className="detail-grid" aria-label={t('dashboard.today')}>
            <div className="card stat">
              <div className="k">{t('dashboard.todayRegistrations')}</div>
              <div className="v">{data.todayRegistrations}</div>
              <div className="muted">{t('dashboard.online', { count: data.onlineCustomers })}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('dashboard.todayDeposit')}</div>
              <div className="v">
                <Amount value={data.todayDeposit} /> <small className="muted">USDT</small>
              </div>
              <div className="muted">{t('dashboard.txCount', { count: data.todayDepositCount })}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('dashboard.todayWithdraw')}</div>
              <div className="v">
                <Amount value={data.todayWithdraw} /> <small className="muted">USDT</small>
              </div>
              <div className="muted">{t('dashboard.txCount', { count: data.todayWithdrawCount })}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('dashboard.openPositions')}</div>
              <div className="v">{data.openPositions}</div>
              <div className="muted">{t('dashboard.positionsHint')}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('dashboard.platformPnl')}</div>
              <div className="v">
                <Amount value={data.platformPnl} signed /> <small className="muted">USDT</small>
              </div>
              <div className="muted">{t('dashboard.pnlHint')}</div>
            </div>
            <div className="card stat span2">
              <div className="k">{t('dashboard.netExposure')}</div>
              <div className="v">
                <Num>{formatAmount(data.platformNetExposure, { decimals: 0 })}</Num> <small className="muted">USD · {usage}%</small>
              </div>
              <div className={`bar ${usage >= 100 ? 'over' : usage >= 80 ? 'warn' : ''}`} style={{ margin: '6px 0' }}>
                <i style={{ width: `${Math.min(usage, 100)}%` }} />
              </div>
              <div className="muted">
                {t('dashboard.threshold')} <Num>{formatAmount(data.platformThreshold, { decimals: 0 })}</Num> USD
                {can('risk:view') ? (
                  <>
                    {' · '}
                    <Link to="/risk">{t('dashboard.goRisk')}</Link>
                  </>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
