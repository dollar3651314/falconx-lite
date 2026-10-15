-- V7（S10）：隔夜费结算记录，持仓累计隔夜费。说明见 技术方案/v1-数据库设计.md 2.15、第 12 节。

-- 每个持仓每个结算日一行（唯一键保证只结算一次）。费率为 0 也记一行，金额为 0
CREATE TABLE trading_swap (
  id            BIGINT         NOT NULL AUTO_INCREMENT,
  position_id   BIGINT         NOT NULL,
  user_id       BIGINT         NOT NULL,
  symbol        VARCHAR(16)    NOT NULL,
  rollover_date DATE           NOT NULL COMMENT '结算日（UTC 日期）',
  rollover_at   DATETIME(3)    NOT NULL COMMENT '结算时点（UTC）',
  rate          DECIMAL(12,8)  NOT NULL COMMENT '当时的费率：负数扣、正数返还',
  price         DECIMAL(24,8)  NOT NULL COMMENT '计算用的价格（平仓方向的最新价）',
  usd_rate      DECIMAL(30,16) NOT NULL COMMENT '报价币种对 USD 的汇率',
  amount        DECIMAL(24,8)  NOT NULL COMMENT '入账金额（USD）：负数扣、正数返还',
  created_at    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_trading_swap_position_date (position_id, rollover_date),
  KEY idx_trading_swap_user (user_id, rollover_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='隔夜费结算记录';

ALTER TABLE trading_position
  ADD COLUMN swap_total DECIMAL(24,8) NOT NULL DEFAULT 0 COMMENT '累计隔夜费：负数是扣的' AFTER fee;
