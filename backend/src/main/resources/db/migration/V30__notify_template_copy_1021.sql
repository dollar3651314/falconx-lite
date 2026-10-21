-- V30（2026-10-21，Amos 测试环境体验建议第 11 条，方案 技术方案/v2-体验优化-1021.md 第 11 节）：客户通知模板的文案整理。
-- Amos 原话："kyc admin审核之后消息模版变量不对，现在是：您的身份认证已通过，现在可以提现"；答复"11选a"：问题在文案，
-- 认证通过后不能只说"现在可以提现"，要说充值、交易、提现都能用。
--
-- 1. 身份认证结果拆成两个模板：KYC_APPROVED（通过，没有变量，整段文案在模板里，运营可以在后台改）和 KYC_REJECTED（驳回，变量 reason）。
--    原来的 KYC_RESULT 把"已通过，现在可以提现"写在代码里（notification/service/Render.java 的 {result} 翻译），运营改不了；
--    KycService 从这一版起只发新的两个模板。KYC_RESULT 不删、不停用：已经发出的站内信打开时仍按它生成（历史记录保持原样），
--    只把名称改成"（旧）"，提醒运营不用再改它。
-- 2. 其他模板只改"仍然完全等于 V14 原始默认文字"的（标题、正文中英文 4 段一字不差才改，utf8mb4_bin 逐字节比较，做法同 V20），
--    运营在后台改过的保留原样。已经发出的邮件、推送不改。
--    - DEPOSIT_CREDITED：到账后提示"可以开始交易了"（新手引导的终点是认证 → 充值，到账就是下一步的起点）。
--    - ORDER_FILLED：写明是限价单成交、已经开仓（这个模板只在挂单被撮合成交时发，市价单不发）。
--    - MARGIN_CALL："减仓"改成"平掉部分持仓"（现在没有部分平仓功能，"减仓"会让客户去找一个不存在的按钮）。
--    - LIQUIDATED："于 {price}"读起来像时间，改成"按 {price}"；补一句逐仓的亏损上限（只影响这一笔持仓）。

INSERT INTO notify_template (code, audience, kind, name_zh, name_en, title_zh, title_en, body_zh, body_en, variables, channels) VALUES
('KYC_APPROVED', 'USER', 'kyc', '身份认证通过', 'Identity verified',
  '身份认证已通过', 'Identity verified',
  '您的身份认证已通过，充值、交易、提现均已开通。还没有充值的话，可以在"资产"页充值 USDT 开始交易。',
  'Your identity has been verified. Deposits, trading and withdrawals are all available. If you have not deposited yet, go to Assets to deposit USDT and start trading.',
  '', 'INBOX,PUSH,EMAIL'),
('KYC_REJECTED', 'USER', 'kyc', '身份认证驳回', 'Identity verification rejected',
  '身份认证未通过', 'Identity verification not approved',
  '您的身份认证未通过，请到"身份认证"页面按原因修改后重新提交。充值和交易不受影响。\n驳回原因：{reason}',
  'Your identity verification was not approved. Please fix the issue on the Identity verification page and submit again. Deposits and trading are not affected.\nReason: {reason}',
  'reason', 'INBOX,PUSH,EMAIL');

UPDATE notify_template
SET name_zh = 'KYC 结果（旧，已改用 KYC_APPROVED / KYC_REJECTED）',
    name_en = 'KYC result (legacy, replaced by KYC_APPROVED / KYC_REJECTED)'
WHERE code = 'KYC_RESULT';

UPDATE notify_template
SET body_zh = '您通过 {chain} 充值的 {amount} USDT 已到账，现在可以开始交易了。',
    body_en = 'Your deposit of {amount} USDT via {chain} has been credited. You can start trading now.'
WHERE code = 'DEPOSIT_CREDITED'
  AND title_zh COLLATE utf8mb4_bin = '充值已到账'
  AND title_en COLLATE utf8mb4_bin = 'Deposit credited'
  AND body_zh COLLATE utf8mb4_bin = '您通过 {chain} 充值的 {amount} USDT 已到账。'
  AND body_en COLLATE utf8mb4_bin = 'Your deposit of {amount} USDT via {chain} has been credited.';

UPDATE notify_template
SET body_zh = '您的限价单 {symbol} {side} {lots} 手已按 {price} 成交，已开仓。',
    body_en = 'Your limit order {symbol} {side} {lots} lots was filled at {price}. The position is now open.'
WHERE code = 'ORDER_FILLED'
  AND title_zh COLLATE utf8mb4_bin = '挂单已成交'
  AND title_en COLLATE utf8mb4_bin = 'Order filled'
  AND body_zh COLLATE utf8mb4_bin = '{symbol} {side} {lots} 手已按 {price} 成交。'
  AND body_en COLLATE utf8mb4_bin = '{symbol} {side} {lots} lots filled at {price}.';

UPDATE notify_template
SET body_zh = '您的账户保证金水平已降至 {level}%，低于追保线 {line}%。请及时追加保证金或平掉部分持仓，避免持仓被强平。',
    body_en = 'Your account margin level fell to {level}%, below the margin call level of {line}%. Please add margin or close some positions to avoid liquidation.'
WHERE code = 'MARGIN_CALL'
  AND title_zh COLLATE utf8mb4_bin = '保证金不足提醒'
  AND title_en COLLATE utf8mb4_bin = 'Margin call'
  AND body_zh COLLATE utf8mb4_bin = '您的账户保证金水平已降至 {level}%，低于追保线 {line}%。请及时追加保证金或减仓，避免持仓被强平。'
  AND body_en COLLATE utf8mb4_bin = 'Your account margin level fell to {level}%, below the margin call level of {line}%. Please add margin or reduce positions to avoid liquidation.';

UPDATE notify_template
SET body_zh = '{symbol} 持仓已按 {price} 强制平仓，盈亏 {pnl} USDT。逐仓模式下亏损最多为这笔持仓的保证金，不影响其他持仓。',
    body_en = 'Your {symbol} position was liquidated at {price}, P/L {pnl} USDT. With isolated margin the loss is capped at this position''s margin; other positions are not affected.'
WHERE code = 'LIQUIDATED'
  AND title_zh COLLATE utf8mb4_bin = '持仓已被强平'
  AND title_en COLLATE utf8mb4_bin = 'Position liquidated'
  AND body_zh COLLATE utf8mb4_bin = '{symbol} 持仓已于 {price} 强制平仓，盈亏 {pnl} USDT。'
  AND body_en COLLATE utf8mb4_bin = 'Your {symbol} position was liquidated at {price}, P/L {pnl} USDT.';
