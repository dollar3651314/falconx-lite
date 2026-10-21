-- V32（2026-10-21，体验优化第二批：部分平仓，方案 技术方案/v2-体验优化-1021.md v1.2 第 3.6 节 UX-6；Amos 2026-10-21 "其他按建议"）
-- 说明见 技术方案/v1-数据库设计.md 2.13、第 10 节。
--
-- 1. 拆行：部分平仓时，原持仓那一行减少手数、保证金（继续是 OPEN）；平掉的部分新插一行 CLOSED 的持仓，parent_id 指向原持仓，
--    订单号（order_id）和原持仓相同。所以 order_id 不再唯一：
--    - 原来的唯一键 uk_trading_position_order 改成普通索引；
--    - "一张订单只开一个持仓"仍然由唯一键保证：生成列 origin_order_id 只在原持仓（parent_id 为空）上等于 order_id，拆出来的行是 NULL（唯一键允许多个 NULL）。
-- 2. split_swap_seq：拆分那一刻原持仓最大的隔夜费记录号（trading_swap.id，没有时为 0）。拆出来的行只在"拆分时原持仓还没结算过的结算日"补收隔夜费，
--    原持仓在拆分之前已经按拆分前的手数结算过的结算日，拆出来的行不再收（防止同一结算日的同一部分手数收两次）。只有拆出来的行有值。
ALTER TABLE trading_position
  ADD COLUMN parent_id BIGINT NULL COMMENT '部分平仓拆出来的已平仓行指向原持仓（内部 id）；原持仓为空' AFTER order_id,
  ADD COLUMN split_swap_seq BIGINT NULL COMMENT '拆分时原持仓最大的隔夜费记录号（trading_swap.id，没有为 0）；只有拆出来的行有' AFTER swap_total,
  ADD COLUMN origin_order_id BIGINT AS (CASE WHEN parent_id IS NULL THEN order_id END) STORED COMMENT '原持仓的订单号（拆出来的行为 NULL），保证一张订单只开一个持仓',
  DROP INDEX uk_trading_position_order,
  ADD KEY idx_trading_position_order (order_id),
  ADD UNIQUE KEY uk_trading_position_origin_order (origin_order_id),
  ADD KEY idx_trading_position_parent (parent_id);

-- 3. 部分平仓站内信（体验优化 1021 UX-9 的延续）：渠道只有 INBOX（不推送、不发邮件），写明平了多少手、还剩多少手。
--    全部平仓仍是 V31 的 POSITION_CLOSED。kind 和 POSITION_CLOSED 一样是 fill。
INSERT INTO notify_template (code, audience, kind, name_zh, name_en, title_zh, title_en, body_zh, body_en, variables, channels) VALUES
('POSITION_PARTIAL_CLOSED', 'USER', 'fill', '手动部分平仓', 'Position partially closed',
  '部分平仓成功', 'Position partially closed',
  '{symbol} 持仓（{side}）已按 {price} 平仓 {lots} 手，盈亏 {pnl} USDT，剩余 {remaining} 手继续持有，止盈止损不变。',
  '{lots} lots of your {symbol} position ({side}) were closed at {price}, P/L {pnl} USDT. The remaining {remaining} lots stay open with the same take profit / stop loss.',
  'symbol,side,lots,price,pnl,remaining', 'INBOX');
