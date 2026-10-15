-- V4（S6）：行情模块的表和第一版 50 个品种（00-架构方案.md 3.6；合约大小按 A-01，杠杆上限按 A-03 沿用现有第一档）。
-- 说明见 技术方案/v1-数据库设计.md 2.9–2.11、第 8 节。品种参数以后在后台修改（S16）。

CREATE TABLE market_symbol (
  code          VARCHAR(16)   NOT NULL,
  name_zh       VARCHAR(64)   NOT NULL,
  name_en       VARCHAR(64)   NOT NULL,
  category      VARCHAR(8)    NOT NULL COMMENT 'fx / metal / index / energy / crypto / stock',
  digits        INT           NOT NULL COMMENT '报价小数位',
  contract_size DECIMAL(24,8) NOT NULL COMMENT '每手合约大小',
  unit          VARCHAR(16)   NOT NULL COMMENT '合约单位：baseCcy / ounce / barrel / share / unit',
  base_ccy      VARCHAR(8)    NOT NULL,
  quote_ccy     VARCHAR(8)    NOT NULL COMMENT '报价币种，保证金和盈亏按实时汇率折算成 USDT',
  max_leverage  INT           NOT NULL,
  min_lots      DECIMAL(24,8) NOT NULL,
  max_lots      DECIMAL(24,8) NOT NULL,
  lot_step      DECIMAL(24,8) NOT NULL,
  fee_rate      DECIMAL(12,8) NOT NULL COMMENT '开仓手续费率（名义价值的比例）',
  maintenance_margin_rate DECIMAL(12,8) NOT NULL,
  markup        DECIMAL(24,8) NOT NULL DEFAULT 0 COMMENT '统一加点（价格单位）：卖价减、买价加，只加一次',
  swap_long     DECIMAL(12,8) NOT NULL DEFAULT 0 COMMENT '隔夜费率（多头），S10 使用；值待 Amos 提供',
  swap_short    DECIMAL(12,8) NOT NULL DEFAULT 0 COMMENT '隔夜费率（空头）',
  hot           TINYINT       NOT NULL DEFAULT 0 COMMENT '热门：新客户"自选"的默认品种',
  open_paused   TINYINT       NOT NULL DEFAULT 0 COMMENT '暂停开仓：只能平仓',
  sort_order    INT           NOT NULL DEFAULT 0,
  enabled       TINYINT       NOT NULL DEFAULT 1,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='交易品种';

-- 每周交易时段（UTC），按分钟：open_minute 含、close_minute 不含，0–1440。一天可以有多段
CREATE TABLE market_session (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  symbol       VARCHAR(16) NOT NULL,
  day_of_week  TINYINT     NOT NULL COMMENT '1=周一 … 7=周日',
  open_minute  INT         NOT NULL,
  close_minute INT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_market_session_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='每周交易时段';

-- 全天休市的日期（节假日），symbol = '*' 表示所有品种
CREATE TABLE market_holiday (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  symbol     VARCHAR(16)  NOT NULL,
  trade_date DATE         NOT NULL COMMENT 'UTC 日期',
  reason     VARCHAR(128) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_market_holiday (symbol, trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='休市日';

-- 收盘后的 K 线（未收盘的在内存里）。价格用基准中间价，不含加点
CREATE TABLE market_kline (
  symbol    VARCHAR(16)   NOT NULL,
  timeframe VARCHAR(4)    NOT NULL COMMENT '1m / 5m / 15m / 1h / 4h / 1d',
  open_time BIGINT        NOT NULL COMMENT 'UTC 秒',
  open      DECIMAL(24,8) NOT NULL,
  high      DECIMAL(24,8) NOT NULL,
  low       DECIMAL(24,8) NOT NULL,
  close     DECIMAL(24,8) NOT NULL,
  ticks     INT           NOT NULL COMMENT '这根 K 线收到的报价条数（不是成交量）',
  PRIMARY KEY (symbol, timeframe, open_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='K 线';

INSERT INTO market_symbol (code, name_zh, name_en, category, digits, contract_size, unit, base_ccy, quote_ccy, max_leverage, min_lots, max_lots, lot_step, fee_rate, maintenance_margin_rate, markup, swap_long, swap_short, hot, open_paused, sort_order) VALUES
('EURUSD','欧元/美元','Euro / US Dollar','fx',5,100000,'baseCcy','EUR','USD',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,1,0,1),
('GBPUSD','英镑/美元','British Pound / US Dollar','fx',5,100000,'baseCcy','GBP','USD',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,1,0,2),
('USDJPY','美元/日元','US Dollar / Japanese Yen','fx',3,100000,'baseCcy','USD','JPY',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,1,0,3),
('USDCHF','美元/瑞郎','US Dollar / Swiss Franc','fx',5,100000,'baseCcy','USD','CHF',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,0,0,4),
('USDCAD','美元/加元','US Dollar / Canadian Dollar','fx',5,100000,'baseCcy','USD','CAD',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,0,0,5),
('AUDUSD','澳元/美元','Australian Dollar / US Dollar','fx',5,100000,'baseCcy','AUD','USD',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,0,0,6),
('NZDUSD','纽元/美元','New Zealand Dollar / US Dollar','fx',5,100000,'baseCcy','NZD','USD',500,'0.01','50','0.01','0.00005','0.0010',0,0,0,0,0,7),
('EURGBP','欧元/英镑','Euro / British Pound','fx',5,100000,'baseCcy','EUR','GBP',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,8),
('EURJPY','欧元/日元','Euro / Japanese Yen','fx',3,100000,'baseCcy','EUR','JPY',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,9),
('GBPJPY','英镑/日元','British Pound / Japanese Yen','fx',3,100000,'baseCcy','GBP','JPY',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,10),
('EURCHF','欧元/瑞郎','Euro / Swiss Franc','fx',5,100000,'baseCcy','EUR','CHF',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,11),
('EURAUD','欧元/澳元','Euro / Australian Dollar','fx',5,100000,'baseCcy','EUR','AUD',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,12),
('EURCAD','欧元/加元','Euro / Canadian Dollar','fx',5,100000,'baseCcy','EUR','CAD',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,13),
('AUDJPY','澳元/日元','Australian Dollar / Japanese Yen','fx',3,100000,'baseCcy','AUD','JPY',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,14),
('CADJPY','加元/日元','Canadian Dollar / Japanese Yen','fx',3,100000,'baseCcy','CAD','JPY',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,15),
('CHFJPY','瑞郎/日元','Swiss Franc / Japanese Yen','fx',3,100000,'baseCcy','CHF','JPY',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,16),
('AUDCAD','澳元/加元','Australian Dollar / Canadian Dollar','fx',5,100000,'baseCcy','AUD','CAD',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,17),
('AUDNZD','澳元/纽元','Australian Dollar / New Zealand Dollar','fx',5,100000,'baseCcy','AUD','NZD',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,18),
('GBPAUD','英镑/澳元','British Pound / Australian Dollar','fx',5,100000,'baseCcy','GBP','AUD',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,19),
('GBPCHF','英镑/瑞郎','British Pound / Swiss Franc','fx',5,100000,'baseCcy','GBP','CHF',300,'0.01','50','0.01','0.00005','0.0016',0,0,0,0,0,20),
('USDCNH','美元/离岸人民币','US Dollar / Offshore Chinese Yuan','fx',5,100000,'baseCcy','USD','CNH',100,'0.01','50','0.01','0.00005','0.0050',0,0,0,1,0,21),
('XAUUSD','黄金','Gold','metal',2,100,'ounce','XAU','USD',200,'0.01','20','0.01','0.00005','0.0025',0,0,0,1,0,22),
('XAGUSD','白银','Silver','metal',3,5000,'ounce','XAG','USD',200,'0.01','20','0.01','0.00005','0.0025',0,0,0,1,0,23),
('US30','道琼斯 30','Dow Jones 30','index',1,1,'unit','US30','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,24),
('US500','标普 500','S&P 500','index',1,1,'unit','US500','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,25),
('NAS100','纳指 100','Nasdaq 100','index',1,1,'unit','NAS100','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,1,0,26),
('US2000','罗素 2000','Russell 2000','index',1,1,'unit','US2000','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,27),
('GER40','德国 40','Germany 40','index',1,1,'unit','GER40','EUR',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,28),
('UK100','英国 100','UK 100','index',1,1,'unit','UK100','GBP',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,29),
('FRA40','法国 40','France 40','index',1,1,'unit','FRA40','EUR',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,30),
('JPN225','日经 225','Japan 225','index',0,1,'unit','JPN225','JPY',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,31),
('HK50','恒生 50','Hong Kong 50','index',1,1,'unit','HK50','HKD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,32),
('AUS200','澳洲 200','Australia 200','index',1,1,'unit','AUS200','AUD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,33),
('XTIUSD','美国原油（WTI 西德克萨斯中质原油）','US Crude Oil (West Texas Intermediate)','energy',2,1000,'barrel','XTI','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,1,0,34),
('XBRUSD','布伦特原油','Brent Crude Oil','energy',2,1000,'barrel','XBR','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,35),
('BTCUSD','比特币','Bitcoin','crypto',1,1,'unit','BTC','USD',125,'0.01','20','0.01','0.00005','0.0040',0,0,0,1,1,36),
('ETHUSD','以太坊','Ethereum','crypto',2,1,'unit','ETH','USD',125,'0.01','20','0.01','0.00005','0.0040',0,0,0,1,0,37),
('SOLUSD','Solana','Solana','crypto',2,1,'unit','SOL','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,38),
('XRPUSD','瑞波币','XRP','crypto',4,1,'unit','XRP','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,39),
('BNBUSD','币安币','BNB','crypto',2,1,'unit','BNB','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,40),
('DOGEUSD','狗狗币','Dogecoin','crypto',5,1,'unit','DOGE','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,41),
('ADAUSD','艾达币','Cardano','crypto',4,1,'unit','ADA','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,42),
('LTCUSD','莱特币','Litecoin','crypto',2,1,'unit','LTC','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,43),
('DOTUSD','波卡','Polkadot','crypto',3,1,'unit','DOT','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,44),
('BCHUSD','比特币现金','Bitcoin Cash','crypto',2,1,'unit','BCH','USD',75,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,45),
('AAPL','苹果','Apple Inc.','stock',2,1,'share','AAPL','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,46),
('MSFT','微软','Microsoft Corp.','stock',2,1,'share','MSFT','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,47),
('NVDA','英伟达','NVIDIA Corp.','stock',2,1,'share','NVDA','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,48),
('TSLA','特斯拉','Tesla Inc.','stock',2,1,'share','TSLA','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,49),
('AMZN','亚马逊','Amazon.com Inc.','stock',2,1,'share','AMZN','USD',100,'0.01','20','0.01','0.00005','0.0050',0,0,0,0,0,50);

-- 交易时段（UTC，简化值，以后在后台调整）：
-- 外汇、贵金属、指数、能源：周日 22:00 到周五 21:00；加密货币：全天候；美股：周一到周五 13:30–20:00
INSERT INTO market_session (symbol, day_of_week, open_minute, close_minute)
SELECT code, 7, 1320, 1440 FROM market_symbol WHERE category IN ('fx', 'metal', 'index', 'energy')
UNION ALL SELECT s.code, d.d, 0, 1440 FROM market_symbol s JOIN (SELECT 1 AS d UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) d WHERE s.category IN ('fx', 'metal', 'index', 'energy')
UNION ALL SELECT code, 5, 0, 1260 FROM market_symbol WHERE category IN ('fx', 'metal', 'index', 'energy')
UNION ALL SELECT s.code, d.d, 0, 1440 FROM market_symbol s JOIN (SELECT 1 AS d UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7) d WHERE s.category = 'crypto'
UNION ALL SELECT s.code, d.d, 810, 1200 FROM market_symbol s JOIN (SELECT 1 AS d UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) d WHERE s.category = 'stock';
