-- V31（2026-10-21，体验优化第一批，方案 技术方案/v2-体验优化-1021.md v1.1 的 UX-9、UX-11；Amos 2026-10-21 审核"其他按建议"）
--
-- 1. UX-9（Amos 原话"消息提醒里没收到消息"）：市价开仓、手动平仓、注册以前都不发站内信。新增 3 个客户模板，
--    渠道只有 INBOX（只发站内信，不推送、不发邮件，免得刷屏）：
--    - POSITION_OPENED：市价单成交开仓（OrderService 下单的事务里发；限价挂单成交仍是 ORDER_FILLED）。
--    - POSITION_CLOSED：客户手动平仓（PositionService.close 的事务里发；止盈止损、强平仍是 TP_SL_TRIGGERED、LIQUIDATED）。
--    - WELCOME：注册成功（AuthService.register 的事务里发），内容和客户端新手引导一致：下一步是认证 → 充值。
--    kind 和客户端 NotificationKind 一致：开仓、平仓是 fill（"成交"），欢迎是 system。
-- 2. UX-11：HOT_WALLET_LOW 的 {what} 以前传"USDT 不够""手续费币不够""TRX（手续费）不够"，中文渲染成"USDT 不够 不足"，
--    英文邮件里混着中文。代码从这一版起只传币种（USDT / ETH / BNB / TRX），"余额不足"由模板写。
--    只改仍然完全等于 V14 原始默认文字的模板（中英文标题、正文 4 段一字不差才改，utf8mb4_bin 逐字节比较，做法同 V20、V30），
--    运营在后台改过的保留原样（变量名仍是 what，改过的模板照样能替换）。英文正文本来就是"The {what} balance … is too low"，不用改。
--    WITHDRAW_STATUS 的 {orderId}、WITHDRAW_STUCK 的 {withdrawalId} 改传对外编号（public_no），只改代码，模板不变。

INSERT INTO notify_template (code, audience, kind, name_zh, name_en, title_zh, title_en, body_zh, body_en, variables, channels) VALUES
('POSITION_OPENED', 'USER', 'fill', '市价开仓成交', 'Market order filled',
  '开仓成功', 'Position opened',
  '您的市价单 {symbol} {side} {lots} 手已按 {price} 成交，已开仓。可以在"持仓"里设置止盈止损或平仓。',
  'Your market order {symbol} {side} {lots} lots was filled at {price}. The position is now open; you can set take profit / stop loss or close it under Positions.',
  'symbol,side,lots,price', 'INBOX'),
('POSITION_CLOSED', 'USER', 'fill', '手动平仓', 'Position closed manually',
  '平仓成功', 'Position closed',
  '{symbol} 持仓（{side} {lots} 手）已按 {price} 平仓，盈亏 {pnl} USDT。',
  'Your {symbol} position ({side} {lots} lots) was closed at {price}, P/L {pnl} USDT.',
  'symbol,side,lots,price,pnl', 'INBOX'),
('WELCOME', 'USER', 'system', '注册欢迎', 'Welcome',
  '欢迎来到 Quick Come', 'Welcome to Quick Come',
  '开始交易前只需要两步：\n1. 完成身份认证：在"我的 → 身份认证"上传证件照片，一般 1 个工作日内审核完，结果会发到站内信和邮箱。\n2. 充值 USDT：在"资产 → 充值"选择网络，复制你的专属地址，从交易所或钱包转入 USDT，到账后就能下单。\n提现前必须完成身份认证。随时可以在"我的 → 新手引导"重新查看。',
  'Two steps before your first trade:\n1. Verify your identity: upload photos of your ID under Me → Identity verification. Reviews usually finish within one business day; the result is sent to your inbox and email.\n2. Deposit USDT: go to Assets → Deposit, choose a network, copy your own address and send USDT from an exchange or wallet. You can trade as soon as it arrives.\nWithdrawals require identity verification. You can open the guide again from Me → Getting started.',
  '', 'INBOX');

UPDATE notify_template
SET body_zh = '{chain} 热钱包 {address} 的 {what} 余额不足，提现暂停上链，请补充。'
WHERE code = 'HOT_WALLET_LOW'
  AND title_zh COLLATE utf8mb4_bin = '{chain} 热钱包余额不足'
  AND title_en COLLATE utf8mb4_bin = '{chain} hot wallet balance low'
  AND body_zh COLLATE utf8mb4_bin = '{chain} 热钱包 {address} 的 {what} 不足，提现暂停上链，请补充。'
  AND body_en COLLATE utf8mb4_bin = 'The {what} balance of the {chain} hot wallet {address} is too low. Withdrawals are on hold until it is topped up.';
