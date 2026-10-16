/**
 * 新增品种（v2 E3，高危）：代码（唯一）、中英文名、类别、小数位、合约大小、报价货币、最大杠杆、维持保证金率、开仓手续费率、
 * 最小 / 最大手数、手数步长、加点、交易时段（从已有品种复制或选模板）、是否热门。
 * 新增后默认"暂停开仓"：运营确认报价正常后在品种的"编辑"里打开。新品种不需要重启就被行情、撮合、风控、K 线认得；
 * 但要有报价源给它报价（模拟报价源只给有起始价的品种报价，新品种显示"暂无报价"）。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Radio, Select, Space, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { createSymbol, listSessions } from '../../api';
import type { SessionTemplate, SymbolCategory, SymbolCreateInput } from '../../api/types';
import { BACKEND_CATEGORIES, SESSION_TEMPLATES } from '../../config/constants';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { compareAmounts } from '../../utils/money';
import { CURRENCY_RE, SYMBOL_CODE_RE } from '../../utils/validators';

/** 手数：正数，最多 8 位小数（后端口径） */
const LOTS_RE = /^(0\.\d{1,8}|[1-9]\d*(\.\d{1,8})?)$/;
/** 非负小数，最多 8 位 */
const DEC_RE = /^\d+(\.\d{1,8})?$/;

interface CreateValues {
  code: string;
  nameZh: string;
  nameEn: string;
  category: SymbolCategory;
  digits: number;
  contractSize: string;
  quoteCurrency: string;
  maxLeverage: number;
  maintenanceMarginRate: string;
  openFeeRate: string;
  minLots: string;
  maxLots: string;
  lotStep: string;
  markup: string;
  hot: boolean;
  sessionSource: 'template' | 'copy';
  sessionTemplate?: SessionTemplate;
  copySessionsFrom?: string;
}

const INITIAL: Partial<CreateValues> = {
  category: 'crypto',
  digits: 2,
  contractSize: '1',
  quoteCurrency: 'USD',
  maxLeverage: 50,
  maintenanceMarginRate: '0.005',
  openFeeRate: '0.0005',
  minLots: '0.01',
  maxLots: '20',
  lotStep: '0.01',
  markup: '0',
  hot: false,
  sessionSource: 'template',
  sessionTemplate: 'crypto',
};

export function SymbolCreateDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (code: string) => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<CreateValues>();
  const [sources, setSources] = useState<string[]>([]);
  const hr = useHighRisk();
  const source = Form.useWatch('sessionSource', form);

  // 可以复制时段的品种：已经配置了交易时段的
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listSessions().then(
      (list) => alive && setSources(list.map((s) => s.symbol).sort()),
      () => alive && setSources([]),
    );
    return () => {
      alive = false;
    };
  }, [open]);

  const submit = async () => {
    let v: CreateValues;
    try {
      v = await form.validateFields();
    } catch {
      return; // 字段错误已一次性显示
    }
    const input: SymbolCreateInput = {
      code: v.code.trim().toUpperCase(),
      nameZh: v.nameZh.trim(),
      nameEn: v.nameEn.trim(),
      category: v.category,
      digits: v.digits,
      contractSize: v.contractSize.trim(),
      quoteCurrency: v.quoteCurrency.trim().toUpperCase(),
      maxLeverage: v.maxLeverage,
      maintenanceMarginRate: v.maintenanceMarginRate.trim(),
      openFeeRate: v.openFeeRate.trim(),
      minLots: v.minLots.trim(),
      maxLots: v.maxLots.trim(),
      lotStep: v.lotStep.trim(),
      markup: (v.markup ?? '0').trim() || '0',
      hot: !!v.hot,
      ...(v.sessionSource === 'copy' ? { copySessionsFrom: v.copySessionsFrom } : { sessionTemplate: v.sessionTemplate }),
    };
    hr.ask({
      title: t('symbols.createConfirm', { code: input.code }),
      description: t('symbols.createDesc'),
      onConfirm: (r) => createSymbol(input, r.reason),
      successText: t('symbols.created', { code: input.code }),
      onDone: () => {
        form.resetFields();
        onCreated(input.code);
      },
    });
  };

  const required = { required: true, message: t('validation.required') };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={t('symbols.createTitle')}
        rootClassName="menu-drawer-root"
        width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth : 560)}
        destroyOnClose
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="primary" onClick={() => void submit()}>
              {t('symbols.createSubmit')}
            </Button>
          </Space>
        }
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('symbols.createPausedHint')} description={t('symbols.createQuoteHint')} />
        <Form form={form} layout="vertical" name="symbol-create" requiredMark initialValues={INITIAL} className="symbol-form">
          <div className="grid2">
            <Form.Item
              name="code"
              label={t('symbols.code')}
              extra={t('symbols.codeHint')}
              normalize={(v: string) => (v ?? '').toUpperCase()}
              rules={[required, { pattern: SYMBOL_CODE_RE, message: t('validation.symbolCode') }]}
            >
              <Input maxLength={16} autoComplete="off" />
            </Form.Item>
            <Form.Item name="category" label={t('symbols.category')} rules={[required]}>
              <Select options={BACKEND_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))} />
            </Form.Item>
            <Form.Item name="nameZh" label={t('symbols.nameZh')} rules={[required, { max: 64, message: t('validation.tooLong', { max: 64 }) }]}>
              <Input />
            </Form.Item>
            <Form.Item name="nameEn" label={t('symbols.nameEn')} rules={[required, { max: 64, message: t('validation.tooLong', { max: 64 }) }]}>
              <Input />
            </Form.Item>
            <Form.Item name="digits" label={t('symbols.digits')} rules={[{ required: true, type: 'integer', min: 0, max: 8, message: t('validation.digitsRange') }]}>
              <InputNumber style={{ width: '100%' }} min={0} max={8} precision={0} />
            </Form.Item>
            <Form.Item name="contractSize" label={t('symbols.contractSize')} rules={[required, { pattern: LOTS_RE, message: t('validation.positiveNumber') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item
              name="quoteCurrency"
              label={t('symbols.quoteCurrency')}
              extra={t('symbols.quoteCurrencyHint')}
              normalize={(v: string) => (v ?? '').toUpperCase()}
              rules={[required, { pattern: CURRENCY_RE, message: t('validation.currencyFormat') }]}
            >
              <Input maxLength={4} />
            </Form.Item>
            <Form.Item name="maxLeverage" label={t('symbols.maxLeverage')} rules={[{ required: true, type: 'integer', min: 1, max: 1000, message: t('validation.leverageRange') }]}>
              <InputNumber style={{ width: '100%' }} min={1} max={1000} precision={0} addonAfter="x" />
            </Form.Item>
            <Form.Item
              name="maintenanceMarginRate"
              label={t('symbols.mmr')}
              extra={t('symbols.rateHint')}
              rules={[
                required,
                {
                  validator: (_r, v: string | undefined) =>
                    !v || (DEC_RE.test(v.trim()) && compareAmounts(v, '0', 8) > 0 && compareAmounts(v, '0.5', 8) <= 0)
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('validation.mmrRange'))),
                },
              ]}
            >
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item
              name="openFeeRate"
              label={t('symbols.fee')}
              extra={t('symbols.rateHint')}
              rules={[
                required,
                {
                  validator: (_r, v: string | undefined) =>
                    !v || (DEC_RE.test(v.trim()) && compareAmounts(v, '0.01', 8) <= 0) ? Promise.resolve() : Promise.reject(new Error(t('validation.feeRange'))),
                },
              ]}
            >
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="minLots" label={t('symbols.minLots')} rules={[required, { pattern: LOTS_RE, message: t('validation.lotsFormat') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item
              name="maxLots"
              label={t('symbols.maxLots')}
              dependencies={['minLots']}
              rules={[
                required,
                { pattern: LOTS_RE, message: t('validation.lotsFormat') },
                ({ getFieldValue }) => ({
                  validator: (_r, v: string | undefined) =>
                    !v || !LOTS_RE.test(v) || !LOTS_RE.test(getFieldValue('minLots') ?? '') || compareAmounts(v, getFieldValue('minLots'), 8) >= 0
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('validation.maxLotsBelowMin'))),
                }),
              ]}
            >
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="lotStep" label={t('symbols.lotStep')} rules={[required, { pattern: LOTS_RE, message: t('validation.lotsFormat') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="markup" label={t('symbols.spread')} extra={t('symbols.markupHint')} rules={[{ pattern: DEC_RE, message: t('validation.nonNegativeNumber') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
          </div>
          <Form.Item name="sessionSource" label={t('symbols.sessionSource')} rules={[required]}>
            <Radio.Group
              options={[
                { value: 'template', label: t('symbols.sessionFromTemplate') },
                { value: 'copy', label: t('symbols.sessionFromSymbol') },
              ]}
            />
          </Form.Item>
          {source === 'copy' ? (
            <Form.Item name="copySessionsFrom" label={t('symbols.copySessionsFrom')} rules={[required]}>
              <Select showSearch aria-label={t('symbols.copySessionsFrom')} options={sources.map((s) => ({ value: s, label: s }))} placeholder={t('symbols.pickSymbol')} />
            </Form.Item>
          ) : (
            <Form.Item name="sessionTemplate" label={t('symbols.sessionTemplate')} rules={[required]}>
              <Select aria-label={t('symbols.sessionTemplate')} options={SESSION_TEMPLATES.map((s) => ({ value: s, label: t(`sessionTemplate.${s}`) }))} />
            </Form.Item>
          )}
          <Form.Item name="hot" label={t('symbols.hot')} valuePropName="checked" extra={t('symbols.hotHint')}>
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
      {hr.element}
    </>
  );
}
