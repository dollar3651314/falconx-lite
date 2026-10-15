/**
 * 路由（站点地图见需求说明书 5.1）。客户端部署在根路径 `/`，使用浏览器路由。
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AccountProvider } from './app/AccountProvider';
import { AuthProvider } from './app/AuthProvider';
import { useAuth } from './app/contexts';
import { SymbolsProvider } from './app/SymbolsProvider';
import { ThemeProvider } from './app/ThemeProvider';
import { ToastProvider } from './app/ToastProvider';
import { Loading } from './components/AsyncView';
import { Layout } from './components/Layout';
import { startEngine } from './api/trading';

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const Markets = lazy(() => import('./pages/Markets'));
const Trade = lazy(() => import('./pages/Trade'));
const Positions = lazy(() => import('./pages/Positions'));
const Assets = lazy(() => import('./pages/assets/Assets'));
const Ledger = lazy(() => import('./pages/assets/Ledger'));
const Withdraw = lazy(() => import('./pages/assets/Withdraw'));
const Whitelist = lazy(() => import('./pages/assets/Whitelist'));
const Me = lazy(() => import('./pages/me/Me'));
const Profile = lazy(() => import('./pages/me/Profile'));
const Kyc = lazy(() => import('./pages/me/Kyc'));
const Notifications = lazy(() => import('./pages/me/Notifications'));
const NotifyPrefs = lazy(() => import('./pages/me/NotifyPrefs'));
const ChangePassword = lazy(() => import('./pages/me/ChangePassword'));
const NotFound = lazy(() => import('./pages/NotFound'));

// 原型：行情驱动的挂单成交、止盈止损、强平在浏览器内模拟
startEngine();

function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return session ? <Navigate to="/" replace /> : <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading rows={4} />}>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route
          element={
            <RequireAuth>
              <SymbolsProvider>
                <AccountProvider>
                  <Layout />
                </AccountProvider>
              </SymbolsProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/markets" replace />} />
          <Route path="markets" element={<Markets />} />
          <Route path="trade" element={<Trade />} />
          <Route path="trade/:symbol" element={<Trade />} />
          <Route path="positions" element={<Positions />} />
          <Route path="assets" element={<Assets />} />
          <Route path="assets/ledger" element={<Ledger />} />
          <Route path="assets/withdraw" element={<Withdraw />} />
          <Route path="assets/whitelist" element={<Whitelist />} />
          <Route path="me" element={<Me />} />
          <Route path="me/profile" element={<Profile />} />
          <Route path="me/kyc" element={<Kyc />} />
          <Route path="me/notifications" element={<Notifications />} />
          <Route path="me/notify-prefs" element={<NotifyPrefs />} />
          <Route path="me/password" element={<ChangePassword />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
