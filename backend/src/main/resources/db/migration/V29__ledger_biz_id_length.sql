-- V29（2026-10-20，开发资金归集时发现的缺陷修复）：账本的来源单号 biz_id 原来是 VARCHAR(64)，放不下真实链上充值的幂等键。
-- 充值入账的 biz_id 是"链:交易哈希:日志序号"：以太坊、BSC 的交易哈希是 0x + 64 位（ERC20:0x…:0 共 74 个字符），TRON 是 64 位（72 个字符），
-- 都超过 64，MySQL 严格模式下入账会报"Data too long"、充值一直停在"待确认"。端到端测试的链替身用的是短哈希，所以没测出来；
-- anvil 本地链端到端测试（contracts/script/anvil-e2e.sh）用真实哈希时发现。加宽到 128，唯一键不变（utf8mb4 下 4 列合计仍在 3072 字节以内）。
ALTER TABLE trading_ledger MODIFY COLUMN biz_id VARCHAR(128) NOT NULL COMMENT '来源业务的单号（充值是 链:交易哈希:日志序号）';
