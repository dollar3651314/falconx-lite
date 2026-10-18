-- V27（v2 提现自动审批加 R13"盈利客户"，Amos 2026-10-18："出金自动审核的限制条件中加一条，对于盈利客户需要人工审核"）：规则配置加两个键。
-- 口径（Amos 确认）：累计净盈利 = 从开户到判定时刻的已实现盈亏（账本 REALIZED_PNL）− 手续费（TRADE_FEE）− 隔夜费（SWAP），不算持仓浮动盈亏；
-- 累计净盈利 > 门槛转人工，等于门槛算通过；门槛单位 USDT、默认 0；和其他规则一样可以单独开关，默认开启。
-- 说明见 技术方案/v2-提现自动审批.md v1.2 第 2、4 节，技术方案/v1-数据库设计.md 2.47。
-- 不改配置版本号（withdraw.autoApprove.version）：版本号只在后台保存时 +1；判定记录的 config_json / results_json 里有没有 R13 就能看出是不是加了 R13 以后判的。
-- 表结构不用改：wallet_withdraw_rule_hit.rule_code 是 VARCHAR(4)，放得下 R13；failed_rules 是 VARCHAR(64)，13 条全写上也只要 42 个字符。
INSERT INTO common_config (config_key, value) VALUES
('withdraw.autoApprove.R13.enabled', 'true'),
('withdraw.autoApprove.R13.maxNetProfit', '0');
