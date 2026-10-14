/** 首页：账户概览、热门品种滚动条、前几个持仓、最近通知。 */
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { listNotifications } from '../api/notifications';
import { useAccount, useSymbols } from '../app/contexts';
import { EmptyState, ErrorState, Loading } from '../components/AsyncView';
import { Icon, Logo } from '../components/Icon';
import { PositionsTabs } from '../components/PositionsTabs';
import { currentLang } from '../i18n';
import { useAsync } from '../hooks/useAsync';
import { useQuotes } from '../hooks/useQuotes';
import { useServerEvent } from '../hooks/useServerEvent';
import { useUnread } from '../hooks/useUnread';
import { cmp, ZERO } from '../lib/decimal';
import { formatAmount, formatDateTime, formatPercent, formatPrice } from '../lib/format';
import { changePercent, marginLevelTone } from '../lib/trading';
import { symbolName } from '../lib/symbol';

function AccountOverview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { metrics, loading, error, reload } = useAccount();
  if (error && !metrics) return <section className="card"><ErrorState error={error} onRetry={reload} compact /></section>;
  if (loading || !metrics) return <section className="card"><Loading rows={2} /></section>;
  const tone = marginLevelTone(metrics.marginLevel);
  return (
    <section className="card overview" aria-labelledby="ov-title">
      <div className="ov-k" id="ov-title">
        {t('account.equity')} <span className="unit">USDT</span>
      </div>
      <div className="ov-big num">{formatAmount(metrics.equity)}</div>
      <div className={`ov-pnl num ${cmp(metrics.floatingPnl, ZERO) < 0 ? 'down' : 'up'}`}>
        {t('positions.floating')} {formatAmount(metrics.floatingPnl, { sign: true })}
      </div>
      <div className="ov-row">
        <div>
          {t('account.available')}
          <span className="num">{formatAmount(metrics.available)}</span>
        </div>
        <div>
          {t('account.usedMargin')}
          <span className="num">{formatAmount(metrics.usedMargin)}</span>
        </div>
        <div>
          {t('account.marginLevel')}
          <span className={`num tone-${tone}`}>
            {metrics.marginLevel ? formatPercent(metrics.marginLevel, { dp: 1 }) : t('account.noPosition')}
            {metrics.marginLevel && <span className={`pill pill-${tone}`}>{t(`account.level.${tone}`)}</span>}
          </span>
        </div>
      </div>
      <div className="ov-acts">
        <button type="button" className="btn btn-primary" onClick={() => navigate('/assets')}>
          <Icon name="deposit" size={16} strokeWidth={2.2} />
          {t('assets.deposit')}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/assets/withdraw')}>
          <Icon name="withdraw" size={16} strokeWidth={2.2} />
          {t('assets.withdraw')}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/trade')}>
          <Icon name="trade" size={16} strokeWidth={2.2} />
          {t('nav.trade')}
        </button>
      </div>
    </section>
  );
}

function HotTicker() {
  const { t, i18n } = useTranslation();
  const { list, loading } = useSymbols();
  const quotes = useQuotes();
  const hot = list.filter((s) => s.hot);
  if (loading && !list.length) return <div className="ticker"><Loading rows={1} /></div>;
  if (!hot.length) return <div className="ticker empty">{t('home.noHot')}</div>;
  const items = hot.map((s) => {
    const q = quotes[s.code];
    const chg = q ? changePercent(q.open, q.bid) : null;
    return (
      <Link key={s.code} to={`/trade/${s.code}`} className="tick-item">
        <b className="num">{s.code}</b>
        <small>{symbolName(s, i18n.language)}</small>
        <span className="num">{q ? formatPrice(q.bid, s.digits) : '—'}</span>
        <span className={`num ${chg && cmp(chg, ZERO) < 0 ? 'down' : 'up'}`}>{chg ? formatPercent(chg, { sign: true }) : '—'}</span>
      </Link>
    );
  });
  return (
    <section className="ticker" aria-label={t('home.hot')}>
      <div className="ticker-track">
        <div className="ticker-group">{items}</div>
        <div className="ticker-group" aria-hidden="true">
          {items}
        </div>
      </div>
    </section>
  );
}

function RecentNotifications() {
  const { t } = useTranslation();
  const s = useAsync(() => listNotifications(currentLang(), 1, 3), `home-notes|${currentLang()}`);
  useServerEvent((e) => e.type === 'notification' && s.reload());
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('home.recentNotifications')}</h2>
        <Link to="/me/notifications" className="more">
          {t('common.viewAll')}
          <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      {s.error && !s.data ? (
        <ErrorState error={s.error} onRetry={s.reload} compact />
      ) : !s.data ? (
        <Loading rows={2} />
      ) : s.data.items.length === 0 ? (
        <EmptyState compact title={t('notifications.empty')} />
      ) : (
        <ul className="note-list">
          {s.data.items.map((n) => (
            <li key={n.id} className={n.read ? '' : 'unread'}>
              <Link to="/me/notifications">
                <b>{n.title}</b>
                <span className="note-body">{n.body}</span>
                <small className="num">{formatDateTime(n.createdAt, { short: true })}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unread = useUnread();
  return (
    <div className="page page-home">
      <div className="home-head">
        <div className="brand">
          <Logo />
          FalconX<small>Lite</small>
        </div>
        <Link to="/me/notifications" className="icon-btn" aria-label={t('me.notifications')}>
          <Icon name="bell" />
          {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </Link>
      </div>
      <HotTicker />
      <div className="home-grid">
        <div className="home-main">
          <AccountOverview />
          <section className="card flush">
            <div className="card-head pad">
              <h2>{t('home.myPositions')}</h2>
              <Link to="/trade" className="more">
                {t('home.goTrade')}
                <Icon name="chevronRight" size={14} />
              </Link>
            </div>
            <PositionsTabs limit={3} onSelectSymbol={(c) => navigate(`/trade/${c}`)} />
          </section>
        </div>
        <div className="home-side">
          <RecentNotifications />
        </div>
      </div>
    </div>
  );
}
