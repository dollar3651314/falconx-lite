import { useId } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Quick Come 文字 Logo（v2，《v2-官网风格调研》方向 A：青色渐变圆角方块 + 深色"Q"，后面是品牌名）。
 * 和客户端、public/favicon.svg 是同一个图形；内联 SVG，不加载外部资源。品牌名不翻译。
 */
export function Logo({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const id = `qc-g-${useId().replace(/:/g, '')}`;
  return (
    <div className="logo">
      <svg className="logo-mark" width="24" height="24" viewBox="0 0 512 512" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="112" fill={`url(#${id})`} />
        <circle cx="248" cy="240" r="112" fill="none" stroke="#04121a" strokeWidth="56" />
        <path d="M318 310 384 376" stroke="#04121a" strokeWidth="60" strokeLinecap="round" />
      </svg>
      <span>Quick Come</span>
      {!compact ? <small>{t('app.adminConsole')}</small> : null}
    </div>
  );
}
