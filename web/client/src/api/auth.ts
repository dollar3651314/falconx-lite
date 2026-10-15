/**
 * 认证接口。正式环境：POST /api/auth/*，令牌保存在内存 + HttpOnly Cookie；
 * 原型阶段令牌放在 localStorage 只为了刷新页面后保持登录。
 */
import * as mock from '../mocks/user';
import type { EmailCodePurpose, RegisterRequest, Session } from './types';

const SESSION_KEY = 'fx.session';

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

export async function login(email: string, password: string): Promise<Session> {
  const s = await mock.login(email.trim(), password);
  saveSession(s);
  return s;
}

export async function register(req: RegisterRequest): Promise<Session> {
  const s = await mock.register(req);
  saveSession(s);
  return s;
}

export const sendEmailCode = (email: string, purpose: EmailCodePurpose) => mock.sendEmailCode(email.trim(), purpose);
export const resetPassword = (email: string, code: string, password: string) => mock.resetPassword(email.trim(), code.trim(), password);
export const changePassword = (current: string, password: string) => mock.changePassword(current, password);

export async function logout(): Promise<void> {
  try {
    await mock.logout();
  } finally {
    saveSession(null);
  }
}

/** 原型：邮件验证码固定值，页面上会提示 */
export const PROTOTYPE_EMAIL_CODE = mock.MOCK_EMAIL_CODE;
