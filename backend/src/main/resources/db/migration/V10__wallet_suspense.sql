-- V10（S12b）：充值冲正时余额不够扣的挂账（修复 F4，AC-09）。说明见 技术方案/v1-充值方案.md、技术方案/v1-数据库设计.md 2.21。
CREATE TABLE wallet_suspense (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  user_id     BIGINT        NOT NULL,
  deposit_id  BIGINT        NOT NULL COMMENT '被回滚的充值',
  amount      DECIMAL(24,8) NOT NULL COMMENT '没扣到的差额（USDT）',
  status      VARCHAR(12)   NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN 待处理 / RESOLVED 已处理（S14 对账页面）',
  note        VARCHAR(255)  NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_suspense_deposit (deposit_id),
  KEY idx_wallet_suspense_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='充值冲正挂账';
