import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { getSession, logout as apiLogout } from '../api/auth';
import type { Session } from '../api/types';
import { AuthContext } from './contexts';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setSession(null);
  }, []);
  const value = useMemo(() => ({ session, setSession, logout }), [session, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
