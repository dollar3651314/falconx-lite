-- V28（v2 资金归集第一阶段：合约 + 以太坊 / BSC 的地址和归集；Amos 2026-10-20"上限保留，现在就可以开始开发"）。
-- 说明见 技术方案/v2-半自动归集.md v1.2 第 4.4、4.6、4.9、4.13 节，技术方案/v1-数据库设计.md 2.51–2.58。
-- TRON（离线签名 + 租能量）是下一阶段：批次、明细的状态和 mode 已经为它留了值，TRON 专用的列（租能量、补 TRX、待签名交易）下一阶段的迁移再加。

-- 1. 合约地址参数：每一套（工厂、实现合约、parent、批量合约）一行，第几套 = ver。换任何一个参数 = 新的一套，新客户用新地址；老的永远不删（方案第 4.13.3 节）
CREATE TABLE wallet_address_scheme (
  ver            INT          NOT NULL AUTO_INCREMENT,
  family         VARCHAR(8)   NOT NULL COMMENT 'ETH（以太坊体系；TRON 没有合约地址）',
  scheme         VARCHAR(10)  NOT NULL COMMENT 'FORWARDER',
  factory        VARCHAR(42)  NOT NULL COMMENT 'BitGo ForwarderFactoryV4',
  implementation VARCHAR(42)  NOT NULL COMMENT 'BitGo ForwarderV4 实现合约',
  parent         VARCHAR(42)  NOT NULL COMMENT '冷钱包（Safe 多签），写在每个转发地址里',
  fee_address    VARCHAR(42)  NOT NULL COMMENT '批量合约 SweepBatcher（转发地址的 feeAddress）',
  params_key     VARCHAR(200) NOT NULL COMMENT '四个地址小写拼接，同一套只登记一次',
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ver),
  UNIQUE KEY uk_wallet_address_scheme (params_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='合约充值地址的参数（每套一行，只增不删）';

-- 2. 充值地址：区分方案（XPUB 派生 / FORWARDER 合约地址）、第几套参数、正在用还是已停用。
--    每个用户每个体系同时只有一个正在用的地址（active_key = 用户:体系，停用时置空；MySQL 没有部分唯一索引，用它代替）；
--    停用的老地址继续扫块 30 天（SW-9），后台和客户端只显示正在用的
ALTER TABLE wallet_address
  ADD COLUMN scheme      VARCHAR(10) NOT NULL DEFAULT 'XPUB' COMMENT 'XPUB（xpub 派生）/ FORWARDER（BitGo 合约转发地址，v2 归集）' AFTER family,
  ADD COLUMN scheme_ver  INT         NOT NULL DEFAULT 0 COMMENT 'FORWARDER：wallet_address_scheme.ver；XPUB 为 0' AFTER scheme,
  ADD COLUMN salt        VARCHAR(66) NULL COMMENT 'FORWARDER：CREATE2 的盐 keccak256("falconx-deposit" ‖ 用户ID)' AFTER address_key,
  ADD COLUMN status      VARCHAR(8)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE 正在用 / RETIRED 已停用（继续扫块 30 天）' AFTER salt,
  ADD COLUMN active_key  VARCHAR(40) NULL COMMENT '正在用时 = 用户ID:体系，停用时为空' AFTER status,
  ADD COLUMN retired_at  DATETIME(3) NULL COMMENT '停用时间' AFTER active_key,
  ADD COLUMN deployed_at DATETIME(3) NULL COMMENT 'FORWARDER：转发合约第一次部署的时间（归集时顺便部署）' AFTER retired_at,
  DROP INDEX uk_wallet_address_user,
  DROP INDEX uk_wallet_address_index,
  ADD UNIQUE KEY uk_wallet_address_user (user_id, family, scheme, scheme_ver),
  ADD UNIQUE KEY uk_wallet_address_index (family, scheme, scheme_ver, address_index),
  ADD UNIQUE KEY uk_wallet_address_active (active_key);
UPDATE wallet_address SET active_key = CONCAT(user_id, ':', family);

-- 归集预览按"收到过充值的地址"找候选
ALTER TABLE wallet_deposit ADD KEY idx_wallet_deposit_to (chain, to_address);

-- 3. 归集批次（三条链共用；这一阶段只有 ERC20、BSC 的 CONTRACT 方式）
CREATE TABLE wallet_sweep_batch (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  public_no       BIGINT        NOT NULL COMMENT '对外编号（雪花 ID，约定 25）',
  chain           VARCHAR(8)    NOT NULL COMMENT 'ERC20 / BSC / TRC20',
  mode            VARCHAR(8)    NOT NULL COMMENT 'CONTRACT（以太坊、BSC：服务器发起账户调用批量合约）/ OFFLINE（TRON：离线签名，下一阶段）',
  status          VARCHAR(20)   NOT NULL COMMENT 'CONTRACT：PENDING → SENT → CONFIRMED / PARTIAL / FAILED（DEFERRED 留给自动模式）；OFFLINE（下一阶段）：TOPPING_UP / AWAITING_SIGNATURE / SIGNED / BROADCASTING / CONFIRMED / PARTIAL / FAILED / CANCELLED / EXPIRED',
  trigger_type    VARCHAR(8)    NOT NULL DEFAULT 'MANUAL' COMMENT 'MANUAL 后台手动（SW-5 第一阶段只有这个）/ AUTO 定时',
  active_chain    VARCHAR(8)    NULL COMMENT '进行中（PENDING / SENT）时 = 链：同一条链同时只有一个进行中的批次',
  scheme_ver      INT           NULL COMMENT 'CONTRACT：这一批地址的合约参数是第几套（同一批只有一套）',
  token           VARCHAR(64)   NOT NULL COMMENT '归集的代币合约（USDT）',
  destination     VARCHAR(64)   NOT NULL COMMENT '冷钱包（快照）',
  executor        VARCHAR(64)   NULL COMMENT 'CONTRACT：批量合约地址；OFFLINE：空',
  created_by      BIGINT        NULL COMMENT '管理员；自动归集为空',
  reason          VARCHAR(500)  NULL,
  retry_of        BIGINT        NULL COMMENT '重试时：原批次 id',
  address_count   INT           NOT NULL,
  expected_usdt   DECIMAL(36,18) NOT NULL COMMENT '生成时查到的余额合计',
  swept_usdt      DECIMAL(36,18) NOT NULL DEFAULT 0 COMMENT '链上实际转给冷钱包的合计（按 Transfer 事件）',
  fee_paid        DECIMAL(36,18) NOT NULL DEFAULT 0 COMMENT '实际手续费（手续费币）',
  fee_asset       VARCHAR(8)    NOT NULL COMMENT 'ETH / BNB / TRX',
  params_json     JSON          NOT NULL COMMENT '生成时的门槛、占比上限、金额上限、gas 价格快照',
  tx_hash         VARCHAR(80)   NULL COMMENT 'CONTRACT：最终上链的批量交易',
  block_number    BIGINT        NULL COMMENT 'CONTRACT：上链的区块',
  fail_reason     VARCHAR(500)  NULL,
  created_at      DATETIME(3)   NOT NULL,
  sent_at         DATETIME(3)   NULL,
  finished_at     DATETIME(3)   NULL,
  expires_at      DATETIME(3)   NULL COMMENT 'OFFLINE：待签名清单的有效期（下一阶段）',
  unsigned_sha256 CHAR(64)      NULL COMMENT 'OFFLINE：待签名文件的哈希（下一阶段）',
  signed_sha256   CHAR(64)      NULL COMMENT 'OFFLINE：签名文件的哈希（下一阶段）',
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_sweep_batch_no (public_no),
  UNIQUE KEY uk_wallet_sweep_batch_active (active_chain),
  KEY idx_wallet_sweep_batch_chain (chain, status),
  KEY idx_wallet_sweep_batch_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='资金归集批次';

-- 4. 批次明细：每个地址一行
CREATE TABLE wallet_sweep_item (
  id             BIGINT         NOT NULL AUTO_INCREMENT,
  batch_id       BIGINT         NOT NULL,
  item_no        INT            NOT NULL,
  address_id     BIGINT         NOT NULL COMMENT 'wallet_address.id',
  user_id        BIGINT         NOT NULL,
  address        VARCHAR(64)    NOT NULL,
  address_index  INT            NULL COMMENT 'OFFLINE：派生序号（下一阶段）',
  salt           VARCHAR(66)    NULL COMMENT 'CONTRACT：转发地址的盐',
  deploy         TINYINT(1)     NOT NULL DEFAULT 0 COMMENT 'CONTRACT：这次是否顺便部署转发合约',
  balance_before DECIMAL(36,18) NOT NULL COMMENT '生成时查到的余额',
  est_fee        DECIMAL(36,18) NOT NULL DEFAULT 0 COMMENT '预估手续费（手续费币）',
  swept          DECIMAL(36,18) NULL COMMENT '链上实际转给冷钱包的金额',
  status         VARCHAR(16)    NOT NULL COMMENT 'PENDING / SWEPT / FAILED；OFFLINE 另有 TOPUP_SENT / READY / SIGNED / SIGN_REJECTED / BROADCAST / EXPIRED / CANCELLED（下一阶段）',
  fail_reason    VARCHAR(500)   NULL,
  tx_hash        VARCHAR(80)    NULL COMMENT 'CONTRACT：同批次的批量交易；OFFLINE：这一笔自己的交易',
  active_key     VARCHAR(80)    NULL COMMENT '进行中时 = 链:地址，保证同一个地址同时只在一个批次里',
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_sweep_item_no (batch_id, item_no),
  UNIQUE KEY uk_wallet_sweep_item_active (active_key),
  KEY idx_wallet_sweep_item_address (address_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='资金归集明细';

-- 5. CONTRACT 批次的每次发送（含加价重发）：先落库再广播，连不上节点也能按哈希查
CREATE TABLE wallet_sweep_tx (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  batch_id     BIGINT        NOT NULL,
  chain        VARCHAR(8)    NOT NULL,
  attempt      INT           NOT NULL,
  nonce        BIGINT        NOT NULL,
  tx_hash      VARCHAR(80)   NOT NULL,
  raw_tx       MEDIUMTEXT    NOT NULL,
  gas_limit    BIGINT        NOT NULL,
  max_fee      DECIMAL(36,0) NOT NULL COMMENT 'wei：以太坊 maxFeePerGas，BSC gasPrice',
  priority_fee DECIMAL(36,0) NULL COMMENT 'wei：以太坊 maxPriorityFeePerGas',
  status       VARCHAR(8)    NOT NULL COMMENT 'SENT 已发出（或可能已发出）/ FAILED 节点明确拒绝',
  created_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_sweep_tx_hash (chain, tx_hash),
  KEY idx_wallet_sweep_tx_batch (batch_id, attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='归集交易的发送记录';

-- 6. 发起账户的 nonce（和热钱包分开，方案 SW-8）
CREATE TABLE wallet_sweep_nonce (
  chain      VARCHAR(8)  NOT NULL,
  operator   VARCHAR(64) NOT NULL,
  next_nonce BIGINT      NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chain, operator)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='归集发起账户的 nonce';

-- 7. 批次的每次状态变化（只增不改，后台批次详情的时间线）
CREATE TABLE wallet_sweep_event (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  batch_id   BIGINT       NOT NULL,
  actor      VARCHAR(64)  NOT NULL COMMENT '管理员 ID 或 system',
  text       VARCHAR(500) NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_wallet_sweep_event (batch_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='归集批次事件（只增不改）';

-- 8. 扫块看到的"从我们的充值地址转出"的 USDT：SWEEP（是归集交易、去了冷钱包）/ UNKNOWN（不是我们发的归集交易，但去了冷钱包，例如 Safe 手动归集）/
--    DEST_MISMATCH（去了不是冷钱包的地方）。对账据此区分，后两种都告警（方案第 4.4、4.8 节）。xpub 地址的转出（Amos 现在离线手动归集）只记日志
CREATE TABLE wallet_sweep_outflow (
  id           BIGINT         NOT NULL AUTO_INCREMENT,
  chain        VARCHAR(8)     NOT NULL,
  tx_hash      VARCHAR(80)    NOT NULL,
  log_index    INT            NOT NULL,
  block_number BIGINT         NOT NULL,
  from_address VARCHAR(64)    NOT NULL,
  to_address   VARCHAR(64)    NOT NULL,
  amount       DECIMAL(36,18) NOT NULL,
  address_id   BIGINT         NOT NULL,
  user_id      BIGINT         NOT NULL,
  kind         VARCHAR(16)    NOT NULL COMMENT 'SWEEP / UNKNOWN / DEST_MISMATCH',
  batch_id     BIGINT         NULL COMMENT 'SWEEP：对应的批次',
  created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_sweep_outflow (chain, tx_hash, log_index),
  KEY idx_wallet_sweep_outflow_kind (kind, id),
  KEY idx_wallet_sweep_outflow_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='从充值地址转出的 USDT（归集和异常转出）';

-- 9. 归集设置（Amos 10-20 SW-6：门槛和手续费占比上限后台可改，默认值按方案建议；第 4.14 节上线初期金额上限，Amos 10-20 保留）。
--    只在"资金归集 → 归集设置"页改（权限 sweep:config，高危、原因必填、审计 sweep.settings_update、带版本号），不在系统配置页
INSERT INTO common_config (config_key, value) VALUES
('sweep.version', '0'),
('sweep.threshold.ERC20', '100'),
('sweep.threshold.BSC', '10'),
('sweep.threshold.TRC20', '100'),
('sweep.maxFeeRatioPct', '3'),
('sweep.evmCap.perAddress', '5000'),
('sweep.evmCap.perBatch', '20000'),
('sweep.operatorMin.ERC20', '0'),
('sweep.operatorMin.BSC', '0');

-- 10. 告警邮件（发给风控人员 FX_RISK_ALERT_EMAILS，中英文各一份）
INSERT INTO notify_template (code, audience, kind, name_zh, name_en, title_zh, title_en, body_zh, body_en, variables, channels) VALUES
('SWEEP_UNKNOWN_OUTFLOW', 'STAFF', NULL, '充值地址异常转出', 'Unexpected outflow from a deposit address',
  '{chain} 充值地址出现不是归集的转出', '{chain}: unexpected outflow from a deposit address',
  '{chain} 充值地址 {from}（客户 {userId}）转出 {amount} USDT 到 {to}，交易 {txHash} 不是系统发起的归集。{hint}\n请立即核对：Safe 有没有人手动归集；没有的话按 技术方案/v2-半自动归集.md 第 4.13.4 节处理，并在后台对账页处理这条记录。',
  '{amount} USDT moved from deposit address {from} (customer {userId}) to {to} on {chain} in transaction {txHash}, which is not a sweep sent by the system. {hint}\nCheck immediately whether anyone flushed it manually from the Safe; if not, follow section 4.13.4 of the sweep design and resolve the item on the reconciliation page.',
  'chain,from,to,amount,txHash,userId,hint', 'EMAIL'),
('SWEEP_FAILED', 'STAFF', NULL, '资金归集失败', 'Sweep failed',
  '{chain} 归集批次 {batchNo} {statusZh}', '{chain} sweep batch {batchNo} {statusEn}',
  '{chain} 归集批次 {batchNo}：{detail}\n钱没有离开充值地址的部分下次会重新列入；请在后台"资金归集"查看。',
  '{chain} sweep batch {batchNo}: {detail}\nAddresses that were not swept will be picked up again next time. See "Fund sweep" in the admin console.',
  'chain,batchNo,statusZh,statusEn,detail', 'EMAIL'),
('SWEEP_STUCK', 'STAFF', NULL, '归集交易长时间未确认', 'Sweep transaction stuck',
  '{chain} 归集批次 {batchNo} 长时间未确认', '{chain} sweep batch {batchNo} is stuck',
  '{chain} 归集批次 {batchNo}（发起账户 nonce {nonce}）加价重发 {attempts} 次后仍未上链，需要人工处理（查发起账户余额和节点）。',
  'Sweep batch {batchNo} on {chain} (operator nonce {nonce}) is still not mined after {attempts} fee bumps. Manual handling required (check the operator balance and the node).',
  'chain,batchNo,nonce,attempts', 'EMAIL');
