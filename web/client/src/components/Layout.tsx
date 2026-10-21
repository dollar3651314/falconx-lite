/**
 * 登录后的整体布局：顶部原型横幅（只在 mock 模式）或测试环境标识条（只在 real 模式且后端返回了 env，S20）；手机为底部 5 个导航（行情 / 交易 / 持仓 / 资产 / 我的，U4），
 * 桌面（≥1024）为顶部导航（持仓在交易页里，不单列）；1280 宽以上顶部导航中间有热门品种跑马灯（E4，HotTicker）。
 * 体验优化 1021（原型模式，`lib/ux1021.ts`）：电脑顶栏去掉"我的"（右上角头像进"我的"）和跑马灯，新客户自动弹出新手引导。
 */
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IS_MOCK } from '../api/mode';
import { useAccount } from '../app/contexts';
import { useUnread } from '../hooks/useUnread';
import { formatAmount, formatPercent } from '../lib/format';
import { marginLevelTone } from '../lib/trading';
import { UX1021 } from '../lib/ux1021';
import { Onboarding } from './Onboarding';
import { EnvBanner } from './EnvBanner';
import { BRAND_NAME } from '../lib/brand';
import { HotTicker } from './HotTicker';
import { Brand, Icon, type IconName } from './Icon';
import { ProtoPanel } from './ProtoPanel';
import { PushListener } from './PushListener';

// 体验优化 1021 第 4 条：电脑顶栏的"我的"和右上角头像重复，去掉"我的"、保留头像（手机底部导航没有头像，照旧保留"我的"）
const NAV: Array<{ to: string; key: string; icon: IconName; desktop: boolean }> = [
  { to: '/markets', key: 'nav.markets', icon: 'markets', desktop: true },
  { to: '/trade', key: 'nav.trade', icon: 'trade', desktop: true },
  { to: '/positions', key: 'nav.positions', icon: 'positions', desktop: false },
  { to: '/assets', key: 'nav.assets', icon: 'assets', desktop: true },
  { to: '/me', key: 'nav.me', icon: 'me', desktop: !UX1021 },
];

/** 原型横幅：只在 mock 模式显示 */
export function ProtoBanner() {
  const { t } = useTranslation();
  if (!IS_MOCK) return null;
  return (
    <div className="proto-banner" role="note">
      <Icon name="flask" size={12} strokeWidth={2.2} />
      {t('proto.banner')}
    </div>
  );
}

function TopAccount() {
  const { t } = useTranslation();
  const { metrics, error } = useAccount();
  const tone = marginLevelTone(metrics?.marginLevel ?? null);
  const dash = error ? '—' : undefined;
  return (
    <div className="top-acc">
      <div>
        {t('account.equity')}
        <span className="num">{dash ?? formatAmount(metrics?.equity)}</span>
      </div>
      <div>
        {t('account.available')}
        <span className="num">{dash ?? formatAmount(metrics?.available)}</span>
      </div>
      <div>
        {t('account.marginLevel')}
        <span className={`num tone-${tone}`}>{dash ?? (metrics ? (metrics.marginLevel ? formatPercent(metrics.marginLevel, { dp: 1 }) : t('account.noPosition')) : '—')}</span>
      </div>
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unread = useUnread();
  return (
    <div className={UX1021 ? 'app ux1021' : 'app'}>
      <ProtoBanner />
      <EnvBanner />
      <header className="topnav">
        <NavLink to="/markets" className="brand" aria-label={BRAND_NAME}>
          <Brand />
        </NavLink>
        <nav className="topnav-menu" aria-label={t('nav.main')}>
          {NAV.filter((n) => n.desktop).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
        {/* 体验优化 1021 第 10 条：客户端不放跑马灯（看 K 线时分神），官网保留 */}
        {UX1021 ? <div className="topnav-spacer" /> : <HotTicker />}
        <TopAccount />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/assets')}>
          {t('assets.deposit')}
        </button>
        <NavLink to="/me/notifications" className="icon-btn" aria-label={t('me.notifications')}>
          <Icon name="bell" />
          {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </NavLink>
        <NavLink to="/me" className="avatar" aria-label={t('nav.me')} title={t('nav.me')}>
          <Icon name="user" size={16} />
        </NavLink>
      </header>
      <main className="main" id="main">
        <Outlet />
      </main>
      <nav className="bottomnav" aria-label={t('nav.main')}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'on' : '')}>
            <span className="bn-icon">
              <Icon name={n.icon} size={22} />
              {n.to === '/me' && unread > 0 && <span className="badge dot" aria-label={t('notifications.unreadCount', { count: unread })} />}
            </span>
            {t(n.key)}
          </NavLink>
        ))}
      </nav>
      <ProtoPanel />
      <PushListener />
      {UX1021 && <Onboarding />}
    </div>
  );
}

/** 页面标题栏（手机）；桌面上显示为页面内标题 */
export function PageHeader({ title, back, right }: { title: string; back?: string | boolean; right?: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="page-head">
      {back && (
        <button type="button" className="icon-btn back" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))} aria-label={t('common.back')}>
          <Icon name="back" size={22} strokeWidth={2.2} />
        </button>
      )}
      <h1>{title}</h1>
      {right && <div className="page-head-right">{right}</div>}
    </div>
  );
}
