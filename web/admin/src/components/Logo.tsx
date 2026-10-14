import { useTranslation } from 'react-i18next';

/** FalconX 标志（与效果图一致的内联 SVG，不加载外部资源） */
export function Logo({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="logo">
      <svg width="28" height="17" viewBox="0 0 160 96" aria-hidden>
        <path d="M80 39 10 8l28 45-24 35 66-28 66 28-24-35 28-45-70 31Z" fill="#0e7490" />
        <path d="M80 52 66 75h28L80 52Z" fill="#0e7490" opacity=".88" />
      </svg>
      <span>FalconX</span>
      {!compact ? <small>{t('app.adminConsole')}</small> : null}
    </div>
  );
}
