/** AC-35：后台每个页面都能从菜单进入；需求说明书 5.2：10 个一级菜单 */
import { MENU, flattenMenu, findMenuByPath } from './menu';
import { APP_ROUTES } from './routes';
import { ALL_PERMISSION_CODES } from './permissions';

describe('菜单', () => {
  it('一级菜单共 10 个', () => {
    expect(MENU).toHaveLength(10);
  });

  it('每个页面路由都对应一个菜单入口', () => {
    const keys = new Set(flattenMenu().map((m) => m.key));
    const orphan = APP_ROUTES.filter((r) => !keys.has(r.menuKey)).map((r) => r.path);
    expect(orphan).toEqual([]);
  });

  it('每个菜单都有对应的页面路由，且权限点已登记', () => {
    const paths = new Set(APP_ROUTES.map((r) => r.path));
    for (const m of flattenMenu()) {
      expect(paths.has(m.path!)).toBe(true);
      expect(ALL_PERMISSION_CODES).toContain(m.permission);
    }
  });

  it('详情页归到列表菜单', () => {
    expect(findMenuByPath('/customers/100482')?.key).toBe('customers');
    expect(findMenuByPath('/kyc/KYC-1')?.key).toBe('kyc');
  });
});
