/**
 * 登录状态和权限：页面通过 useAuth().can('xxx') 判断菜单和按钮是否可用。
 * Auth state & permission checks.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { changePassword as apiChangePassword, getCurrentAdmin, login as apiLogin, switchIdentity as apiSwitch, type CurrentAdmin, type ProtoIdentity } from '../api';
import type { AdminSession } from '../api/types';

const SESSION_KEY = 'fx-admin-session';

function loadSession(): AdminSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: AdminSession | null): void {
  try {
    if (s) globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(s));
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

export interface AuthState {
  session: AdminSession | null;
  me: CurrentAdmin | null;
  loading: boolean;
  identity: ProtoIdentity;
  can: (perm: string | undefined) => boolean;
  login: (username: string, password: string) => Promise<AdminSession>;
  logout: () => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  switchIdentity: (identity: ProtoIdentity) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function identityOf(me: CurrentAdmin | null): ProtoIdentity {
  if (!me) return 'super';
  if (me.isSuperAdmin) return 'super';
  if (me.roles.some((r) => r.code === 'risk')) return 'risk';
  return 'ops';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(loadSession);
  const [me, setMe] = useState<CurrentAdmin | null>(null);
  const [loading, setLoading] = useState<boolean>(!!session);

  const loadMe = useCallback(async (s: AdminSession | null) => {
    if (!s) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setMe(await getCurrentAdmin(s.adminId));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe(session);
  }, [session, loadMe]);

  const login = useCallback(async (username: string, password: string) => {
    const s = await apiLogin(username, password);
    saveSession(s);
    setSession(s);
    return s;
  }, []);

  const logout = useCallback(() => {
    saveSession(null);
    setSession(null);
    setMe(null);
  }, []);

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      await apiChangePassword(oldPassword, newPassword);
      if (session) {
        const next = { ...session, mustChangePassword: false };
        saveSession(next);
        setSession(next);
      }
    },
    [session],
  );

  const switchIdentity = useCallback(async (identity: ProtoIdentity) => {
    const s = await apiSwitch(identity);
    saveSession(s);
    setSession(s);
  }, []);

  const refresh = useCallback(() => loadMe(session), [loadMe, session]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      session,
      me,
      loading,
      identity: identityOf(me),
      can: (perm) => !perm || perms.has(perm),
      login,
      logout,
      changePassword,
      switchIdentity,
      refresh,
    };
  }, [session, me, loading, login, logout, changePassword, switchIdentity, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
