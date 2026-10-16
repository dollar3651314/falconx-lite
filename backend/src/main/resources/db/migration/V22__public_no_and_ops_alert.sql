-- V22（v2 第 11.3、11.4 节）：对外编号（雪花 ID）、监控告警邮件模板。说明见 技术方案/v1-数据库设计.md 第 19 节
--
-- 1. 对外编号 public_no（E11）：订单、持仓、提现、充值给客户和后台看的编号改用雪花 ID（common/id/Snowflake），内部主键仍然是自增 id。
--    旧数据：public_no = id（原来显示的编号就是 id，补齐后旧记录显示的编号不变）；新记录由应用生成雪花 ID（远大于旧的自增号，不会撞号）。
--    接口里编号一律是字符串（雪花 ID 超过 JavaScript 能精确表示的范围）。
ALTER TABLE trading_order ADD COLUMN public_no BIGINT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id' AFTER id;
UPDATE trading_order SET public_no = id;
ALTER TABLE trading_order MODIFY public_no BIGINT NOT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id',
  ADD UNIQUE KEY uk_trading_order_public_no (public_no);

ALTER TABLE trading_position ADD COLUMN public_no BIGINT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id' AFTER id;
UPDATE trading_position SET public_no = id;
ALTER TABLE trading_position MODIFY public_no BIGINT NOT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id',
  ADD UNIQUE KEY uk_trading_position_public_no (public_no);

ALTER TABLE wallet_withdrawal ADD COLUMN public_no BIGINT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id' AFTER id;
UPDATE wallet_withdrawal SET public_no = id;
ALTER TABLE wallet_withdrawal MODIFY public_no BIGINT NOT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id',
  ADD UNIQUE KEY uk_wallet_withdrawal_public_no (public_no);

ALTER TABLE wallet_deposit ADD COLUMN public_no BIGINT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id' AFTER id;
UPDATE wallet_deposit SET public_no = id;
ALTER TABLE wallet_deposit MODIFY public_no BIGINT NOT NULL COMMENT '对外编号：雪花 ID；V22 之前的旧数据等于 id',
  ADD UNIQUE KEY uk_wallet_deposit_public_no (public_no);

-- 2. 监控告警邮件（E8）：发给告警邮箱（FX_ALERT_EMAILS），按邮箱发、中英文各一份；通知模块的 alert/AlertMonitor 在告警发生和恢复时发。
--    {itemZh}/{itemEn} 是告警项的名字（例如"行情全部断流"），{detail} 是说明，{since}、{at} 是 UTC 时间
INSERT INTO notify_template (code, audience, kind, name_zh, name_en, title_zh, title_en, body_zh, body_en, variables, channels) VALUES
('OPS_ALERT', 'STAFF', NULL, '监控告警', 'Monitoring alert',
  '告警：{itemZh}', 'Alert: {itemEn}',
  '{itemZh}。\n说明：{detail}\n开始时间（UTC）：{since}\n恢复后会再发一封邮件；同一项 30 分钟内不重复发送。当前状态见健康检查 /api/health 的 alerts。',
  '{itemEn}.\nDetail: {detail}\nSince (UTC): {since}\nA recovery email will follow. The same alert is not repeated within 30 minutes. Current state: alerts in /api/health.',
  'itemZh,itemEn,detail,since', 'EMAIL'),
('OPS_RECOVERED', 'STAFF', NULL, '监控告警恢复', 'Monitoring alert recovered',
  '已恢复：{itemZh}', 'Recovered: {itemEn}',
  '{itemZh}已恢复正常。\n开始时间（UTC）：{since}\n恢复时间（UTC）：{at}',
  '{itemEn} has recovered.\nSince (UTC): {since}\nRecovered at (UTC): {at}',
  'itemZh,itemEn,since,at', 'EMAIL');
