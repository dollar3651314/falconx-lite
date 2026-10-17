-- V24（接真实报价后的加点）：Amos 2026-10-17 决定"买卖一共加 20 点"。说明见 技术方案/v2-报价源接入.md 第 5.4 节、技术方案/v1-数据库设计.md（market_symbol）。
-- markup 的含义不变（V4）：卖价（bid）减 markup、买价（ask）加 markup，各加一次，客户看到的点差比原始点差宽 2 × markup。
-- 所以"买卖合计 20 点" = 每边 10 点：markup = 10 × 10^(-digits)（1 点 = 品种的最小价格单位 10^(-digits)）。
-- 例如 EURUSD 5 位小数 → 每边 0.00010（点差加宽 0.00020）；USDJPY 3 位 → 0.010；XAUUSD 2 位 → 0.10；BTCUSD 1 位 → 1.0；JPN225 0 位 → 10。
-- 只改第一版的 50 个品种里 markup 仍然等于 0 的（运营在后台改过加点的品种保留原样，规则 C55）；
-- 运营在后台新增的品种（E3）不在这 50 个里，不改（新增品种不填加点时默认也是每边 10 点，见 MarketAdmin 和 web/admin 新增品种表单）。
-- 用 CASE 写死每个小数位的值，不用 POWER（浮点），保证是精确的十进制。

UPDATE market_symbol
SET markup = CASE digits
    WHEN 0 THEN 10
    WHEN 1 THEN 1.0
    WHEN 2 THEN 0.10
    WHEN 3 THEN 0.010
    WHEN 4 THEN 0.0010
    WHEN 5 THEN 0.00010
    WHEN 6 THEN 0.000010
    WHEN 7 THEN 0.0000010
    WHEN 8 THEN 0.00000010
  END
WHERE markup = 0
  AND digits BETWEEN 0 AND 8
  AND code IN (
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
    'EURCHF', 'EURAUD', 'EURCAD', 'AUDJPY', 'CADJPY', 'CHFJPY', 'AUDCAD', 'AUDNZD', 'GBPAUD', 'GBPCHF',
    'USDCNH', 'XAUUSD', 'XAGUSD', 'US30', 'US500', 'NAS100', 'US2000', 'GER40', 'UK100', 'FRA40',
    'JPN225', 'HK50', 'AUS200', 'XTIUSD', 'XBRUSD', 'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD',
    'DOGEUSD', 'ADAUSD', 'LTCUSD', 'DOTUSD', 'BCHUSD', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN');
