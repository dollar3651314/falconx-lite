-- V19（S16c）：风控页和交易参数页改的两项配置（不在系统配置页显示，见 common/config/ConfigKey.java）。说明见 技术方案/v1-数据库设计.md 2.39
INSERT INTO common_config (config_key, value) VALUES
('risk.perUserLimitUsd', '3000000'),
('trading.marginCallLevel', '100');
