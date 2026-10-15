-- V9（S12a）：充值地址、扫块进度、充值记录。说明见 技术方案/v1-充值方案.md、技术方案/v1-数据库设计.md 2.18–2.20、第 14 节。

-- 用户的充值地址：以太坊体系一个（ERC20、BSC 共用），TRON 一个。序号 = 用户 ID（BIP44 非硬化序号）
CREATE TABLE wallet_address (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL,
  family        VARCHAR(8)   NOT NULL COMMENT 'ETH / TRON',
  address_index INT          NOT NULL COMMENT '派生序号 m/44''/币种''/0''/0/序号',
  address       VARCHAR(64)  NOT NULL COMMENT '展示用：以太坊带大小写校验，TRON 是 T 开头',
  address_key   VARCHAR(64)  NOT NULL COMMENT '匹配链上收款地址用：以太坊小写',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_address_user (user_id, family),
  UNIQUE KEY uk_wallet_address_key (family, address_key),
  UNIQUE KEY uk_wallet_address_index (family, address_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='充值地址';

-- 每条链扫到的区块号（重启后接着扫）
CREATE TABLE wallet_chain_cursor (
  chain        VARCHAR(8)  NOT NULL COMMENT 'ERC20 / BSC / TRC20',
  last_block   BIGINT      NOT NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='扫块进度';

-- 充值记录。唯一键（链、交易哈希、日志序号）保证同一笔转账只记一次
CREATE TABLE wallet_deposit (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  chain          VARCHAR(8)    NOT NULL,
  tx_hash        VARCHAR(80)   NOT NULL,
  log_index      INT           NOT NULL COMMENT '同一笔交易里第几个转账事件',
  block_number   BIGINT        NOT NULL,
  block_hash     VARCHAR(80)   NOT NULL COMMENT '发现时的区块哈希，入账前再核对一次（防回滚）',
  from_address   VARCHAR(64)   NOT NULL,
  to_address     VARCHAR(64)   NOT NULL,
  user_id        BIGINT        NOT NULL,
  amount         DECIMAL(24,8) NOT NULL COMMENT 'USDT，按精度换算、保留 8 位（多余位数舍去）',
  status         VARCHAR(12)   NOT NULL COMMENT 'PENDING 待确认 / CREDITED 已入账 / DROPPED 已作废 / BELOW_MIN 低于最小充值金额',
  confirmations  INT           NOT NULL DEFAULT 0,
  credited_at    DATETIME(3)   NULL,
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_deposit_tx (chain, tx_hash, log_index),
  KEY idx_wallet_deposit_status (chain, status),
  KEY idx_wallet_deposit_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='充值记录';
