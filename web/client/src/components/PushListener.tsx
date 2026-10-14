/**
 * 接收服务端推送：每条新通知都在页面顶部显示提示；
 * 如果用户允许了浏览器通知且开启了推送偏好，同时用系统通知展示（原型：不接后端推送服务）。
 */
import { useTranslation } from 'react-i18next';
import { getNotifyPrefs } from '../api/user';
import type { NotificationKind } from '../api/types';
import { useToast, type ToastTone } from '../app/contexts';
import { useServerEvent } from '../hooks/useServerEvent';
import { showSystemNotification } from '../lib/notify';

const TONE: Record<NotificationKind, ToastTone> = {
  deposit: 'success',
  withdraw: 'info',
  fill: 'success',
  tpsl: 'info',
  marginCall: 'warn',
  liquidation: 'error',
  kyc: 'info',
  system: 'info',
};

export function PushListener() {
  const toast = useToast();
  const { t } = useTranslation();
  useServerEvent((e) => {
    if (e.type === 'notification') {
      toast.show({ tone: TONE[e.item.kind], title: e.item.title, body: e.item.body });
      void getNotifyPrefs()
        .then((p) => (p.push ? showSystemNotification(e.item.title, e.item.body) : false))
        .catch(() => false);
    }
    if (e.type === 'withdraw' && e.status === 'cancelled') {
      toast.show({ tone: 'success', title: t('withdraw.cancelled') });
    }
  });
  return null;
}
