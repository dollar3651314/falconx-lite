-- V25（2026-10-17 热钱包余额告警）：六个告警下限，在后台"系统配置"页改（权限 config:edit，高危、写审计）。
-- Amos 2026-10-17："告警的默认下限让我可以设置，现在设置成零"：默认全部 0 = 不告警；余额照常查询，后台对账页显示。
-- 单位：minUsdt.* 是 USDT；minGas.ERC20 是 ETH、minGas.BSC 是 BNB、minGas.TRC20 是 TRX。说明见 技术方案/v1-提现方案.md 第 6 节、技术方案/v1-数据库设计.md
INSERT INTO common_config (config_key, value) VALUES
('hotWallet.minUsdt.ERC20', '0'),
('hotWallet.minUsdt.BSC', '0'),
('hotWallet.minUsdt.TRC20', '0'),
('hotWallet.minGas.ERC20', '0'),
('hotWallet.minGas.BSC', '0'),
('hotWallet.minGas.TRC20', '0');
