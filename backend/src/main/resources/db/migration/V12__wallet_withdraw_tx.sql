-- V12（S13b）：以太坊体系 nonce、每次广播的记录。说明见 技术方案/v1-提现方案.md、技术方案/v1-数据库设计.md 2.25–2.26、第 15 节。

-- 以太坊体系每条链下一个要用的 nonce（修复 F6：按链管理，第一次用时从链上同步，节点拒绝时重新同步）
CREATE TABLE wallet_chain_nonce (
  chain      VARCHAR(8)  NOT NULL COMMENT 'ERC20 / BSC',
  next_nonce BIGINT      NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='热钱包 nonce';

-- 每次广播一行。以太坊体系加价重发是同一个 nonce 的新一行；TRON 过期重建也是新一行。签好名的交易不含私钥，可以原样重发。
-- 交易哈希不设唯一：节点拒绝后重新同步到同一个 nonce 重试时，签出来的交易可能和被拒的那笔一模一样
CREATE TABLE wallet_withdraw_tx (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  withdrawal_id BIGINT       NOT NULL,
  chain         VARCHAR(8)   NOT NULL,
  attempt       INT          NOT NULL COMMENT '第几次（1 开始）',
  nonce         BIGINT       NULL COMMENT '以太坊体系的 nonce；TRON 为空',
  tx_hash       VARCHAR(80)  NOT NULL,
  raw_tx        MEDIUMTEXT   NOT NULL COMMENT '签好名的交易（以太坊体系是十六进制，TRON 是 JSON）',
  fee_price     BIGINT       NOT NULL COMMENT '以太坊体系的 gas 价格（wei）；TRON 的手续费上限（sun）',
  expires_at    DATETIME(3)  NULL COMMENT 'TRON 交易过期时间',
  status        VARCHAR(12)  NOT NULL COMMENT 'SENT 已发出 / FAILED 节点拒绝 / EXPIRED 已过期（TRON）',
  created_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_wallet_withdraw_tx_hash (chain, tx_hash),
  KEY idx_wallet_withdraw_tx (withdrawal_id, attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='提现广播记录';
