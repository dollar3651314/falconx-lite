/**
 * 后台的公共操作：超管登录（首次登录要求改密码就改）、按测试需要设置系统配置。
 */
import { expect, type Page } from '@playwright/test';
import { ADMIN_INIT_PASSWORD, ADMIN_NEW_PASSWORD, ADMIN_USERNAME } from './support';

/** Ant Design 会在两个汉字的按钮中间加空格（"通 过"），按钮前面可能有图标名（"check 通过"）：按"以这几个字结尾、字之间可以有空格"匹配 */
export function cjk(text: string): RegExp {
  return new RegExp(`(^|\\s)${[...text].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s?')}\\s*$`);
}

async function submitLogin(page: Page, password: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('账号', { exact: true }).fill(ADMIN_USERNAME);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: cjk('登录') }).click();
}

/**
 * 超管登录。新库里第一次用 FX_ADMIN_INIT_PASSWORD 登录，后台要求先改密码（后台方案 G1），改成 ADMIN_NEW_PASSWORD；
 * 本机重复跑、库里已经改过密码时，直接用新密码登录。
 * @returns 这次是否走了"首次登录改密码"
 */
export async function adminLogin(page: Page): Promise<boolean> {
  await submitLogin(page, ADMIN_INIT_PASSWORD);
  const loginError = page.locator('.ant-alert-error');
  let state = '';
  await expect
    .poll(
      async () => {
        const url = page.url();
        if (url.includes('/admin/change-password')) state = 'change';
        else if (await loginError.isVisible()) state = 'error';
        else if (!url.includes('/admin/login')) state = 'home';
        else state = '';
        return state;
      },
      { message: '等登录结果' },
    )
    .not.toBe('');
  if (state === 'change') {
    await expect(page.getByRole('heading', { name: '首次登录：请设置新密码' })).toBeVisible();
    await page.getByLabel('临时密码').fill(ADMIN_INIT_PASSWORD);
    await page.getByLabel('新密码', { exact: true }).fill(ADMIN_NEW_PASSWORD);
    await page.getByLabel('确认新密码').fill(ADMIN_NEW_PASSWORD);
    await page.getByRole('button', { name: '保存新密码' }).click();
    await expect(page).toHaveURL(/\/admin\/?(dashboard)?$/);
    return true;
  }
  if (state === 'error') {
    await submitLogin(page, ADMIN_NEW_PASSWORD);
  }
  await expect(page).toHaveURL(/\/admin\/?(dashboard)?$/);
  return false;
}

/**
 * 改一项系统配置（后台的系统配置接口，和系统配置页同一个接口；会写审计）。
 * 在后台页面里同源 fetch（和页面自己调接口一样走浏览器）：部署形态的假域名只有浏览器能解析，测试进程访问不到。
 */
export async function setConfig(page: Page, key: string, value: string): Promise<void> {
  const r = await page.evaluate(
    async ({ key, value }) => {
      const res = await fetch(`/api/admin/configs/${encodeURIComponent(key)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, reason: '端到端测试：不等冷静期和白名单生效时间' }),
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
    { key, value },
  );
  expect(r.ok, `设置 ${key}=${value} 返回 ${r.status} ${r.text}`).toBeTruthy();
}
