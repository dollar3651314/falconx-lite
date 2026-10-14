/**
 * 充值（效果图 M3）：先选网络，再显示地址、二维码、复制按钮和警示。ERC20 与 BSC 是同一个地址。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDepositAddresses } from '../../api/wallet';
import type { Network } from '../../api/types';
import { useToast } from '../../app/contexts';
import { AsyncView } from '../../components/AsyncView';
import { Icon } from '../../components/Icon';
import { QrCode } from '../../components/QrCode';
import { useAsync } from '../../hooks/useAsync';
import { groupAddress } from '../../lib/format';

const NETS: Network[] = ['ERC20', 'TRC20', 'BSC'];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 旧浏览器或非安全上下文的兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function DepositCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const s = useAsync(getDepositAddresses, 'deposit');
  const [net, setNet] = useState<Network | null>(null);
  return (
    <section className="card" aria-labelledby="dep-title">
      <div className="card-head">
        <h2 id="dep-title">{t('deposit.chooseNetwork')}</h2>
        <span className="muted small">{t('deposit.onlyUsdt')}</span>
      </div>
      <div className="net-grid" role="radiogroup" aria-label={t('deposit.chooseNetwork')}>
        {NETS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={net === n} className={`net${net === n ? ' on' : ''}`} onClick={() => setNet(n)}>
            <b>{n}</b>
            <small>{t(`deposit.chain.${n}`)}</small>
          </button>
        ))}
      </div>
      {!net ? (
        <p className="pick-first">{t('deposit.pickFirst')}</p>
      ) : (
        <AsyncView state={s} rows={4}>
          {(list) => {
            const a = list.find((x) => x.network === net)!;
            return (
              <>
                <div className="qr-wrap">
                  <QrCode value={a.address} label={t('deposit.qrLabel', { network: net })} />
                  <div className="addr">
                    <span className="num">{groupAddress(a.address)}</span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const ok = await copyText(a.address);
                        toast.show({ tone: ok ? 'success' : 'error', title: ok ? t('deposit.copied') : t('deposit.copyFailed') });
                      }}
                    >
                      <Icon name="copy" size={14} />
                      {t('common.copy')}
                    </button>
                  </div>
                  {net !== 'TRC20' && <p className="muted small">{t('deposit.sameAddress')}</p>}
                </div>
                <div className="warn-box" role="note">
                  <h3>
                    <Icon name="warn" size={16} strokeWidth={2.2} />
                    {t('deposit.warnTitle')}
                  </h3>
                  <ul>
                    <li>{t('deposit.warnOnly', { network: net })}</li>
                    <li>{t('deposit.warnWrong')}</li>
                    <li>{t('deposit.warnConfirm', { n: a.confirmations, m: a.etaMinutes })}</li>
                  </ul>
                </div>
              </>
            );
          }}
        </AsyncView>
      )}
    </section>
  );
}
