/** 账户条：净值、可用、保证金水平（手机持仓页顶部）。 */
import { useTranslation } from 'react-i18next';
import { useAccount } from '../app/contexts';
import { formatAmount, formatPercent } from '../lib/format';
import { marginLevelTone } from '../lib/trading';

export function AccountStrip() {
  const { t } = useTranslation();
  const { metrics, error } = useAccount();
  const tone = marginLevelTone(metrics?.marginLevel ?? null);
  return (
    <section className="acct-strip">
      <div>
        {t('account.equity')}
        <span className="num">{error && !metrics ? '—' : formatAmount(metrics?.equity)}</span>
      </div>
      <div>
        {t('account.available')}
        <span className="num">{error && !metrics ? '—' : formatAmount(metrics?.available)}</span>
      </div>
      <div>
        {t('account.marginLevel')}
        <span className={`num tone-${tone}`}>
          {metrics && metrics.marginLevel !== null ? formatPercent(metrics.marginLevel, { dp: 1 }) : metrics ? t('account.noPosition') : '—'}
          {metrics?.marginLevel != null && <span className={`pill pill-${tone}`}>{t(`account.level.${tone}`)}</span>}
        </span>
      </div>
    </section>
  );
}
