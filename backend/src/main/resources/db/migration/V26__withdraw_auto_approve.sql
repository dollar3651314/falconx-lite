-- V26（v2 提现自动审批，Amos 2026-10-17 确认"按建议"）：判定记录、触发的规则、全局锁、账号安全事件、提现单 3 列、规则配置初始值。
-- 说明见 技术方案/v2-提现自动审批.md 第 5、6、7 节，技术方案/v1-数据库设计.md 2.47–2.50。规则只决定"要不要人工看"，不放宽任何限额。

-- 1. 判定记录：每次判定一行（提交时预判 PRECHECK、冷静期结束时复判 FINAL），只增不改。
--    config_json 是判定那一刻整份配置的快照，results_json 是 12 条逐条结果（编号、状态 passed / failed / disabled / unknown、数值），以后改规则不影响历史记录的解读
CREATE TABLE wallet_withdraw_rule_check (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  withdrawal_id  BIGINT       NOT NULL,
  phase          VARCHAR(8)   NOT NULL COMMENT 'PRECHECK 提交时预判（只做参考、不占额度）/ FINAL 冷静期结束时复判（以这次为准）',
  outcome        VARCHAR(16)  NOT NULL COMMENT 'AUTO_APPROVED / MANUAL / MASTER_OFF / ERROR（有规则无法判定，按转人工处理）',
  master_enabled TINYINT(1)   NOT NULL COMMENT '判定时总开关的状态',
  failed_rules   VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '没通过和无法判定的规则，例如 R1,R5（显示用）',
  config_version INT          NOT NULL COMMENT '判定时的规则配置版本（common_config 的 withdraw.autoApprove.version）',
  config_json    JSON         NOT NULL,
  results_json   JSON         NOT NULL,
  decided_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_wallet_withdraw_rule_check (withdrawal_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现自动审批的判定记录，只增不改';

-- 2. 没通过（含无法判定）的规则，一条一行：给后台出金列表"触发了某条规则"筛选用，不在 JSON 里搜。
--    只保留最近一次判定的：冷静期中是预判的，复判时删掉预判的行再写复判的
CREATE TABLE wallet_withdraw_rule_hit (
  id            BIGINT      NOT NULL AUTO_INCREMENT,
  check_id      BIGINT      NOT NULL,
  withdrawal_id BIGINT      NOT NULL,
  rule_code     VARCHAR(4)  NOT NULL COMMENT 'R1 … R12',
  PRIMARY KEY (id),
  KEY idx_wallet_withdraw_rule_hit (rule_code, withdrawal_id),
  KEY idx_wallet_withdraw_rule_hit_wd (withdrawal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现自动审批触发的规则（筛选用）';

-- 3. 提现单：审核方式（AUTO 自动通过 / MANUAL 人工通过或驳回；冷静期中、待审核时为空）、自动通过时间、最近一次判定
ALTER TABLE wallet_withdrawal
  ADD COLUMN review_mode      VARCHAR(8)  NULL COMMENT 'AUTO / MANUAL；还没审核时为空' AFTER reviewed_at,
  ADD COLUMN auto_approved_at DATETIME(3) NULL COMMENT '自动通过的时间（R2 / R3 的 24 小时累计按它算）' AFTER review_mode,
  ADD COLUMN last_check_id    BIGINT      NULL COMMENT '最近一次判定（wallet_withdraw_rule_check.id），列表直接取摘要' AFTER auto_approved_at,
  ADD KEY idx_wallet_withdrawal_auto (review_mode, auto_approved_at),
  ADD KEY idx_wallet_withdrawal_user_auto (user_id, review_mode, auto_approved_at);

-- 4. 全局锁：只有一行。总开关打开时，所有自动审批的复判在这一行上排队（SELECT … FOR UPDATE），R2 / R3 的累计和判定在同一个事务里
CREATE TABLE wallet_auto_approve_lock (
  id TINYINT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现自动审批的全局锁（只有一行）';
INSERT INTO wallet_auto_approve_lock (id) VALUES (1);

-- 5. 账号安全事件（account 模块写，R6 用）：改密码、忘记密码重置、改邮箱（v1 没有这个功能，先留类型）、后台冻结 / 解冻，和操作同一个事务写入
CREATE TABLE account_security_event (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  user_id    BIGINT      NOT NULL,
  type       VARCHAR(16) NOT NULL COMMENT 'PASSWORD_CHANGE / PASSWORD_RESET / EMAIL_CHANGE / FREEZE / UNFREEZE',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_account_security_event (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号安全事件（只增不改）';

-- 以前没有记录改密码，查不到；冻结 / 解冻从审计日志补最近 7 天（AA-8）。审计的对象是客户号（等于 account_user.id）
INSERT INTO account_security_event (user_id, type, created_at)
SELECT CAST(target AS UNSIGNED), IF(action = 'customer.freeze', 'FREEZE', 'UNFREEZE'), created_at
FROM admin_audit_log
WHERE action IN ('customer.freeze', 'customer.unfreeze') AND result = 'SUCCESS' AND target REGEXP '^[0-9]+$'
  AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY;

-- 6. 规则配置初始值（Amos 2026-10-17 确认的规则表）：总开关默认关闭；12 条规则默认都开；版本号从 0 开始，每次保存 +1。
--    在后台"出金审核 → 自动审批规则"页改（权限 withdrawal:auto_rule_edit，高危、写审计），不在系统配置页显示
INSERT INTO common_config (config_key, value) VALUES
('withdraw.autoApprove.enabled', 'false'),
('withdraw.autoApprove.version', '0'),
('withdraw.autoApprove.R1.enabled', 'true'),
('withdraw.autoApprove.R2.enabled', 'true'),
('withdraw.autoApprove.R3.enabled', 'true'),
('withdraw.autoApprove.R4.enabled', 'true'),
('withdraw.autoApprove.R5.enabled', 'true'),
('withdraw.autoApprove.R6.enabled', 'true'),
('withdraw.autoApprove.R7.enabled', 'true'),
('withdraw.autoApprove.R8.enabled', 'true'),
('withdraw.autoApprove.R9.enabled', 'true'),
('withdraw.autoApprove.R10.enabled', 'true'),
('withdraw.autoApprove.R11.enabled', 'true'),
('withdraw.autoApprove.R12.enabled', 'true'),
('withdraw.autoApprove.R1.maxAmount', '500'),
('withdraw.autoApprove.R2.maxUser24h', '2000'),
('withdraw.autoApprove.R3.maxPlatform24h', '20000'),
('withdraw.autoApprove.R6.hours', '48'),
('withdraw.autoApprove.R7.days', '7'),
('withdraw.autoApprove.R8.multiple', '1'),
('withdraw.autoApprove.R10.maxProfit7d', '5000'),
('withdraw.autoApprove.R10.maxProfitPct', '50'),
('withdraw.autoApprove.R11.maxCount', '3');

-- 7. 总开关被打开 / 关闭时发给告警邮箱（FX_ALERT_EMAILS，运维和风控）的邮件，防止有人悄悄打开。按邮箱发、中英文各一份
INSERT INTO notify_template (code, audience, kind, name_zh, name_en, title_zh, title_en, body_zh, body_en, variables, channels) VALUES
('OPS_AUTO_APPROVE_SWITCH', 'STAFF', NULL, '提现自动审批总开关变更', 'Withdrawal auto-approval switch changed',
  '提现自动审批总开关已{stateZh}', 'Withdrawal auto-approval switched {stateEn}',
  '提现自动审批总开关已{stateZh}（规则配置第 {version} 版）。\n操作人：{admin}\n原因：{reason}\n时间（UTC）：{at}\n打开时，冷静期结束的提现满足全部已启用的规则就由系统自动通过；关闭时全部转人工审核。如果不是你们安排的变更，请立即在后台"出金审核 → 自动审批规则"关闭并查看审计日志。',
  'Withdrawal auto-approval was switched {stateEn} (rule config version {version}).\nBy: {admin}\nReason: {reason}\nAt (UTC): {at}\nWhen on, withdrawals that pass every enabled rule after the cooling period are approved by the system; when off, all go to manual review. If this change was not planned, switch it off in the admin console (Withdrawals → Auto-approval rules) and check the audit log.',
  'stateZh,stateEn,version,admin,reason,at', 'EMAIL');
