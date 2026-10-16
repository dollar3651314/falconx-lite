/** 真实接口层（S18a）：路径、方法、参数、请求体，以及和原型字段不同处的转换（fetch 替身） */
import * as real from './real';
import { fakeFetch } from '../test/fakeFetch';

afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: 7,
  username: 'lina',
  displayName: '李娜',
  email: 'lina@example.com',
  roleIds: ['2'],
  status: 'active',
  mustChangePassword: false,
  lastLoginAt: '2026-10-14T01:12:33Z',
  createdAt: '2026-10-01T00:00:00Z',
};

describe('认证', () => {
  it('登录：POST 用户名和密码，响应里没有令牌', async () => {
    const { calls } = fakeFetch({
      'POST /api/admin/auth/login': { body: { adminId: 7, username: 'lina', displayName: '李娜', mustChangePassword: true } },
    });
    const s = await real.login('lina', 'Secret12345');
    expect(calls[0].body).toEqual({ username: 'lina', password: 'Secret12345' });
    expect(s).toEqual({ adminId: 7, username: 'lina', displayName: '李娜', mustChangePassword: true });
    expect(s.token).toBeUndefined();
  });

  it('改密码、退出', async () => {
    const { calls } = fakeFetch({ 'POST /api/admin/auth/change-password': {}, 'POST /api/admin/auth/logout': {} });
    await real.changePassword('Temp1234567', 'NewPass12345');
    await real.logout();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/admin/auth/change-password', 'POST /api/admin/auth/logout']);
    expect(calls[0].body).toEqual({ oldPassword: 'Temp1234567', newPassword: 'NewPass12345' });
  });

  it('/me：权限点、是否超管、可见菜单（叶子菜单的空 children 去掉）', async () => {
    fakeFetch({
      'GET /api/admin/me': {
        body: {
          admin,
          roles: [],
          permissions: ['customer:view'],
          isSuperAdmin: false,
          menus: [
            { key: 'customers', path: '/customers', labelKey: 'menu.customers', permission: 'customer:view', order: 20, visible: true, children: [] },
            {
              key: 'funds', path: null, labelKey: 'menu.funds', permission: null, order: 40, visible: true,
              children: [{ key: 'deposits', path: '/funds/deposits', labelKey: 'menu.deposits', permission: 'deposit:view', order: 10, visible: true, children: [] }],
            },
          ],
        },
      },
    });
    const me = await real.getCurrentAdmin();
    expect(me.permissions).toEqual(['customer:view']);
    expect(me.menus?.[0].children).toBeUndefined();
    expect(me.menus?.[1].children?.[0].key).toBe('deposits');
    expect(me.menus?.[1].children?.[0].children).toBeUndefined();
  });
});

describe('系统菜单', () => {
  it('新建管理员、重置密码：返回只显示一次的临时密码', async () => {
    const { calls } = fakeFetch({
      'POST /api/admin/admins': { body: { id: 9, temporaryPassword: 'tmp-aaaa-1111' } },
      'POST /api/admin/admins/9/reset-password': { body: { id: 9, temporaryPassword: 'tmp-bbbb-2222' } },
    });
    const input = { username: 'neo', displayName: 'Neo', email: 'neo@example.com', roleIds: ['2'] };
    await expect(real.createAdmin(input)).resolves.toEqual({ id: 9, temporaryPassword: 'tmp-aaaa-1111' });
    await expect(real.resetAdminPassword(9, '本人忘记密码')).resolves.toEqual({ id: 9, temporaryPassword: 'tmp-bbbb-2222' });
    expect(calls[0].body).toEqual(input);
    expect(calls[1].body).toEqual({ reason: '本人忘记密码' });
  });

  it('停用管理员带原因；角色新建用 POST、修改用 PUT', async () => {
    const { calls } = fakeFetch({ 'POST /api/admin/admins/9/status': { body: admin }, 'POST /api/admin/roles': { body: {} }, 'PUT /api/admin/roles/3': { body: {} } });
    await real.setAdminStatus(9, false, '离职');
    const role = { code: 'cs', nameZh: '客服', nameEn: 'CS', description: '', permissions: ['customer:view'] };
    await real.saveRole(null, role);
    await real.saveRole('3', role);
    expect(calls[0].body).toEqual({ active: false, reason: '离职' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/admin/admins/9/status', 'POST /api/admin/roles', 'PUT /api/admin/roles/3']);
  });

  it('菜单：只改顺序和是否显示', async () => {
    const { calls } = fakeFetch({ 'PUT /api/admin/menus/kyc': { body: [] } });
    await real.updateMenu('kyc', { order: 15, visible: false });
    expect(calls[0].body).toEqual({ order: 15, visible: false });
  });

  it('审计日志：分页和筛选参数', async () => {
    const { calls } = fakeFetch({ 'GET /api/admin/audit-logs': { body: { items: [], total: 0, page: 2, pageSize: 20 } } });
    await real.listAuditLogs({ page: 2, pageSize: 20, action: 'config.update', highRiskOnly: true, keyword: '白名单' });
    await real.listAuditLogs({ page: 1, pageSize: 20, highRiskOnly: false });
    expect(calls[0].url).toBe('/api/admin/audit-logs?action=config.update&highRiskOnly=true&keyword=%E7%99%BD%E5%90%8D%E5%8D%95&page=2&pageSize=20');
    expect(calls[1].url).toBe('/api/admin/audit-logs?page=1&pageSize=20');
  });

  it('系统配置：改值带原因，键名转义', async () => {
    const { calls } = fakeFetch({ 'PUT /api/admin/configs/withdraw.fee.TRC20': { body: {} } });
    await real.updateSystemConfig('withdraw.fee.TRC20', '1.5', '链上手续费上涨');
    expect(calls[0].body).toEqual({ value: '1.5', reason: '链上手续费上涨' });
  });
});

describe('客户、KYC', () => {
  it('客户列表的筛选参数；冻结、调余额带原因', async () => {
    const { calls } = fakeFetch({
      'GET /api/admin/customers': { body: { items: [], total: 0, page: 1, pageSize: 10 } },
      'POST /api/admin/customers/100482/freeze': { body: {} },
      'POST /api/admin/customers/100482/adjust': { body: {} },
    });
    await real.listCustomers({ page: 1, pageSize: 10, keyword: 'li', status: 'frozen', kycStatus: 'approved' });
    await real.setCustomerFrozen(100482, true, '客户来电');
    await real.adjustBalance(100482, 'debit', '10.5', '误入账');
    expect(calls[0].url).toBe('/api/admin/customers?keyword=li&status=frozen&kycStatus=approved&page=1&pageSize=10');
    expect(calls[1].body).toEqual({ frozen: true, reason: '客户来电' });
    expect(calls[2].body).toEqual({ direction: 'debit', amount: '10.5', reason: '误入账' });
  });

  it('KYC 审核：通过不带原因，驳回带原因；照片地址', async () => {
    const { calls } = fakeFetch({ 'POST /api/admin/kyc/12/review': { body: {} } });
    await real.reviewKyc('12', true);
    await real.reviewKyc('12', false, '照片模糊');
    expect(calls[0].body).toEqual({ approve: true });
    expect(calls[1].body).toEqual({ approve: false, reason: '照片模糊' });
    expect(real.kycImageUrl('12', 'selfie')).toBe('/api/admin/kyc/12/images/selfie');
  });
});

describe('资金、通知', () => {
  it('出金详情：后端的 {withdrawal, ...} 展开成原型的平铺结构', async () => {
    fakeFetch({
      'GET /api/admin/withdrawals/55': {
        body: {
          withdrawal: { id: '55', customerId: 1, customerName: '王五', status: 'pending', amount: '100', chain: 'TRC20' },
          kycStatus: 'approved',
          registeredDays: 30,
          totalDeposit: '2000',
          balance: '500',
          openPositions: 1,
          recentDeposits: [],
          recentWithdrawals: [],
        },
      },
    });
    const d = await real.getWithdrawal('55');
    expect(d).toMatchObject({ id: '55', customerName: '王五', status: 'pending', kycStatus: 'approved', registeredDays: 30 });
    expect((d as unknown as Record<string, unknown>).withdrawal).toBeUndefined();
  });

  it('出金：列表筛选、驳回和紧急取消带原因', async () => {
    const { calls } = fakeFetch({
      'GET /api/admin/withdrawals': { body: { items: [], total: 0, page: 1, pageSize: 8 } },
      'POST /api/admin/withdrawals/55/approve': { body: {} },
      'POST /api/admin/withdrawals/55/reject': { body: {} },
      'POST /api/admin/withdrawals/56/emergency-cancel': { body: {} },
    });
    await real.listWithdrawals({ page: 1, pageSize: 8, status: 'open', chain: 'TRC20', minAmount: '100', maxAmount: '5000', keyword: 'wang' });
    await real.approveWithdrawal('55');
    await real.rejectWithdrawal('55', '地址可疑');
    await real.emergencyCancelWithdrawal('56', '客户来电称被盗');
    expect(calls[0].url).toBe('/api/admin/withdrawals?status=open&chain=TRC20&minAmount=100&maxAmount=5000&keyword=wang&page=1&pageSize=8');
    expect(calls[1].body).toBeUndefined();
    expect(calls[2].body).toEqual({ reason: '地址可疑' });
    expect(calls[3].body).toEqual({ reason: '客户来电称被盗' });
  });

  it('对账：只按状态筛选，标记已处理的说明字段是 note', async () => {
    const { calls } = fakeFetch({ 'GET /api/admin/recon': { body: { items: [], total: 0, page: 1, pageSize: 10 } }, 'POST /api/admin/recon/3/resolve': {} });
    await real.listRecon({ page: 1, pageSize: 10, status: 'open' });
    await real.resolveRecon('3', '已核对');
    expect(calls[0].url).toBe('/api/admin/recon?status=open&page=1&pageSize=10');
    expect(calls[1].body).toEqual({ note: '已核对' });
  });

  it('任务、入金、通知记录的筛选；手动发送的请求体', async () => {
    const page = { body: { items: [], total: 0, page: 1, pageSize: 10 } };
    const { calls } = fakeFetch({ 'GET /api/admin/tasks': page, 'GET /api/admin/deposits': page, 'GET /api/admin/notify/records': page, 'POST /api/admin/notify/send': {} });
    await real.listTasks({ page: 1, pageSize: 10, type: 'email', status: 'failed' });
    await real.listDeposits({ page: 1, pageSize: 10, chain: 'BSC', status: 'credited', keyword: '0xabc' });
    await real.listNotifyRecords({ page: 1, pageSize: 10, channel: 'push', status: 'failed' });
    const input = { customerId: 100482, channels: ['inbox' as const], title: '维护通知', body: '今晚维护', reason: '客户要求' };
    await real.sendManualNotification(input);
    expect(calls[0].url).toBe('/api/admin/tasks?type=email&status=failed&page=1&pageSize=10');
    expect(calls[1].url).toBe('/api/admin/deposits?chain=BSC&status=credited&keyword=0xabc&page=1&pageSize=10');
    expect(calls[2].url).toBe('/api/admin/notify/records?channel=push&status=failed&page=1&pageSize=10');
    expect(calls[3].body).toEqual(input);
  });
});

describe('S18b：交易监控', () => {
  it('订单、持仓、挂单的路径和筛选；强平、强制撤单带原因', async () => {
    const page = { body: { items: [], total: 0, page: 1, pageSize: 10 } };
    const { calls } = fakeFetch({
      'GET /api/admin/orders': page,
      'GET /api/admin/positions': page,
      'GET /api/admin/pending': page,
      'GET /api/admin/trade-symbols': { body: ['EURUSD', 'XAUUSD'] },
      'POST /api/admin/positions/88/liquidate': { body: { price: '1.1', pnl: '-3' } },
      'POST /api/admin/pending/77/cancel': {},
    });
    await real.listOrders({ page: 1, pageSize: 10, symbol: 'XAUUSD', side: 'buy', status: 'filled', keyword: 'wang' });
    await real.listPositions({ page: 1, pageSize: 10, side: 'sell' });
    await real.listPendingOrders({ page: 1, pageSize: 10, symbol: 'EURUSD' });
    await expect(real.listTradeSymbols()).resolves.toEqual(['EURUSD', 'XAUUSD']);
    await real.liquidatePosition('88', '客户穿仓风险');
    await real.forceCancelPending('77', '客户要求');
    expect(calls[0].url).toBe('/api/admin/orders?symbol=XAUUSD&side=buy&status=filled&keyword=wang&page=1&pageSize=10');
    expect(calls[1].url).toBe('/api/admin/positions?side=sell&page=1&pageSize=10');
    expect(calls[2].url).toBe('/api/admin/pending?symbol=EURUSD&page=1&pageSize=10');
    expect(calls[4].body).toEqual({ reason: '客户穿仓风险' });
    expect(calls[5].body).toEqual({ reason: '客户要求' });
  });
});

describe('S18b：风控', () => {
  it('看板：后端的 symbols 转成 exposures，没有刷新时间时用取数时间', async () => {
    fakeFetch({
      'GET /api/admin/risk': {
        body: {
          symbols: [{ symbol: 'XAUUSD', nameZh: '黄金', nameEn: 'Gold', longUsd: '100', shortUsd: '0', netUsd: '100', thresholdUsd: null, status: 'normal' }],
          settings: { globalPause: false, autoLiquidation: true, platformNetUsd: '100', platformThresholdUsd: '500000', platformBlocked: false, perUserLimitUsd: '3000000', updatedAt: null },
          events: [],
        },
      },
    });
    const r = await real.getRiskOverview();
    expect(r.exposures[0].symbol).toBe('XAUUSD');
    expect(r.exposures[0].thresholdUsd).toBeNull();
    expect(r.settings.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('开关是 {value, reason}；阈值和单客户上限用 PUT', async () => {
    const { calls } = fakeFetch({
      'POST /api/admin/risk/global-pause': {},
      'POST /api/admin/risk/auto-liquidation': {},
      'POST /api/admin/risk/symbols/XAUUSD/pause': {},
      'PUT /api/admin/risk/symbols/XAUUSD/threshold': {},
      'PUT /api/admin/risk/platform-threshold': {},
      'PUT /api/admin/risk/per-user-limit': {},
    });
    await real.setGlobalPause(true, '非农');
    await real.setAutoLiquidation(false, '行情异常');
    await real.setSymbolPaused('XAUUSD', true, '敞口过大');
    await real.setSymbolThreshold('XAUUSD', '', '不再监控');
    await real.setPlatformThreshold('800000', '调整');
    await real.setPerUserLimit('2000000', '收紧');
    expect(calls.map((c) => c.body)).toEqual([
      { value: true, reason: '非农' },
      { value: false, reason: '行情异常' },
      { value: true, reason: '敞口过大' },
      { value: '', reason: '不再监控' },
      { value: '800000', reason: '调整' },
      { value: '2000000', reason: '收紧' },
    ]);
  });
});

describe('S18b：品种与行情、交易参数', () => {
  const sym = {
    code: 'EURUSD', nameZh: '欧元/美元', nameEn: 'Euro / US Dollar', category: 'forex_major', quoteCurrency: 'USD', contractSize: '100000', minLots: '0.01',
    maxLots: '100', lotStep: '0.01', maxLeverage: 200, maintenanceMarginRate: '0.3', openFeeRate: '0.00007', swapLong: '0', swapShort: '0', markup: '0.00008',
    digits: 5, hot: true, enabled: true, openPaused: false, sortOrder: 10, updatedAt: null,
  };

  it('品种：多空隔夜费率都是 0 视为未配置；改参数带原因，清空隔夜费率按 0 保存；启停是 {value, reason}', async () => {
    const { calls } = fakeFetch({
      'GET /api/admin/symbols': { body: { items: [sym, { ...sym, code: 'XAUUSD', swapLong: '-0.0002', swapShort: '0' }], total: 2, page: 1, pageSize: 20 } },
      'PUT /api/admin/symbols/EURUSD': { body: sym },
      'POST /api/admin/symbols/EURUSD/enabled': { body: sym },
    });
    const p = await real.listSymbols({ page: 1, pageSize: 20, missingSwap: true, enabled: true });
    expect(calls[0].url).toBe('/api/admin/symbols?enabled=true&missingSwap=true&page=1&pageSize=20');
    expect(p.items[0].swapLong).toBeNull();
    expect(p.items[1].swapShort).toBe('0');
    await real.updateSymbol('EURUSD', { maxLots: '50', markup: '0.0001', swapLong: null, swapShort: '-0.0001' }, '调整');
    expect(calls[1].body).toEqual({ maxLots: '50', markup: '0.0001', swapLong: '0', swapShort: '-0.0001', reason: '调整' });
    await real.setSymbolEnabled('EURUSD', false, '下线');
    expect(calls[2].body).toEqual({ value: false, reason: '下线' });
  });

  it('交易时段只读；休市日按品种增删', async () => {
    const { calls } = fakeFetch({
      'GET /api/admin/sessions': { body: [{ symbol: 'EURUSD', ranges: [{ day: 1, open: '00:00', close: '24:00' }] }] },
      'POST /api/admin/holidays': { body: { id: '9', date: '2026-12-25', symbol: '*', reason: '圣诞节' } },
      'DELETE /api/admin/holidays/9': {},
    });
    await expect(real.listSessions()).resolves.toEqual([{ symbol: 'EURUSD', ranges: [{ day: 1, open: '00:00', close: '24:00' }] }]);
    await real.addHoliday({ symbol: '*', date: '2026-12-25', reason: '圣诞节' });
    await real.deleteHoliday('9');
    expect(calls[1].body).toEqual({ symbol: '*', date: '2026-12-25', reason: '圣诞节' });
    expect(calls[2].method).toBe('DELETE');
  });

  it('交易参数：GET / PUT /api/admin/params，只有追保线和追保通知间隔', async () => {
    const { calls } = fakeFetch({
      'GET /api/admin/params': { body: { marginCallLevel: '100', liquidationLevel: null, marginCallThrottleMinutes: 30, updatedAt: null, updatedBy: null } },
      'PUT /api/admin/params': { body: {} },
    });
    await expect(real.getTradingParams()).resolves.toMatchObject({ liquidationLevel: null });
    await real.updateTradingParams({ marginCallLevel: '120', marginCallThrottleMinutes: 15 }, '提高追保线');
    expect(calls[1].body).toEqual({ marginCallLevel: '120', marginCallThrottleMinutes: 15, reason: '提高追保线' });
  });
});
