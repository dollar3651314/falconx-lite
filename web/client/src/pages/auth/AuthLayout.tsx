import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../../components/Icon';
import { ProtoBanner } from '../../components/Layout';
import { LangSwitch } from '../../components/LangSwitch';
import { ProtoPanel } from '../../components/ProtoPanel';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="auth">
      <ProtoBanner />
      <div className="auth-top">
        <div className="brand">
          <Logo />
          FalconX<small>Lite</small>
        </div>
        <LangSwitch />
      </div>
      <main className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="auth-foot">{footer}</div>}
        <p className="auth-risk">{t('auth.riskNotice')}</p>
      </main>
      <ProtoPanel />
    </div>
  );
}
