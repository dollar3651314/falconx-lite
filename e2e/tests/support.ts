/**
 * 端到端测试的公共部分：分步执行（每步超时、失败时写明卡在哪一步）、调用 e2e 替身接口（/api/e2e/**，只在后端 e2e profile 下存在）、
 * 记录客户能收到的全部接口返回和推送（AC-23）以及所有网络请求的域名（AC-29）。
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/** 客户密码：8–64 位、含字母和数字 */
export const CLIENT_PASSWORD = 'e2eTest1234';
/** 后台第一个超管：和 CI、本机启动后端时的 FX_ADMIN_INIT_* 一致（一次性测试值，不是任何环境的密钥） */
export const ADMIN_USERNAME = process.env.FX_ADMIN_INIT_USERNAME || 'e2e_admin';
export const ADMIN_INIT_PASSWORD = process.env.FX_ADMIN_INIT_PASSWORD || 'ci_only_admin_init_1';
/** 首次登录后改成的新密码（至少 10 位，含字母和数字；一次性测试值） */
export const ADMIN_NEW_PASSWORD = process.env.E2E_ADMIN_NEW_PASSWORD || 'ci_only_admin_new_2';

/**
 * 交易用的品种：加密货币 7×24 小时交易，任何时间跑测试都在交易时段内。
 * 不用 BTCUSD：迁移脚本 V4 里它的初始状态是"暂停开仓"（沿用原型的演示数据，已记入测试报告的"发现的问题"）
 */
export const SYMBOL = 'ETHUSD';

/**
 * SYMBOL 的加点（迁移 V24：买卖合计 20 点 = 每边 10 点，ETHUSD 2 位小数 → 每边 0.10）：客户看到的卖价 = 原始卖价 − 0.10、买价 = 原始买价 + 0.10。
 * `e2e.quote` 返回的是客户价（含加点），`e2e.move` 设的是原始卖价（不含加点），换算时要用它。
 */
export const SYMBOL_MARKUP = 0.1;

/** 每轮新数据：新邮箱、新证件号 */
export function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 执行一步。超时或失败时，错误信息开头写明"卡在：第几步 名字"，报告里也按步骤显示。
 */
let stepNo = 0;
test.beforeEach(() => {
  stepNo = 0;
});
export async function step<T>(name: string, fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  stepNo += 1;
  const label = `${String(stepNo).padStart(2, '0')} ${name}`;
  return test.step(label, async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`超过 ${timeoutMs / 1000} 秒`)), timeoutMs);
        }),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`卡在：${label}\n${msg}`, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  });
}

async function ok<T>(r: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!r.ok()) throw new Error(`${what} 返回 ${r.status()}：${await r.text()}（后端是否以 e2e profile 启动？）`);
  return (r.status() === 204 ? undefined : await r.json()) as T;
}

/** e2e 替身接口 */
export const e2e = {
  /** 等这个邮箱收到验证码邮件（邮件经真实的通知任务发出，替身代替 SMTP 收下） */
  async mailCode(api: APIRequestContext, email: string, after?: string): Promise<string> {
    let code = '';
    await expect
      .poll(
        async () => {
          const r = await api.get(`/api/e2e/mail/code?email=${encodeURIComponent(email)}`);
          if (!r.ok()) return '';
          const j = (await r.json()) as { code: string; at: string };
          if (after && j.at <= after) return '';
          code = j.code;
          return code;
        },
        { message: `等 ${email} 的验证码邮件`, timeout: 20_000, intervals: [500, 1000] },
      )
      .not.toBe('');
    return code;
  },
  async mailSubjects(api: APIRequestContext, email: string): Promise<string[]> {
    return ok(await api.get(`/api/e2e/mail/subjects?email=${encodeURIComponent(email)}`), '取邮件标题');
  },
  /** 在链替身的下一个区块里向充值地址转 USDT（此时待确认） */
  async deposit(api: APIRequestContext, chain: string, address: string, amount: string): Promise<{ txHash: string; status: string }> {
    return ok(await api.post('/api/e2e/wallet/deposit', { data: { chain, address, amount } }), '注入充值');
  },
  /** 链替身再出 blocks 个区块并扫块 */
  async mine(api: APIRequestContext, chain: string, blocks: number): Promise<void> {
    await ok(await api.post('/api/e2e/wallet/mine', { data: { chain, blocks } }), '出块');
  },
  async quote(api: APIRequestContext, symbol: string): Promise<{ bid: string; ask: string; executable: boolean }> {
    return ok(await api.get(`/api/e2e/market/quote?symbol=${symbol}`), '取报价');
  },
  /** 把原始卖价移到 bid（之后从这里继续随机游走） */
  async move(api: APIRequestContext, symbol: string, bid: number): Promise<void> {
    await ok(await api.post('/api/e2e/market/move', { data: { symbol, bid: bid.toFixed(2) } }), '推动报价');
  },
  /** 立即跑一次提现定时推进 */
  async advanceWithdrawals(api: APIRequestContext): Promise<void> {
    await ok(await api.post('/api/e2e/wallet/withdrawals/advance'), '推进提现');
  },
  /** 这笔提现的链上交易确认了 */
  async confirmWithdrawal(api: APIRequestContext, id: string): Promise<void> {
    await ok(await api.post(`/api/e2e/wallet/withdrawals/${id}/confirm`), '确认提现上链');
  },
};

/** 客户不应该收到的风控字段（AC-23：敞口、阈值、自动禁开状态等） */
const RISK_KEYS = ['longUsd', 'shortUsd', 'netUsd', 'threshold', 'platformNetUsd', 'platformThreshold', 'netThreshold', 'platformNetThreshold', 'manualPaused', 'autoPaused', 'autoGlobalPaused', 'globalManualPaused', 'autoLiquidation', 'exposure'];
const RISK_KEY_RE = new RegExp(`"(${RISK_KEYS.join('|')})"\\s*:`, 'i');

/** 记录一个页面的所有网络请求域名、/api 返回内容和 WebSocket 推送 */
export class Recorder {
  readonly hosts = new Set<string>();
  readonly apiBodies: { url: string; body: string }[] = [];
  readonly wsFrames: { url: string; body: string }[] = [];
  private pending: Promise<unknown>[] = [];

  constructor(page: Page) {
    page.on('request', (req) => {
      try {
        const host = new URL(req.url()).hostname;
        if (host) this.hosts.add(host); // data:、blob: 没有域名
      } catch {
        /* data: 等 */
      }
    });
    page.on('response', (res) => {
      const url = res.url();
      if (!new URL(url).pathname.startsWith('/api/') || new URL(url).pathname.startsWith('/api/e2e/')) return;
      this.pending.push(
        res
          .text()
          .then((body) => this.apiBodies.push({ url, body }))
          .catch(() => undefined),
      );
    });
    page.on('websocket', (ws) => {
      this.hosts.add(new URL(ws.url()).hostname);
      ws.on('framereceived', (f) => this.wsFrames.push({ url: ws.url(), body: typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8') }));
    });
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** AC-23：客户能收到的返回和推送里没有风控字段 */
  riskLeaks(): string[] {
    return [...this.apiBodies, ...this.wsFrames].filter((x) => RISK_KEY_RE.test(x.body)).map((x) => `${x.url}: ${x.body.slice(0, 300)}`);
  }

  /** AC-29：没有任何 Google 域名 */
  googleHosts(): string[] {
    return [...this.hosts].filter((h) => /(^|\.)(google|googleapis|gstatic|googletagmanager|google-analytics|doubleclick|googleusercontent)\.[a-z.]+$/i.test(h));
  }
}

/** AC-31：页面没有横向滚动 */
export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(w.scroll, `${where}：页面宽 ${w.scroll}px 超过窗口 ${w.client}px（有横向滚动）`).toBeLessThanOrEqual(w.client);
}

/**
 * AC-31（电脑）：Windows 上 1024 宽的窗口有 15～17px 的竖向滚动条，页面实际只有约 1009px 宽，但媒体查询仍按 1024 算（仍是电脑版）。
 * 测试用的无头浏览器不显示滚动条，这里给 html 右边留出 15px 模拟滚动条，再看主内容区（#main）里有没有元素超出 html 的右边。
 * body 是 overflow-x: hidden，超出的部分不会出现滚动条而是被裁掉（同样不行），所以按元素位置判断；
 * 本身可以横向滚动或裁剪的容器（例如持仓表格外面那层）里面的元素不算。
 */
export async function expectNoHorizontalScrollWithScrollbar(page: Page, where: string): Promise<void> {
  const w = await page.evaluate(async () => {
    const s = document.createElement('style');
    s.textContent = 'html { margin-right: 15px !important; }';
    document.head.appendChild(s);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const main = document.getElementById('main');
    const edge = document.documentElement.getBoundingClientRect().right;
    let right = 0;
    let what = '';
    for (const el of main ? main.querySelectorAll('*') : []) {
      let clipped = false;
      for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') {
          clipped = true;
          break;
        }
      }
      const b = el.getBoundingClientRect();
      if (!clipped && b.width > 0 && b.right > right) {
        right = b.right;
        what = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
      }
    }
    s.remove();
    return { right: Math.round(right), edge: Math.round(edge), what };
  });
  expect(w.right, `${where}（留出 15px 滚动条）：${w.what} 右边到 ${w.right}px，超过页面宽 ${w.edge}px`).toBeLessThanOrEqual(w.edge);
}

/**
 * 切换到某个标签页，直到它真的被选中。
 * 手机上提示条（toast）从顶部滑入，会盖住持仓页的标签栏：平仓推送的"止盈平仓"提示恰好在点击时出现，点击就落在提示条上，
 * 标签没有切换（PR #46 的 CI 实际发生过）。真人会再点一次，这里同样重试，并检查 aria-selected。
 */
export async function selectTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await expect(async () => {
    await tab.click({ timeout: 2_000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** 一张 1×1 的 PNG（KYC 证件照片用；后端按文件头识别 JPG/PNG） */
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * 记下页面里哪些 WebSocket 已经连上（Playwright 只报告"创建了连接"，不报告"连上了"）。只记录，不改变页面行为。
 * 用途：客户端第一次连上交易推送时不会重新拉取数据（只有断线重连才会），连上之前发生的变化页面收不到推送（问题 D-2）。
 * 测试在制造变化（出块入账）之前先等推送连上，避免把这个时间窗口当成失败。
 */
export async function trackSocketOpen(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const Native = window.WebSocket;
    const opened: string[] = [];
    (window as unknown as { __e2eWsOpened: string[] }).__e2eWsOpened = opened;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('open', () => opened.push(String(url)));
      }
    };
  });
}

/** 等页面的某个 WebSocket（地址以 path 结尾）连上 */
export async function waitSocketOpen(page: Page, path: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((p) => ((window as unknown as { __e2eWsOpened?: string[] }).__e2eWsOpened || []).some((u) => u.endsWith(p)), path), {
      message: `等 ${path} 连上`,
    })
    .toBe(true);
}
