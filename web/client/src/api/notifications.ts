/** 站内信。正式环境：/api/notifications/* */
import * as mock from '../mocks/user';
import type { Lang, NotificationItem, Page } from './types';

export const listNotifications = (lang: Lang, page: number, pageSize = 20): Promise<Page<NotificationItem>> => mock.listNotifications(lang, page, pageSize);
export const getUnreadCount = (): Promise<number> => mock.unreadCount();
export const markRead = (id: string): Promise<void> => mock.markRead(id);
export const markAllRead = (): Promise<void> => mock.markAllRead();
/** 告诉服务端当前语言，推送内容按该语言生成 */
export const setPushLanguage = (lang: Lang): void => mock.setMockLang(lang);
