/** 行情：分类、搜索、50 个品种，报价每秒跳动（模拟）。 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { SymbolList } from '../components/SymbolList';

export default function Markets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="page page-markets">
      <PageHeader title={t('nav.markets')} />
      <div className="card flush">
        <SymbolList onSelect={(c) => navigate(`/trade/${c}`)} showAsk />
      </div>
      <p className="footnote">{t('market.footnote')}</p>
    </div>
  );
}
