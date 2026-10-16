/**
 * 每个页面都有的部分：测试环境标识、顶部风险提示条、导航（电脑、手机两套）、页脚、手机底部固定的"登录 | 免费注册"。
 */
import { useEffect, useState } from 'react';
import { fetchEnvLabel } from '../api/envLabel';
import { Link } from '../app/router';
import { clientLink, CONTACT_EMAIL } from '../config';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

export function EnvBanner() {
  const { t } = useI18n();
  const [env, setEnv] = useState('');
  useEffect(() => {
    let alive = true;
    void fetchEnvLabel().then((v) => alive && setEnv(v));
    return () => {
      alive = false;
    };
  }, []);
  if (!env) return null;
  return (
    <div className="env-banner" role="note" data-testid="env-banner">
      {t('common.envTest')}
    </div>
  );
}

export function RiskBar({ short }: { short?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="risk-bar" role="note" data-testid="risk-bar">
      {t(short ? 'risk.barShort' : 'risk.bar')}
      <Link to="risk">{t('risk.link')}</Link>
    </div>
  );
}

export function Logo() {
  return (
    <Link to="home" className="logo" data-testid="logo">
      <span className="mark" aria-hidden="true">
        Q
      </span>
      <span className="word">Quick Come</span>
    </Link>
  );
}

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t('common.langLabel')} data-testid="lang-switch">
      <button type="button" aria-pressed={lang === 'zh-CN'} onClick={() => setLang('zh-CN')} lang="zh-CN">
        中
      </button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">
        EN
      </button>
    </div>
  );
}

/** 首页的几个区块（导航锚点） */
export const SECTIONS = [
  ['markets', 'nav.markets'],
  ['products', 'nav.products'],
  ['platform', 'nav.platform'],
  ['safety', 'nav.safety'],
  ['faq', 'nav.faq'],
] as const;

export function HeaderDesktop() {
  const { t, lang } = useI18n();
  return (
    <header className="top">
      <div className="wrap">
        <Logo />
        <nav aria-label="main">
          {SECTIONS.map(([id, key]) => (
            <Link key={id} to="home" hash={id}>
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="right">
          <LangSwitch />
          <a className="btn sec sm" href={clientLink('login', lang)} data-testid="nav-login">
            {t('common.login')}
          </a>
          <a className="btn pri sm" href={clientLink('register', lang)} data-testid="nav-register">
            {t('common.register')}
          </a>
        </div>
      </div>
    </header>
  );
}

export function HeaderMobile() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="top">
        <Logo />
        <div className="right">
          <LangSwitch />
          <button type="button" className="menu-btn" aria-label={t(open ? 'common.close' : 'common.menu')} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="menu-btn">
            <Icon name={open ? 'close' : 'menu'} />
          </button>
        </div>
      </header>
      {open && (
        <div className="drawer" onClick={() => setOpen(false)} data-testid="menu">
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            {SECTIONS.map(([id, key]) => (
              <Link key={id} to="home" hash={id} className="nav" onClick={() => setOpen(false)}>
                {t(key)}
              </Link>
            ))}
            <a className="btn sec" href={clientLink('login', lang)}>
              {t('common.login')}
            </a>
          </div>
        </div>
      )}
    </>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer data-testid="footer">
      <div className="wrap">
        <Logo />
        <div className="links">
          <Link to="terms">{t('footer.terms')}</Link>
          <Link to="privacy">{t('footer.privacy')}</Link>
          <Link to="risk">{t('footer.risk')}</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} data-testid="contact">
            {t('footer.contact', { email: CONTACT_EMAIL })}
          </a>
        </div>
        <p className="risk-full" data-testid="footer-risk">
          {t('risk.full')}
        </p>
        <div className="meta">
          <span className="tbd">
            {t('footer.company')} · {t('safe.license')}
          </span>
          <span>{t('footer.copyright')}</span>
        </div>
      </div>
    </footer>
  );
}

export function StickyCta() {
  const { t, lang } = useI18n();
  return (
    <div className="sticky-cta" data-testid="sticky-cta">
      <a className="btn sec" href={clientLink('login', lang)} data-testid="sticky-login">
        {t('common.login')}
      </a>
      <a className="btn pri" href={clientLink('register', lang)} data-testid="sticky-register">
        {t('common.register')}
      </a>
    </div>
  );
}
