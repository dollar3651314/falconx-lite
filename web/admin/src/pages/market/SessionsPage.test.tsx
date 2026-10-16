import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { listHolidays, switchIdentity } from '../../api';
import { renderAs } from '../../test/render';
import { SessionsPage } from './SessionsPage';

/** 一个明确在未来的日期（DatePicker 禁用今天以前的日子） */
const FUTURE = `${new Date().getUTCFullYear() + 1}-03-27`;

describe('休市日：antd DatePicker（选日期）', () => {
  beforeEach(async () => {
    await switchIdentity('super');
  });

  it('必填；中文日历（一周从周一开始）；今天以前不能选；提交的是 YYYY-MM-DD 字符串', async () => {
    renderAs(<SessionsPage />, { path: '/market/sessions' });
    // 登录信息加载完才有权限；按钮从"无权限（带提示）"换成可用时是新的元素，每次重新找
    await waitFor(() => expect(screen.getByRole('button', { name: /新增休市日/ })).toBeEnabled(), { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: /新增休市日/ }));
    const dialog = await screen.findByRole('dialog');

    // 不填日期直接保存：提示必填
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(await within(dialog).findByText('必填')).toBeInTheDocument();

    const input = within(dialog).getByLabelText('日期');
    expect(input).toHaveAttribute('placeholder', 'YYYY-MM-DD');
    fireEvent.mouseDown(input);
    fireEvent.click(input);
    const panel = await waitFor(() => {
      const p = document.querySelector('.ant-picker-dropdown');
      if (!p) throw new Error('日历没有弹出');
      return p as HTMLElement;
    });
    // dayjs 用了 zh-cn：星期表头从"一"开始（英文默认从周日开始）
    expect([...panel.querySelectorAll('thead th')].map((th) => th.textContent)[0]).toBe('一');
    // 当前月里今天以前的日子是禁用的（每月 1 日当天没有"以前"，只在今天不是 1 日时检查）
    if (new Date().getUTCDate() > 1) expect(panel.querySelector('.ant-picker-cell-in-view.ant-picker-cell-disabled')).not.toBeNull();

    // 电脑上也可以直接在框里输入
    fireEvent.change(input, { target: { value: FUTURE } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await listHolidays()).some((h) => h.date === FUTURE && h.symbol === '*')).toBe(true));
  }, 60_000);
});
