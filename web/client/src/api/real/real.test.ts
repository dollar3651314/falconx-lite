/**
 * 真实接口层（real 模式）的单元测试：用 fetch 和 WebSocket 替身，检查请求的地址、方法、请求体、
 * Cookie 设置，以及响应和错误的转换、401 回到登录页、实时推送和断线重连。
 */
import { ApiError } from '../errors';
import { onUnauthorized } from '../http';
import * as auth from './auth';
import { handleTradingMessage, subscribeEvents } from './events';
import { handleMarketMessage, subscribeQuotes } from './market';
import * as notifications from './notifications';
import { setLoggedIn } from './session';
import * as trading from './trading';
import * as user from './user';
import * as wallet from './wallet';
import type { Quote, ServerEvent } from '../types';
import { base64UrlToBytes, syncPushSubscription, unsubscribeThisDevice } from '../webPush';

// 这个文件测真实接口：Web Push 的同步逻辑按 real 模式运行
vi.mock('../mode', () => ({ API_MODE: 'real', IS_MOCK: false }));

interface Call {
  url: string;
  method: string;
  body?: unknown;
  credentials?: string;
}

let calls: Call[] = [];

/** fetch 替身：按调用顺序返回 responses 里的结果 */
function stubFetch(...responses: Array<{ status?: number; body?: unknown } | Error>) {
  calls = [];
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        credentials: init.credentials,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      });
      const r = queue.shift() ?? { status: 200 };
      if (r instanceof Error) throw r;
      const status = r.status ?? 200;
      const text = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return { ok: status >= 200 && status < 300, status, text: async () => text } as Response;
    }),
  );
}

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(m: string) {
    this.sent.push(JSON.parse(m));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

beforeEach(() => {
  FakeWS.instances = [];
  vi.stubGlobal('WebSocket', FakeWS);
  stubFetch();
});

afterEach(() => {
  setLoggedIn(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('HTTP：同源、Cookie、错误转换', () => {
  it('登录：POST JSON，同源带 Cookie，返回会话（不含令牌）', async () => {
    stubFetch({ body: { userId: '7', email: 'a@b.com' } });
    const s = await auth.login('a@b.com', 'password1');
    expect(s).toEqual({ userId: '7', email: 'a@b.com' });
    expect(calls[0]).toMatchObject({ url: '/api/auth/login', method: 'POST', credentials: 'same-origin', body: { email: 'a@b.com', password: 'password1' } });
  });

  it('验证码用途换成后端的枚举；返回 204 时按 60 秒倒计时', async () => {
    stubFetch({ status: 204 });
    expect(await auth.sendEmailCode('a@b.com', 'resetPassword')).toEqual({ cooldownSeconds: 60 });
    expect(calls[0].body).toEqual({ email: 'a@b.com', purpose: 'RESET_PASSWORD' });
  });

  it('注册：验证码错误标在验证码输入框上', async () => {
    stubFetch({ status: 400, body: { code: 'CODE_INVALID', message: '验证码错误', fields: [] } });
    const e = await auth.register({ email: 'a@b.com', code: '000000', password: 'password1', firstName: 'A', middleName: '', lastName: 'B', birthDate: '1990-01-01', nationality: 'CN' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).reason).toBe('codeInvalid');
    expect((e as ApiError).fieldErrors).toEqual({ code: ['errors.codeInvalid'] });
  });

  it('改密码：字段名对应到页面表单', async () => {
    stubFetch({ status: 400, body: { code: 'VALIDATION_FAILED', fields: [{ field: 'newPassword', code: 'PASSWORD_LENGTH' }] } });
    const e = (await auth.changePassword('old', 'short').catch((x: unknown) => x)) as ApiError;
    expect(calls[0].body).toEqual({ currentPassword: 'old', newPassword: 'short' });
    expect(e.fieldErrors).toEqual({ password: ['validation.passwordLength'] });
  });

  it('401：通知回到登录页；启动时检查登录不触发', async () => {
    const h = vi.fn();
    const off = onUnauthorized(h);
    stubFetch({ status: 401, body: { code: 'UNAUTHORIZED', fields: [] } }, { status: 401, body: { code: 'UNAUTHORIZED', fields: [] } });
    expect(await auth.restoreSession()).toBeNull();
    expect(h).not.toHaveBeenCalled();
    await expect(trading.getAccount()).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(h).toHaveBeenCalledTimes(1);
    off();
  });

  it('断网、网关错误页', async () => {
    stubFetch(new TypeError('Failed to fetch'), { status: 502, body: '<html>Bad Gateway</html>' });
    await expect(trading.listPositions()).rejects.toMatchObject({ reason: 'network' });
    await expect(trading.listPositions()).rejects.toMatchObject({ reason: 'server' });
  });

  it('响应里的 null 当成没有；资料和 KYC 的时间补上 UTC 时区', async () => {
    stubFetch(
      { body: [{ id: '1', symbol: 'XAUUSD', side: 'buy', takeProfit: null, stopLoss: '4000.00' }] },
      { body: { status: 'rejected', docType: 'idCard', docNumber: '****1234', submittedAt: '2026-10-15T08:00:00', reviewedAt: null, rejectReason: '照片模糊' } },
      { body: { userId: '7', email: 'a@b.com', firstName: 'A', middleName: null, lastName: 'B', birthDate: '1990-01-01', nationality: 'CN', registeredAt: '2026-10-01T00:00:00', locked: false } },
    );
    const [p] = await trading.listPositions();
    expect('takeProfit' in p).toBe(false);
    expect(p.stopLoss).toBe('4000.00');
    const k = await user.getKyc();
    expect(k.submittedAt).toBe('2026-10-15T08:00:00Z');
    expect(k.reviewedAt).toBeUndefined();
    const pr = await user.getProfile();
    expect(pr.registeredAt).toBe('2026-10-01T00:00:00Z');
    expect(pr.middleName).toBe('');
  });
});

describe('交易、钱包、通知接口', () => {
  it('下单、改止盈止损（不传表示取消）、撤单、历史分页', async () => {
    stubFetch({ body: { kind: 'filled', id: '9', price: '4080.00' } }, { status: 200 }, { status: 200 }, { body: { items: [], total: 0, page: 2, pageSize: 20 } });
    const req = { symbol: 'XAUUSD', type: 'market' as const, side: 'buy' as const, lots: '0.10', leverage: 100, clientOrderId: 'u1' };
    expect(await trading.placeOrder(req)).toEqual({ kind: 'filled', id: '9', price: '4080.00' });
    await trading.updateTpSl('9', '4200.00', undefined);
    await trading.cancelOrder('O1');
    await trading.listHistory(2, 20);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/trading/orders', 'PUT /api/trading/positions/9/tpsl', 'DELETE /api/trading/orders/O1', 'GET /api/trading/history?page=2&pageSize=20']);
    expect(calls[0].body).toEqual(req);
    expect(calls[1].body).toEqual({ takeProfit: '4200.00' });
  });

  it('下单被拒：显示原因；追加保证金余额不足显示"可用余额不足"', async () => {
    stubFetch({ status: 400, body: { code: 'GLOBAL_PAUSED', fields: [] } }, { status: 400, body: { code: 'INSUFFICIENT_BALANCE', fields: [] } });
    await expect(trading.placeOrder({ symbol: 'X', type: 'market', side: 'buy', lots: '1', leverage: 1, clientOrderId: 'c' })).rejects.toMatchObject({ reason: 'globalPaused' });
    await expect(trading.addMargin('1', '10')).rejects.toMatchObject({ reason: 'marginInsufficient' });
  });

  it('充值地址带最小充值金额；充值记录；提现超过可提金额', async () => {
    stubFetch(
      { body: [{ network: 'TRC20', address: 'T1', confirmations: 19, etaMinutes: 1, minDeposit: '1' }] },
      { body: [{ id: '1', network: 'BSC', txHash: '0x1', amount: '0.5', status: 'belowMin', confirmations: 15, requiredConfirmations: 15, time: '2026-10-15T00:00:00Z' }] },
      { status: 400, body: { code: 'INSUFFICIENT_BALANCE', fields: [] } },
    );
    expect((await wallet.getDepositAddresses())[0].minDeposit).toBe('1');
    expect((await wallet.listDeposits())[0].status).toBe('belowMin');
    await expect(wallet.submitWithdraw({ whitelistId: '3', amount: ' 100 ' })).rejects.toMatchObject({ reason: 'withdrawInsufficient' });
    expect(calls[2]).toMatchObject({ url: '/api/wallet/withdrawals', body: { whitelistId: '3', amount: '100' } });
  });

  it('站内信按界面语言取；未读数；标记已读', async () => {
    stubFetch({ body: { items: [], total: 0, page: 1, pageSize: 20 } }, { body: { count: 3 } }, { status: 200 });
    await notifications.listNotifications('en', 1, 20);
    expect(await notifications.getUnreadCount()).toBe(3);
    await notifications.markRead('42');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/notifications?lang=en&page=1&pageSize=20', 'GET /api/notifications/unread-count', 'POST /api/notifications/42/read']);
  });

  it('切换界面语言：登录后才 PUT /api/me/notify-lang，登录时补发', async () => {
    stubFetch({ status: 200 }, { status: 200 });
    notifications.setPushLanguage('en');
    expect(calls).toHaveLength(0);
    setLoggedIn(true);
    await Promise.resolve();
    expect(calls[0]).toMatchObject({ url: '/api/me/notify-lang', method: 'PUT', body: { lang: 'en' } });
    notifications.setPushLanguage('zh-CN');
    expect(calls[1]).toMatchObject({ url: '/api/me/notify-lang', body: { lang: 'zh-CN' } });
  });

  it('推送公钥为 null 时返回 null；订阅原样提交 toJSON()', async () => {
    stubFetch({ body: { publicKey: null } }, { status: 200 }, { status: 200 });
    expect(await notifications.getPushKey()).toBeNull();
    const sub = { endpoint: 'https://fcm.googleapis.com/x', expirationTime: null, keys: { p256dh: 'k', auth: 'a' } };
    await notifications.savePushSubscription(sub);
    await notifications.removePushSubscription(sub.endpoint);
    expect(calls[1]).toMatchObject({ url: '/api/notifications/push/subscriptions', method: 'POST', body: sub });
    expect(calls[2]).toMatchObject({ url: '/api/notifications/push/unsubscribe', body: { endpoint: sub.endpoint } });
  });
});

describe('实时推送', () => {
  it('交易推送：登录后才连接，只转发认识的事件', () => {
    const got: ServerEvent[] = [];
    const off = subscribeEvents((e) => got.push(e));
    expect(FakeWS.instances.filter((w) => w.url.endsWith('/api/ws/trading'))).toHaveLength(0);
    setLoggedIn(true);
    const ws = FakeWS.instances.find((w) => w.url.endsWith('/api/ws/trading'))!;
    expect(ws.url).toMatch(/^ws:\/\/.+\/api\/ws\/trading$/);
    ws.open();
    ws.push({ type: 'positions' });
    ws.push({ type: 'trade', kind: 'tp', symbol: 'XAUUSD', pnl: '12.5' });
    ws.push({ type: 'unknown' });
    handleTradingMessage({ type: 'notification' }); // 缺少 item 的忽略
    expect(got).toEqual([{ type: 'positions' }, { type: 'trade', kind: 'tp', symbol: 'XAUUSD', pnl: '12.5' }]);
    off();
  });

  it('断线自动重连，重连后让页面重新拉取账户、持仓、挂单；退出登录后不再重连', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const off = subscribeEvents((e) => got.push(e.type));
    setLoggedIn(true);
    const first = FakeWS.instances.at(-1)!;
    first.open();
    first.drop();
    vi.advanceTimersByTime(1000);
    const second = FakeWS.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.open();
    expect(got).toEqual(['account', 'positions', 'orders']);
    setLoggedIn(false);
    const count = FakeWS.instances.length;
    second.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.instances.length).toBe(count);
    off();
  });

  it('行情推送：报价缓存、汇率为空时沿用上一次的值', () => {
    const got: Quote[][] = [];
    const off = subscribeQuotes((q) => got.push(q));
    const q = { symbol: 'USDJPY', bid: '150.000', ask: '150.010', open: '149.5', high: '151', low: '149', quoteToUsd: '0.0066', time: '2026-10-15T00:00:00Z' };
    handleMarketMessage({ type: 'quotes', data: [q] });
    handleMarketMessage({ type: 'quotes', data: [{ ...q, bid: '150.100', quoteToUsd: undefined }] });
    expect(got.at(-1)![0]).toMatchObject({ bid: '150.100', quoteToUsd: '0.0066' });
    off();
    // 新订阅先收到缓存的全量快照
    const later: Quote[][] = [];
    subscribeQuotes((x) => later.push(x))();
    expect(later[0][0].symbol).toBe('USDJPY');
  });
});

describe('Web Push 订阅', () => {
  const KEY = 'BAECAwQ'; // base64url 的 [4, 1, 2, 3, 4]

  function stubBrowser(existing: { endpoint: string; key?: number[] } | null, permission: NotificationPermission = 'granted') {
    const state = { subscribed: 0, unsubscribed: 0 };
    const makeSub = (endpoint: string, key: number[]) => ({
      endpoint,
      options: { applicationServerKey: new Uint8Array(key).buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: async () => {
        state.unsubscribed += 1;
        return true;
      },
    });
    const pushManager = {
      getSubscription: async () => (existing ? makeSub(existing.endpoint, existing.key ?? [4, 1, 2, 3, 4]) : null),
      subscribe: async (o: { applicationServerKey: Uint8Array }) => {
        state.subscribed += 1;
        return makeSub('https://fcm.googleapis.com/new', [...o.applicationServerKey]);
      },
    };
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', { permission });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ pushManager }) } });
    return state;
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('base64url 公钥转字节', () => {
    expect([...base64UrlToBytes(KEY)]).toEqual([4, 1, 2, 3, 4]);
  });

  it('授权且推送开着：用公钥订阅并提交 toJSON()', async () => {
    const st = stubBrowser(null);
    stubFetch({ body: { publicKey: KEY } }, { status: 200 });
    await syncPushSubscription(true);
    expect(st.subscribed).toBe(1);
    expect(calls.map((c) => c.url)).toEqual(['/api/notifications/push/key', '/api/notifications/push/subscriptions']);
    expect(calls[1].body).toEqual({ endpoint: 'https://fcm.googleapis.com/new', keys: { p256dh: 'p', auth: 'a' } });
  });

  it('公钥为 null 不订阅；没有授权什么都不做', async () => {
    let st = stubBrowser(null);
    stubFetch({ body: { publicKey: null } });
    await syncPushSubscription(true);
    expect(st.subscribed).toBe(0);
    expect(calls).toHaveLength(1);
    st = stubBrowser(null, 'default');
    stubFetch();
    await syncPushSubscription(true);
    expect(calls).toHaveLength(0);
    expect(st.subscribed).toBe(0);
  });

  it('推送偏好关了、退出登录：取消这台设备的订阅', async () => {
    let st = stubBrowser({ endpoint: 'https://fcm.googleapis.com/old' });
    stubFetch({ status: 200 });
    await syncPushSubscription(false);
    expect(calls[0]).toMatchObject({ url: '/api/notifications/push/unsubscribe', body: { endpoint: 'https://fcm.googleapis.com/old' } });
    expect(st.unsubscribed).toBe(1);
    st = stubBrowser({ endpoint: 'https://fcm.googleapis.com/old' });
    stubFetch({ status: 200 });
    await unsubscribeThisDevice();
    expect(calls[0].url).toBe('/api/notifications/push/unsubscribe');
    expect(st.unsubscribed).toBe(1);
  });

  it('服务器换了公钥：重新订阅', async () => {
    const st = stubBrowser({ endpoint: 'https://fcm.googleapis.com/old', key: [9, 9] });
    stubFetch({ body: { publicKey: KEY } }, { status: 200 });
    await syncPushSubscription(true);
    expect(st.unsubscribed).toBe(1);
    expect(st.subscribed).toBe(1);
  });
});
