/** 资产（效果图 M3）：余额 / 冻结 / 净值；充值；最近资金流水。 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { listLedger } from '../../api/wallet';
import { useAccount } from '../../app/contexts';
import { AsyncView, EmptyState, ErrorState, Loading } from '../../components/AsyncView';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/Layout';
import { useAsync } from '../../hooks/useAsync';
import { useServerEvent } from '../../hooks/useServerEvent';
import { formatAmount } from '../../lib/format';
import { DepositCard } from './DepositCard';
import { LedgerList } from './LedgerList';

function Overview() {
  const { t } = useTranslation();
  const { metrics, error, loading, reload } = useAccount();
  const [hidden, setHidden] = useState(false);
  const show = (v: Parameters<typeof formatAmount>[0]) => (hidden ? '****' : formatAmount(v));
  if (error && !metrics) return <section className="card"><ErrorState error={error} onRetry={reload} compact /></section>;
  if (loading || !metrics) return <section className="card"><Loading rows={2} /></section>;
  return (
    <section className="card overview">
      <div className="ov-k">
        {t('assets.balance')}
        <button type="button" className="icon-btn sm" onClick={() => setHidden((h) => !h)} aria-pressed={hidden} aria-label={hidden ? t('assets.showAmounts') : t('assets.hideAmounts')}>
          <Icon name="eye" size={15} />
        </button>
      </div>
      <div className="ov-big num">
        {show(metrics.balance)}
        <small>USDT</small>
      </div>
      <div className="ov-row">
        <div>
          {t('assets.frozenWithdraw')}
          <span className="num">{show(metrics.withdrawFrozen)}</span>
        </div>
        <div>
          {t('account.usedMargin')}
          <span className="num">{show(metrics.usedMargin)}</span>
        </div>
        <div>
          {t('account.equity')}
          <span className="num">{show(metrics.equity)}</span>
        </div>
      </div>
      <div className="ov-row">
        <div>
          {t('assets.frozenOrders')}
          <span className="num">{show(metrics.orderFrozen)}</span>
        </div>
        <div>
          {t('account.available')}
          <span className="num">{show(metrics.available)}</span>
        </div>
        <div />
      </div>
    </section>
  );
}

export default function Assets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const recent = useAsync(() => listLedger({ type: 'all', range: 'all', page: 1, pageSize: 5 }), 'ledger-recent');
  useServerEvent((e) => e.type === 'account' && recent.reload());
  return (
    <div className="page page-assets">
      <PageHeader title={t('nav.assets')} />
      <div className="assets-grid">
        <div>
          <Overview />
          <nav className="acts" aria-label={t('assets.actions')}>
            <a href="#dep-title" className="on">
              <Icon name="deposit" size={16} strokeWidth={2.2} />
              {t('assets.deposit')}
            </a>
            <button type="button" onClick={() => navigate('/assets/withdraw')}>
              <Icon name="withdraw" size={16} strokeWidth={2.2} />
              {t('assets.withdraw')}
            </button>
            <button type="button" onClick={() => navigate('/assets/ledger')}>
              <Icon name="list" size={16} strokeWidth={2.2} />
              {t('assets.ledger')}
            </button>
          </nav>
          <DepositCard />
        </div>
        <section className="card">
          <div className="card-head">
            <h2>{t('assets.ledger')}</h2>
            <Link to="/assets/ledger" className="more">
              {t('ledger.filterAll')}
              <Icon name="chevronRight" size={14} />
            </Link>
          </div>
          <AsyncView state={recent} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title={t('ledger.empty')} hint={t('ledger.emptyHint')} />}>
            {(d) => <LedgerList items={d.items} />}
          </AsyncView>
        </section>
      </div>
    </div>
  );
}
