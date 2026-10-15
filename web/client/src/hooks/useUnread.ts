import { useEffect } from 'react';
import { getUnreadCount } from '../api/notifications';
import { useAsync } from './useAsync';
import { useServerEvent } from './useServerEvent';

const listeners = new Set<() => void>();

/** 页面里标记已读后调用，让所有未读角标刷新 */
export function notifyUnreadChanged(): void {
  listeners.forEach((l) => l());
}

/** 未读站内信数量 */
export function useUnread(): number {
  const s = useAsync(getUnreadCount, 'unread');
  const { reload } = s;
  useServerEvent((e) => {
    if (e.type === 'notification') reload();
  });
  useEffect(() => {
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  return s.data ?? 0;
}
