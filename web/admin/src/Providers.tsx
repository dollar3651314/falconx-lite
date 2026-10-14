import type { ReactNode } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import { antdTheme } from './theme';
import { AuthProvider } from './auth/AuthContext';

/** 全局 Provider：主题、Ant Design 语言包、消息提示、登录状态 */
export function Providers({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <ConfigProvider theme={antdTheme} locale={i18n.language.startsWith('zh') ? zhCN : enUS}>
      <AntApp>
        <AuthProvider>{children}</AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}
