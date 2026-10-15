-- V11（S13a）：白名单、提现单、提现事件。说明见 技术方案/v1-提现方案.md、技术方案/v1-数据库设计.md 2.22–2.24、第 15 节。

-- 白名单地址：每人最多 10 个，新地址 24 小时后生效
CREATE TABLE wallet_whitelist (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     BIGINT       NOT NULL,
  network     VARCHAR(8)   NOT NULL COMMENT 'ERC20 / BSC / TRC20',
  address     VARCHAR(64)  NOT NULL,
  address_key VARCHAR(64)  NOT NULL COMMENT '去重用：以太坊小写',
  label       VARCHAR(32)  NOT NULL,
  active_at   DATETIME(3)  NOT NULL COMMENT '生效时间 = 添加时间 + 24 小时',
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_whitelist (user_id, network, address_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现白名单';

-- 提现单。状态和客户端一致：COOLING 冷静期 / REVIEWING 待审核 / APPROVED 已审核待上链 / DELAYED 大额延迟 / BROADCASTING 上链中 /
-- COMPLETED 已完成 / FAILED_REFUNDED 失败已退回 / REJECTED 已驳回 / CANCELLED 已撤销
CREATE TABLE wallet_withdrawal (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  user_id          BIGINT        NOT NULL,
  network          VARCHAR(8)    NOT NULL,
  address          VARCHAR(64)   NOT NULL,
  amount           DECIMAL(24,8) NOT NULL COMMENT '提现金额（冻结这么多）',
  fee              DECIMAL(24,8) NOT NULL COMMENT '手续费，从金额里扣；链上转出 amount − fee',
  status           VARCHAR(16)   NOT NULL,
  cooling_ends_at  DATETIME(3)   NOT NULL,
  delay_ends_at    DATETIME(3)   NULL,
  tx_hash          VARCHAR(80)   NULL,
  reject_reason    VARCHAR(500)  NULL,
  reviewer_id      BIGINT        NULL,
  reviewed_at      DATETIME(3)   NULL,
  completed_at     DATETIME(3)   NULL,
  created_at       DATETIME(3)   NOT NULL,
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wallet_withdrawal_user (user_id, created_at),
  KEY idx_wallet_withdrawal_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现单';

-- 提现事件：每次状态变化，谁做的（客户、管理员、系统）
CREATE TABLE wallet_withdraw_event (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  withdrawal_id BIGINT       NOT NULL,
  from_status   VARCHAR(16)  NULL,
  to_status     VARCHAR(16)  NOT NULL,
  actor         VARCHAR(32)  NOT NULL COMMENT 'user:<id> / admin:<id> / system',
  note          VARCHAR(500) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wallet_withdraw_event (withdrawal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现事件';
