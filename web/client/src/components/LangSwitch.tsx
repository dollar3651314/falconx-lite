import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';
import { Icon } from './Icon';

/** 登录页右上角的语言切换 */
export function LangSwitch() {
  const { i18n, t } = useTranslation();
  const next = i18n.language === 'en' ? 'zh-CN' : 'en';
  return (
    <button type="button" className="btn btn-ghost btn-sm lang-switch" onClick={() => void setLanguage(next)} aria-label={t('me.language')}>
      <Icon name="globe" size={16} />
      {next === 'en' ? 'English' : '中文'}
    </button>
  );
}
