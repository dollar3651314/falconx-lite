/** 认证的真实接口：`/api/auth/*`、`/api/me/session`（`account/auth/AuthController.java`） */
import { ApiError } from '../errors';
import { get, post } from '../http';
import type { EmailCodePurpose, RegisterRequest, Session } from '../types';

interface SessionView {
  userId: string;
  email: string;
}

const toSession = (v: SessionView): Session => ({ userId: v.userId, email: v.email });

/** 后端的验证码用途是枚举 REGISTER / RESET_PASSWORD */
const PURPOSE: Record<EmailCodePurpose, string> = { register: 'REGISTER', resetPassword: 'RESET_PASSWORD' };

/** 后端的重发间隔（`falconx.auth.code-resend-seconds`），接口没有返回，按配置写 */
const RESEND_SECONDS = 60;

export async function login(email: string, password: string): Promise<Session> {
  return toSession(await post<SessionView>('/api/auth/login', { email, password }, { quiet401: true }));
}

export async function register(req: RegisterRequest): Promise<Session> {
  return toSession(await post<SessionView>('/api/auth/register', req, { codeFields: { CODE_INVALID: 'code', EMAIL_TAKEN: 'email' } }));
}

export async function sendEmailCode(email: string, purpose: EmailCodePurpose): Promise<{ cooldownSeconds: number }> {
  await post<void>('/api/auth/email-code', { email, purpose: PURPOSE[purpose] });
  return { cooldownSeconds: RESEND_SECONDS };
}

export async function resetPassword(email: string, code: string, password: string): Promise<void> {
  await post<void>('/api/auth/password/reset', { email, code, password }, { codeFields: { CODE_INVALID: 'code' } });
}

export async function changePassword(current: string, password: string): Promise<void> {
  await post<void>(
    '/api/auth/password/change',
    { currentPassword: current, newPassword: password },
    { fieldNames: { currentPassword: 'current', newPassword: 'password' }, codeFields: { CURRENT_PASSWORD_WRONG: 'current' } },
  );
}

export async function logout(): Promise<void> {
  await post<void>('/api/auth/logout', undefined, { quiet401: true });
}

/** 打开页面时问后端"现在是谁"：Cookie 有效返回会话，没登录返回 null */
export async function restoreSession(): Promise<Session | null> {
  try {
    return toSession(await get<SessionView>('/api/me/session', { quiet401: true }));
  } catch (e) {
    if (e instanceof ApiError && e.reason === 'unauthorized') return null;
    throw e;
  }
}
