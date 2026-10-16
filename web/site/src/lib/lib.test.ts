import { clientLink, resolveClientUrl } from '../config';
import { parsePublicQuotes } from '../api/quotes';
import type { PublicQuotes } from '../api/types';
import { direction, formatPct, formatPrice } from './format';
import { initialRows, nextRows, unavailableRows, HISTORY_MAX } from './quotes';
import { pageFromPath, pathFor } from './route';

describe('格式化', () => {
  it('价格加千分位，不改小数位', () => {
    expect(formatPrice('112480.5')).toBe('112,480.5');
    expect(formatPrice('1.16420')).toBe('1.16420');
    expect(formatPrice('4126.35')).toBe('4,126.35');
    expect(formatPrice('24812')).toBe('24,812');
  });
  it('涨跌幅带符号', () => {
    expect(formatPct('0.62')).toBe('+0.62%');
    expect(formatPct('-1.35')).toBe('-1.35%');
    expect(formatPct('0.00')).toBe('0.00%');
    expect(direction('0.00')).toBe('flat');
    expect(direction('-0.01')).toBe('down');
  });
});

describe('客户端地址和注册、登录链接（4.4）', () => {
  it('构建变量优先，其次是页面 meta；占位符和非法值不用', () => {
    expect(resolveClientUrl('https://test-app.quickcome.online/', 'https://x.example')).toBe('https://test-app.quickcome.online');
    expect(resolveClientUrl('', 'https://test-app.e2e.test')).toBe('https://test-app.e2e.test');
    expect(resolveClientUrl(undefined, '__QC_CLIENT_URL__')).toBe('');
    expect(resolveClientUrl(undefined, 'javascript:alert(1)')).toBe('');
    expect(resolveClientUrl(undefined, null)).toBe('');
  });
  it('带上当前语言', () => {
    expect(clientLink('register', 'en', 'https://test-app.quickcome.online')).toBe('https://test-app.quickcome.online/register?lang=en');
    expect(clientLink('login', 'zh-CN', '')).toBe('/login?lang=zh-CN');
  });
});

describe('页面路径', () => {
  it('部署在 / 时', () => {
    expect(pageFromPath('/', '/')).toBe('home');
    expect(pageFromPath('/index.html', '/')).toBe('home');
    expect(pageFromPath('/terms', '/')).toBe('terms');
    expect(pageFromPath('/privacy/', '/')).toBe('privacy');
    expect(pageFromPath('/risk', '/')).toBe('risk');
    expect(pageFromPath('/abc', '/')).toBe('notFound');
    expect(pathFor('home', '/')).toBe('/');
    expect(pathFor('terms', '/')).toBe('/terms');
  });
  it('原型站放在 /site/ 时', () => {
    expect(pageFromPath('/site', '/site/')).toBe('home');
    expect(pageFromPath('/site/', '/site/')).toBe('home');
    expect(pageFromPath('/site/risk', '/site/')).toBe('risk');
    expect(pageFromPath('/terms', '/site/')).toBe('notFound');
    expect(pathFor('privacy', '/site/')).toBe('/site/privacy');
  });
});

const data = (items: [string, string | null, 'OPEN' | 'CLOSED' | 'NO_QUOTE'][]): PublicQuotes => ({
  sample: true,
  items: items.map(([symbol, bid, status]) => ({ symbol, nameZh: symbol, nameEn: symbol, bid, changePct: bid ? '0.10' : null, time: bid ? '2026-10-16T00:00:00Z' : null, status })),
});

describe('行情行的状态（AC2-02）', () => {
  it('卖价变高闪绿、变低闪红、不变不闪；每闪一次 flashSeq 加 1', () => {
    let rows = initialRows(['A', 'B', 'C']);
    rows = nextRows(rows, data([['A', '1.00', 'OPEN'], ['B', '2.00', 'OPEN'], ['C', '3.00', 'OPEN']]));
    expect(rows.map((r) => r.flash)).toEqual([null, null, null]);
    rows = nextRows(rows, data([['A', '1.01', 'OPEN'], ['B', '1.99', 'OPEN'], ['C', '3.00', 'OPEN']]));
    expect(rows.map((r) => r.flash)).toEqual(['up', 'down', null]);
    expect(rows.map((r) => r.flashSeq)).toEqual([1, 1, 0]);
    rows = nextRows(rows, data([['A', '1.02', 'OPEN'], ['B', '1.99', 'OPEN'], ['C', '3.00', 'OPEN']]));
    expect(rows[0].flash).toBe('up');
    expect(rows[0].flashSeq).toBe(2);
    expect(rows[0].history).toEqual([1, 1.01, 1.02]);
  });

  it('休市、没有报价时不保留旧价格；恢复开市后不闪（没有可比较的上一个价格）', () => {
    let rows = nextRows(initialRows(['A']), data([['A', '1.00', 'OPEN']]));
    rows = nextRows(rows, data([['A', null, 'CLOSED']]));
    expect(rows[0]).toMatchObject({ status: 'CLOSED', bid: null, changePct: null, flash: null, history: [] });
    rows = nextRows(rows, data([['A', '1.10', 'OPEN']]));
    expect(rows[0]).toMatchObject({ status: 'OPEN', bid: '1.10', flash: null });
  });

  it('连续取不到行情：全部变成"暂无报价"', () => {
    const rows = unavailableRows(nextRows(initialRows(['A']), data([['A', '1.00', 'OPEN']])));
    expect(rows[0]).toMatchObject({ status: 'NO_QUOTE', bid: null, changePct: null });
  });

  it('走势最多保留 HISTORY_MAX 个点', () => {
    let rows = initialRows(['A']);
    for (let i = 0; i < HISTORY_MAX + 10; i++) rows = nextRows(rows, data([['A', String(1 + i / 100), 'OPEN']]));
    expect(rows[0].history).toHaveLength(HISTORY_MAX);
  });

  it('接口返回格式不对时报错', () => {
    expect(() => parsePublicQuotes({})).toThrow();
    expect(() => parsePublicQuotes(null)).toThrow();
    expect(parsePublicQuotes({ sample: true, items: [{ symbol: 'A' }, null] }).items).toHaveLength(1);
  });
});
