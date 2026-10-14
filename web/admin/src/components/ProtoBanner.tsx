import { useTranslation } from 'react-i18next';

/** 原型标识：页面顶部固定的细横幅，不能关闭 */
export function ProtoBanner() {
  const { t } = useTranslation();
  return (
    <div className="proto-banner" role="note">
      {t('proto.banner')}
    </div>
  );
}
