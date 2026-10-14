/** 个人资料、身份认证、通知偏好。正式环境：/api/me/* */
import * as mock from '../mocks/user';
import type { KycInfo, KycSubmit, Lang, NotifyPrefs, Profile, ProfileUpdate } from './types';

export const getProfile = (): Promise<Profile> => mock.getProfile();
export const updateProfile = (p: ProfileUpdate): Promise<Profile> => mock.updateProfile(p);
export const getKyc = (lang: Lang): Promise<KycInfo> => mock.getKyc(lang);
export const submitKyc = (s: KycSubmit): Promise<KycInfo> => mock.submitKyc(s);
export const getNotifyPrefs = (): Promise<NotifyPrefs> => mock.getNotifyPrefs();
export const updateNotifyPrefs = (p: NotifyPrefs): Promise<NotifyPrefs> => mock.updateNotifyPrefs(p);
