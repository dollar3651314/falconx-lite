-- V8（S11）：风控规则。说明见 技术方案/v1-数据库设计.md 2.14、2.16、2.17、第 13 节。

-- 平台级开关和阈值（只有一行，V5 建的）
ALTER TABLE risk_switch
  ADD COLUMN auto_global_paused     TINYINT       NOT NULL DEFAULT 0 COMMENT '平台总净敞口超阈值自动禁开（风控人员手动恢复）' AFTER global_open_paused,
  ADD COLUMN auto_liquidation       TINYINT       NOT NULL DEFAULT 1 COMMENT '自动强平开关' AFTER auto_global_paused,
  ADD COLUMN platform_net_threshold DECIMAL(24,8) NULL COMMENT '平台总净敞口阈值（USD，各品种净敞口绝对值之和）；空表示不监控' AFTER auto_liquidation;

-- 品种级开关和阈值。没有行的品种：不暂停、不监控
CREATE TABLE risk_symbol (
  symbol         VARCHAR(16)   NOT NULL,
  net_threshold  DECIMAL(24,8) NULL COMMENT '品种净敞口阈值（USD，绝对值）；空表示不监控',
  manual_paused  TINYINT       NOT NULL DEFAULT 0 COMMENT '风控人员手动暂停开仓',
  auto_paused    TINYINT       NOT NULL DEFAULT 0 COMMENT '净敞口超阈值自动禁开（风控人员手动恢复）',
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='品种风控';

-- 风控事件：自动禁开、手动暂停和恢复、开关和阈值修改。后台审计日志在 S16
CREATE TABLE risk_event (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(32)   NOT NULL COMMENT 'AUTO_PAUSE_SYMBOL / AUTO_PAUSE_GLOBAL / PAUSE_SYMBOL / RESUME_SYMBOL / PAUSE_GLOBAL / RESUME_GLOBAL / AUTO_LIQUIDATION_ON / AUTO_LIQUIDATION_OFF / THRESHOLD',
  symbol      VARCHAR(16)   NULL COMMENT '空表示平台级',
  net_usd     DECIMAL(24,8) NULL COMMENT '当时的净敞口',
  threshold   DECIMAL(24,8) NULL,
  operator_id BIGINT        NULL COMMENT '操作的管理员；空表示系统自动',
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_risk_event_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='风控事件';
