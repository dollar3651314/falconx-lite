import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Result
      status="404"
      title={t('errors.notFoundTitle')}
      subTitle={t('errors.notFoundPage')}
      extra={
        <Link to="/">
          <Button type="primary">{t('common.backHome')}</Button>
        </Link>
      }
    />
  );
}
