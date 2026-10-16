import { useMemo, type ReactNode } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import { buildAntdTheme } from './theme';
import { AuthProvider } from './auth/AuthContext';
import { ThemeModeProvider, useThemeMode } from './hooks/useThemeMode';

/** Ant Design 的主题跟着浅色 / 深色切换（v2 E2）：表格、弹窗、抽屉、下拉、提示都由 ConfigProvider 统一换色 */
function ThemedConfig({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const { theme } = useThemeMode();
  const config = useMemo(() => buildAntdTheme(theme), [theme]);
  return (
    <ConfigProvider theme={config} button={{ autoInsertSpace: false }} locale={i18n.language.startsWith('zh') ? zhCN : enUS}>
      <AntApp>
        <AuthProvider>{children}</AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}

/** 全局 Provider：浅色 / 深色主题、Ant Design 语言包、消息提示、登录状态 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <ThemedConfig>{children}</ThemedConfig>
    </ThemeModeProvider>
  );
}
