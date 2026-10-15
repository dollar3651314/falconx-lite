import { ApiError } from '../api/errors';
import { listPositions, placeOrder } from '../api/trading';
import { listLedger, getWithdrawInfo } from '../api/wallet';
import { listSymbols } from '../api/market';
import { getProtoState, getScenarioVersion, setProtoState } from '../api/prototype';
import { resetDb } from './db';

const order = (symbol: string, leverage = 50) => ({ symbol, type: 'market' as const, side: 'buy' as const, lots: '0.01', leverage, clientOrderId: 'x' });

describe('模拟层场景切换', () => {
  afterEach(() => {
    setProtoState({ scenario: 'normal', forceReject: 'none' });
    resetDb();
  });

  it('正常数据：50 个品种，至少一个暂停开仓；列表超过一页', async () => {
    const s = await listSymbols();
    expect(s).toHaveLength(50);
    expect(s.some((x) => x.openPaused)).toBe(true);
    const ledger = await listLedger({ type: 'all', range: 'all', page: 1, pageSize: 20 });
    expect(ledger.total).toBeGreaterThan(20);
  });

  it('空数据场景：列表为空、余额为 0', async () => {
    setProtoState({ scenario: 'empty' });
    expect(await listPositions()).toEqual([]);
    expect(await listSymbols()).toEqual([]);
    const info = await getWithdrawInfo();
    expect(info.available).toBe('0.00');
  });

  it('接口出错场景：抛出带原因的错误', async () => {
    setProtoState({ scenario: 'error' });
    await expect(listPositions()).rejects.toBeInstanceOf(ApiError);
    await expect(listPositions()).rejects.toMatchObject({ reason: 'server' });
  });

  it('切换场景时版本号递增，页面据此重新加载', () => {
    const v = getScenarioVersion();
    setProtoState({ scenario: 'slow' });
    expect(getScenarioVersion()).toBe(v + 1);
    expect(getProtoState().scenario).toBe('slow');
  });

  it('下单被拒的具体原因', async () => {
    await expect(placeOrder(order('BTCUSD'))).rejects.toMatchObject({ reason: 'symbolPaused' });
    await expect(placeOrder(order('AAPL'))).rejects.toMatchObject({ reason: 'tradingClosed' });
    await expect(placeOrder(order('XAUUSD', 500))).rejects.toMatchObject({ reason: 'leverageExceeded' });
    await expect(placeOrder({ ...order('XAUUSD', 2), lots: '5' })).rejects.toMatchObject({ reason: 'insufficientBalance' });
    setProtoState({ forceReject: 'positionLimit' });
    await expect(placeOrder(order('XAUUSD'))).rejects.toMatchObject({ reason: 'positionLimit' });
  });

  it('市价单成交后出现新持仓', async () => {
    const before = (await listPositions()).length;
    const r = await placeOrder(order('XAUUSD'));
    expect(r.kind).toBe('filled');
    expect(await listPositions()).toHaveLength(before + 1);
  });
});
