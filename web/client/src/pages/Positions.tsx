/** 持仓（手机底部导航第 3 项，U4）：账户条 + 持仓 / 挂单 / 历史。桌面上同样可用（表格）。 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AccountStrip } from '../components/AccountStrip';
import { PageHeader } from '../components/Layout';
import { PositionsTabs } from '../components/PositionsTabs';
import { useIsDesktop } from '../hooks/useMediaQuery';

export default function Positions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  return (
    <div className="page page-positions">
      <PageHeader title={t('positions.pageTitle')} />
      <AccountStrip />
      <div className={desktop ? 'panel posp-page' : 'pos-wrap'}>
        <PositionsTabs table={desktop} onSelectSymbol={(c) => navigate(`/trade/${c}`)} />
      </div>
    </div>
  );
}
