-- V5（S7）：订单、持仓，以及风控的全局暂停开关。说明见 技术方案/v1-数据库设计.md 2.12–2.14、第 9 节。

-- 订单：市价单下单即成交（FILLED）；限价单先挂单（PENDING），S9 撮合成交或客户撤单（CANCELLED）
CREATE TABLE trading_order (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  user_id         BIGINT        NOT NULL,
  client_order_id VARCHAR(64)   NOT NULL COMMENT '客户端生成的幂等键，同一用户内唯一',
  symbol          VARCHAR(16)   NOT NULL,
  order_type      VARCHAR(8)    NOT NULL COMMENT 'MARKET / LIMIT',
  side            VARCHAR(4)    NOT NULL COMMENT 'BUY / SELL',
  lots            DECIMAL(24,8) NOT NULL,
  leverage        INT           NOT NULL,
  limit_price     DECIMAL(24,8) NULL,
  take_profit     DECIMAL(24,8) NULL,
  stop_loss       DECIMAL(24,8) NULL,
  frozen_amount   DECIMAL(24,8) NOT NULL DEFAULT 0 COMMENT '挂单冻结：按限价算的保证金 + 手续费',
  notional_usd    DECIMAL(24,8) NOT NULL COMMENT '下单时按 USD 算的名义价值（持仓上限用）',
  status          VARCHAR(12)   NOT NULL COMMENT 'PENDING / FILLED / CANCELLED',
  fill_price      DECIMAL(24,8) NULL,
  position_id     BIGINT        NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_trading_order_client (user_id, client_order_id),
  KEY idx_trading_order_user_status (user_id, status),
  KEY idx_trading_order_symbol_status (symbol, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='订单';

-- 持仓（逐仓）：开仓时的参数都存下来，以后改品种配置不影响已有持仓
CREATE TABLE trading_position (
  id                      BIGINT        NOT NULL AUTO_INCREMENT,
  user_id                 BIGINT        NOT NULL,
  order_id                BIGINT        NOT NULL,
  symbol                  VARCHAR(16)   NOT NULL,
  side                    VARCHAR(4)    NOT NULL,
  lots                    DECIMAL(24,8) NOT NULL,
  leverage                INT           NOT NULL,
  open_price              DECIMAL(24,8) NOT NULL,
  contract_size           DECIMAL(24,8) NOT NULL,
  quote_ccy               VARCHAR(8)    NOT NULL,
  open_usd_rate           DECIMAL(30,16) NOT NULL COMMENT '开仓时报价币种对 USD 的汇率',
  notional_usd            DECIMAL(24,8) NOT NULL,
  margin                  DECIMAL(24,8) NOT NULL COMMENT '占用保证金（追加保证金时增加，S8）',
  fee                     DECIMAL(24,8) NOT NULL COMMENT '开仓手续费',
  maintenance_margin_rate DECIMAL(12,8) NOT NULL COMMENT '开仓时的维持保证金率（修复 T-11）',
  liquidation_price       DECIMAL(24,8) NOT NULL,
  take_profit             DECIMAL(24,8) NULL,
  stop_loss               DECIMAL(24,8) NULL,
  status                  VARCHAR(8)    NOT NULL COMMENT 'OPEN / CLOSED',
  opened_at               DATETIME(3)   NOT NULL,
  closed_at               DATETIME(3)   NULL,
  close_price             DECIMAL(24,8) NULL,
  close_reason            VARCHAR(16)   NULL COMMENT 'S8、S9：CLOSED / TP / SL / LIQUIDATED',
  realized_pnl            DECIMAL(24,8) NULL,
  updated_at              DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_trading_position_order (order_id),
  KEY idx_trading_position_user_status (user_id, status),
  KEY idx_trading_position_symbol_status (symbol, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='持仓';

-- 风控开关（只有一行）。S7 用全局暂停；S11 加净敞口自动禁开，S16 后台操作
CREATE TABLE risk_switch (
  id                 TINYINT     NOT NULL,
  global_open_paused TINYINT     NOT NULL DEFAULT 0 COMMENT '全局暂停开仓：只能平仓',
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='风控开关';

INSERT INTO risk_switch (id, global_open_paused) VALUES (1, 0);
