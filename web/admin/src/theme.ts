/**
 * Ant Design 主题：颜色、圆角、字号取自效果图 M6、M7 的设计 token。
 * 白底上的主色文字和按钮用 cyan-700 #0e7490（满足 WCAG AA 4.5:1）。
 */
import type { ThemeConfig } from 'antd';

export const tokens = {
  bg: '#f4f7fb',
  s1: '#ffffff',
  s2: '#f8fafc',
  s3: '#eef5f9',
  border: 'rgba(15,23,42,.12)',
  hair: 'rgba(15,23,42,.07)',
  text: '#0f172a',
  muted: '#475569',
  subtle: '#64748b',
  primary: '#0891b2',
  primaryDeep: '#0e7490',
  long: '#15803d',
  short: '#dc2626',
  warn: '#b45309',
  risk: '#c2410c',
  danger: '#b91c1c',
  sans: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Hiragino Sans GB","WenQuanYi Zen Hei",sans-serif',
  mono: '"JetBrains Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono","DejaVu Sans Mono",monospace',
};

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: tokens.primaryDeep,
    colorInfo: tokens.primaryDeep,
    colorLink: tokens.primaryDeep,
    colorSuccess: tokens.long,
    colorWarning: tokens.warn,
    colorError: tokens.danger,
    colorText: tokens.text,
    colorTextSecondary: tokens.muted,
    colorTextTertiary: tokens.subtle,
    colorTextDescription: tokens.subtle,
    colorTextPlaceholder: tokens.subtle,
    colorBgLayout: tokens.bg,
    colorInfoBg: '#ecfeff',
    colorInfoBorder: '#a5f3fc',
    colorWarningBg: '#fff7ed',
    colorWarningBorder: '#fdba74',
    colorErrorBg: '#fef2f2',
    colorErrorBorder: '#fecaca',
    colorSuccessBg: '#f0fdf4',
    colorSuccessBorder: '#bbf7d0',
    colorBorder: 'rgba(15,23,42,.16)',
    colorBorderSecondary: tokens.hair,
    borderRadius: 6,
    borderRadiusLG: 8,
    fontSize: 13,
    fontFamily: tokens.sans,
    fontFamilyCode: tokens.mono,
  },
  components: {
    Layout: { headerBg: '#ffffff', siderBg: '#ffffff', bodyBg: tokens.bg, headerHeight: 52, headerPadding: '0 20px 0 16px' },
    Menu: {
      itemSelectedBg: 'rgba(8,145,178,.10)',
      itemSelectedColor: tokens.primaryDeep,
      itemColor: tokens.muted,
      itemHeight: 38,
      subMenuItemBg: '#ffffff',
      itemMarginInline: 8,
    },
    Table: { headerBg: tokens.s3, headerColor: tokens.muted, cellPaddingBlock: 9, cellPaddingInline: 10, headerSplitColor: 'transparent', rowSelectedBg: 'rgba(8,145,178,.07)', rowHoverBg: '#f3f8fb' },
    Card: { paddingLG: 16 },
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
    Tag: { defaultBg: tokens.s3 },
  },
};
