/**
 * 主流程（S19；需求说明书第 7 节 AC 对照见 测试报告/v1-端到端测试方案.md 第 5 节）：
 * 客户在 390px 宽的手机上：注册（邮箱验证码）→ 退出后登录 → 充值到账 → 提交 KYC → 市价下单 → 设止盈止损 → 报价触发止盈自动平仓
 * → 再开一单手动平仓 → 资金流水 → 加白名单 → 提现；超管在电脑上：首次登录改密码 → 审核 KYC → 出金审核 → 查看客户；
 * 广播成功、链上确认后客户看到提现已完成。
 * 每轮用新邮箱、新证件号，不依赖上一轮的数据。外部依赖（邮件、链、LP 行情、提现广播）由后端 e2e profile 的替身代替。
 * 两种形态共用（tests/targets.ts）：默认经 server.mjs；部署形态经 Nginx 镜像（HTTPS、两个域名），另外检查登录 Cookie 带 Secure、
 * 两个前端顶部有"测试环境"标识条。
 */
import { expect, request as apiRequest, test, type BrowserContext, type Page } from '@playwright/test';
import { adminLogin, cjk, confirmAndWait, setConfig } from './admin';
import { CLIENT_PASSWORD, e2e, expectNoHorizontalScroll, PNG_1PX, Recorder, step, SYMBOL, trackSocketOpen, uniqueId, waitSocketOpen } from './support';
import { ADMIN_URL, CLIENT_URL, DEPLOYED, EXPECT_ENV_BANNER, STUB_URL } from './targets';

const DEPOSIT = '1000';
const WITHDRAW = '100';
/** 白名单地址：任意合法的以太坊地址（链替身不会真的转账） */
const WITHDRAW_TO = '0x00000000000000000000000000000000e2e0beef';

/** 手机上从品种页打开下单抽屉，市价买入 lots 手 */
async function marketBuy(page: Page, lots: string): Promise<void> {
  await page.goto(`/trade/${SYMBOL}`);
  await page.locator('.m-actbar').getByRole('button', { name: /^买入/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('买入 · 逐仓')).toBeVisible();
  await sheet.getByRole('button', { name: lots, exact: true }).click();
  await expect(sheet.locator('#lots-input')).toHaveValue(lots);
  await sheet.getByRole('button', { name: `确认买入 ${lots} 手 ${SYMBOL}` }).click();
  await page.getByRole('button', { name: '确认买入', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** 部署形态：登录 Cookie 必须是 HttpOnly + Secure（测试环境 FX_COOKIE_SECURE=true，经 HTTPS 才能保存） */
async function expectSecureCookie(ctx: BrowserContext, name: string): Promise<void> {
  if (!DEPLOYED) return;
  const c = (await ctx.cookies()).find((x) => x.name === name);
  expect(c, `登录后应有 Cookie ${name}`).toBeTruthy();
  expect(c?.secure, `${name} 带 Secure`).toBe(true);
  expect(c?.httpOnly, `${name} 带 HttpOnly`).toBe(true);
}

/** 后端设了 FX_ENV_LABEL 时，页面顶部显示"测试环境"标识条 */
async function expectEnvBanner(page: Page): Promise<void> {
  if (!EXPECT_ENV_BANNER) return;
  await expect(page.getByTestId('env-banner')).toBeVisible();
  await expect(page.getByTestId('env-banner')).toContainText('测试环境');
}

test('客户主流程（手机 390px）和后台审核', async ({ browser }) => {
  const id = uniqueId();
  const email = `e2e-${id}@example.com`;
  const client = await browser.newContext({ baseURL: CLIENT_URL, ignoreHTTPSErrors: DEPLOYED, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', serviceWorkers: 'block' });
  const admin = await browser.newContext({ baseURL: ADMIN_URL, ignoreHTTPSErrors: DEPLOYED, viewport: { width: 1440, height: 900 }, locale: 'zh-CN', serviceWorkers: 'block' });
  // 替身接口：测试代码直接访问（部署形态是后端 127.0.0.1:8080，Nginx 不转发 /api/e2e/）
  const request = await apiRequest.newContext({ baseURL: STUB_URL });
  await trackSocketOpen(client);
  const page = await client.newPage();
  const adminPage = await admin.newPage();
  const rec = new Recorder(page);
  const adminRec = new Recorder(adminPage);
  test.info().annotations.push({ type: '客户邮箱', description: email });

  try {
    await step('后台：超管登录（首次登录先改密码）', async () => {
      const first = await adminLogin(adminPage);
      test.info().annotations.push({ type: '超管', description: first ? '首次登录，已改密码' : '已改过密码，直接登录' });
      await expectSecureCookie(admin, 'fx_admin_session');
      await expectEnvBanner(adminPage);
      // 测试不等 2 小时冷静期和 24 小时白名单生效：超管在系统配置里改成 0（规则本身由后端测试覆盖，AC-17、AC-18）
      await setConfig(adminPage, 'withdraw.coolingHours', '0');
      await setConfig(adminPage, 'whitelist.effectiveHours', '0');
    });

    await step('客户：用邮箱验证码注册', async () => {
      await page.goto('/register');
      await page.getByLabel('邮箱', { exact: true }).fill(email);
      const sentAt = new Date(Date.now() - 1000).toISOString();
      await page.getByRole('button', { name: '发送验证码' }).click();
      await expect(page.getByText(`验证码已发送到 ${email}`)).toBeVisible();
      const code = await e2e.mailCode(request, email, sentAt);
      await page.getByLabel('邮箱验证码').fill(code);
      await page.getByLabel('密码', { exact: true }).fill(CLIENT_PASSWORD);
      await page.getByLabel('确认密码').fill(CLIENT_PASSWORD);
      await page.getByLabel('名', { exact: true }).fill('测试');
      await page.getByLabel('姓', { exact: true }).fill('端到端');
      await page.getByLabel('出生日期').fill('1990-01-01');
      await page.getByLabel('国籍').click();
      await page.getByRole('textbox', { name: '搜索' }).fill('CN');
      await page.getByRole('option').first().click();
      await page.getByRole('checkbox').check();
      await expectNoHorizontalScroll(page, '注册页');
      await page.getByRole('button', { name: '注册', exact: true }).click();
      await expect(page).toHaveURL(/\/markets$/);
    });

    await step('客户：退出登录，再用邮箱和密码登录', async () => {
      await page.goto('/me');
      await page.getByRole('button', { name: '退出登录' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '退出登录' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.getByLabel('邮箱', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(CLIENT_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page).toHaveURL(/\/markets$/);
      await expectSecureCookie(client, 'fx_session');
      await expectEnvBanner(page);
      await expectNoHorizontalScroll(page, '行情页');
    });

    let address = '';
    await step('客户：三条链的充值地址（ERC20 和 BSC 相同）', async () => {
      await page.goto('/assets');
      const addr = page.locator('.qr-wrap .addr .num');
      const read = async (net: string) => {
        await page.getByRole('radio', { name: new RegExp(`^${net}`) }).click();
        await expect(addr).toBeVisible();
        return (await addr.innerText()).replace(/\s+/g, '');
      };
      const erc20 = await read('ERC20');
      const bsc = await read('BSC');
      address = await read('TRC20');
      expect(erc20, 'ERC20 地址').toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(bsc, 'ERC20 和 BSC 是同一个地址（AC-06）').toBe(erc20);
      expect(address, 'TRC20 地址').toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
      await expectNoHorizontalScroll(page, '资产页');
    });

    await step(`客户：链上转入 ${DEPOSIT} USDT（TRC20），先显示待确认，确认数够了到账`, async () => {
      // 先等交易推送连上再转账。D-2 已修（每次连上都重新拉取），保留这一步让测试不依赖时间窗口
      await waitSocketOpen(page, '/api/ws/trading');
      const r = await e2e.deposit(request, 'TRC20', address, DEPOSIT);
      expect(r.status).toBe('PENDING');
      // 发现待确认的充值时后端就推送 deposit 事件，不刷新页面也能看到"待确认"（E2E-2 已修复）
      await expect(page.getByText(/待确认 \d+\/19/)).toBeVisible();
      await e2e.mine(request, 'TRC20', 25);
      await expect(page.getByText('已到账 · TRC20')).toBeVisible();
      // 站内信推送的提示（AC-07 客户收到通知）
      await expect(page.getByText('充值已到账').first()).toBeVisible();
      await expect(page.locator('.assets-hero, .card').getByText('1,000.00').first()).toBeVisible();
    }, 90_000);

    await step('客户：提交 KYC（护照 + 3 张照片）', async () => {
      await page.goto('/me/kyc');
      await page.getByRole('radio', { name: '护照' }).click();
      await page.getByLabel('证件号').fill(`E2E${id}`.toUpperCase().slice(0, 12));
      for (const slot of ['front', 'back', 'selfie']) {
        await page.locator(`#kyc-${slot}`).setInputFiles({ name: `${slot}.png`, mimeType: 'image/png', buffer: PNG_1PX });
      }
      await page.getByRole('button', { name: '提交审核' }).click();
      await expect(page.getByText('审核中')).toBeVisible();
    });

    await step('后台：KYC 审核通过', async () => {
      await adminPage.goto('/admin/kyc');
      const row = adminPage.getByRole('row').filter({ hasText: email });
      await row.getByRole('link', { name: '审核' }).click();
      await expect(adminPage.getByText(email)).toBeVisible();
      await expect(adminPage.getByRole('img', { name: '证件正面' })).toBeVisible();
      await adminPage.getByRole('button', { name: cjk('通过') }).click();
      await confirmAndWait(adminPage, cjk('通过'), '/review');
      await expect(adminPage.locator('.ant-tag, .pill').getByText('已通过').first()).toBeVisible();
    });

    let bid = 0;
    await step(`客户：市价买入 0.01 手 ${SYMBOL}`, async () => {
      await marketBuy(page, '0.01');
      await page.goto('/positions');
      await expect(page.locator('.pos-card').filter({ hasText: SYMBOL })).toHaveCount(1);
      await expectNoHorizontalScroll(page, '持仓页');
      bid = Number((await e2e.quote(request, SYMBOL)).bid);
    });

    // 价格只推动不到 1%：质量守卫把 60 秒内波动超过 5% 的报价判为异常、不能成交（连续跑几轮也不会超过）
    const tp = Math.round(bid * 1.004 * 100) / 100;
    const sl = Math.round(bid * 0.99 * 100) / 100;
    await step(`客户：设止盈 ${tp}、止损 ${sl}`, async () => {
      const card = page.locator('.pos-card').filter({ hasText: SYMBOL });
      await card.getByRole('button', { name: '止盈止损' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByRole('switch', { name: '设置止盈' }).click();
      await dlg.getByLabel('止盈价').fill(tp.toFixed(2));
      await dlg.getByRole('switch', { name: '设置止损' }).click();
      await dlg.getByLabel('止损价').fill(sl.toFixed(2));
      await dlg.getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('止盈止损已更新')).toBeVisible();
      await expect(card.locator('.tpsl-line')).toContainText('止盈');
    });

    await step('报价涨过止盈价：自动平仓（止盈）', async () => {
      await e2e.move(request, SYMBOL, bid * 1.007);
      await expect(page.getByText('暂无持仓')).toBeVisible();
      await page.getByRole('tab', { name: '历史' }).click();
      await expect(page.locator('.hist-row').filter({ hasText: SYMBOL }).getByText('止盈')).toBeVisible();
    });

    await step('客户：再开一单，手动平仓', async () => {
      await marketBuy(page, '0.01');
      await page.goto('/positions');
      const card = page.locator('.pos-card').filter({ hasText: SYMBOL });
      await expect(card).toHaveCount(1);
      await card.getByRole('button', { name: '平仓', exact: true }).click();
      await page.getByRole('button', { name: '确认平仓' }).click();
      await expect(page.getByText('已平仓')).toBeVisible();
      await expect(page.getByText('暂无持仓')).toBeVisible();
      await page.getByRole('tab', { name: '历史' }).click();
      await expect(page.locator('.hist-row').filter({ hasText: '手动平仓' })).toHaveCount(1);
    });

    await step('客户：资金流水里有充值、手续费、平仓盈亏', async () => {
      await page.goto('/assets/ledger');
      const list = page.locator('.ledger');
      await expect(list.getByText(/^充值( · |$)/).first()).toBeVisible();
      await expect(list.getByText(/^手续费( · |$)/).first()).toBeVisible();
      // E2E-3：显示品种代码，不显示平仓原因
      await expect(list.getByText('平仓盈亏 · ETHUSD').first()).toBeVisible();
      await expect(list.getByText(/平仓盈亏 · (CLOSED|TP|SL|LIQUIDATED)/)).toHaveCount(0);
      await expectNoHorizontalScroll(page, '资金流水页');
    });

    await step('客户：加白名单地址（ERC20）', async () => {
      await page.goto('/assets/whitelist');
      await page.getByRole('button', { name: '添加地址' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByRole('radio', { name: 'ERC20' }).click();
      await dlg.getByLabel('地址', { exact: true }).fill(WITHDRAW_TO);
      await dlg.getByLabel('备注名').fill('端到端测试钱包');
      await dlg.getByRole('button', { name: '确认添加' }).click();
      await expect(page.getByText('地址已添加')).toBeVisible();
      await expect(page.locator('.wl-list li').filter({ hasText: WITHDRAW_TO })).toContainText('已生效');
    });

    await step(`客户：提现 ${WITHDRAW} USDT`, async () => {
      await page.goto('/assets/withdraw');
      await expect(page.getByText('身份认证已通过')).toBeVisible();
      await page.getByLabel('提现金额').fill(WITHDRAW);
      await expectNoHorizontalScroll(page, '提现页');
      await page.getByRole('button', { name: '提交提现' }).click();
      await page.getByRole('button', { name: '确认提交' }).click();
      await expect(page.getByText('提现已提交')).toBeVisible();
      await expect(page.locator('.wd-recs li').first()).toContainText(/冷静期中|待审核/);
      // 冷静期为 0：立即跑一次定时推进（不用等 30 秒），进入待审核
      await e2e.advanceWithdrawals(request);
      await expect(page.locator('.wd-recs li').first()).toContainText('待审核');
    });

    let withdrawalId = '';
    await step('后台：出金审核通过（立即广播）', async () => {
      await adminPage.goto('/admin/funds/withdrawals');
      await adminPage.getByRole('row').filter({ hasText: email }).first().click();
      const detail = adminPage.getByRole('complementary', { name: '出金详情' });
      await expect(detail).toContainText(email);
      withdrawalId = ((await detail.locator('h3 .num').innerText()) || '').trim();
      expect(withdrawalId).toMatch(/^\d+$/);
      await detail.getByRole('button', { name: cjk('通过') }).click();
      await confirmAndWait(adminPage, cjk('通过'), `/api/admin/withdrawals/${withdrawalId}/approve`);
      await expect(page.locator('.wd-recs li').first()).toContainText('上链中');
    });

    await step('链上确认：提现完成，客户看到已完成', async () => {
      await e2e.confirmWithdrawal(request, withdrawalId);
      await expect(page.locator('.wd-recs li').first()).toContainText('已完成');
      await page.goto('/assets/ledger');
      await expect(page.locator('.ledger').getByText(/^提现( · |$)/).first()).toBeVisible();
    });

    await step('后台：查看客户（KYC 已通过、有资金流水）', async () => {
      await adminPage.goto('/admin/customers');
      await adminPage.locator('#c-kw').fill(email);
      await adminPage.getByRole('button', { name: cjk('查询') }).click();
      const row = adminPage.getByRole('row').filter({ hasText: email });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('已通过');
      await row.getByRole('link', { name: '详情' }).click();
      await expect(adminPage.getByText(email).first()).toBeVisible();
      await expect(adminPage.getByText('最近资金流水')).toBeVisible();
    });

    await step('通知邮件：验证码、入金到账、KYC 结果、出金状态都发到客户邮箱', async () => {
      // 邮件任务每 2 秒发一次：等全部到齐（AC-05 KYC 结果、AC-07 到账通知、AC-19 提现状态）
      for (const subject of ['FalconX 验证码', '充值已到账', '身份认证结果', '止盈止损已触发', '提现状态更新']) {
        await expect.poll(async () => (await e2e.mailSubjects(request, email)).join(' | '), { message: `等邮件「${subject}」`, timeout: 20_000 }).toContain(subject);
      }
      const subjects = (await e2e.mailSubjects(request, email)).join(' | ');
      test.info().annotations.push({ type: '客户收到的邮件', description: subjects });
    });

    await step('AC-23 风控信息不外泄、AC-29 不依赖 Google', async () => {
      await rec.settle();
      await adminRec.settle();
      expect(rec.apiBodies.length, '记录到的客户接口返回').toBeGreaterThan(20);
      expect(rec.wsFrames.length, '记录到的客户推送').toBeGreaterThan(0);
      expect(rec.riskLeaks(), '客户收到的接口返回和推送里不能有风控字段').toEqual([]);
      expect([...rec.googleHosts(), ...adminRec.googleHosts()], '不能请求 Google 域名').toEqual([]);
      test.info().annotations.push({
        type: '记录',
        description: `客户接口返回 ${rec.apiBodies.length} 条、推送 ${rec.wsFrames.length} 条；访问的域名：${[...new Set([...rec.hosts, ...adminRec.hosts])].join(', ')}`,
      });
    });
  } finally {
    await client.close();
    await admin.close();
    await request.dispose();
  }
});
