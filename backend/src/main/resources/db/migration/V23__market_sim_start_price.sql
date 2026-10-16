-- V23（v2 后台补充）：品种的"模拟起始价"。说明见 技术方案/v1-后台方案.md 第 11 节、技术方案/v1-数据库设计.md（market_symbol）。
-- 只在报价源是模拟源（FX_MARKET_SOURCE=simulated，开发和测试环境）时使用：simulated-prices.csv 里没有的品种从这个价开始随机游走；
-- 接 LP 后不使用。可空：第一版 50 个品种的起始价在 csv 里，这一列为空。
-- 编号从 V23 开始：V21、V22 已被其他分支占用。
ALTER TABLE market_symbol
  ADD COLUMN sim_start_price DECIMAL(24,8) NULL COMMENT '模拟起始价（只在模拟报价源下使用，csv 里没有的品种用它）' AFTER markup;
