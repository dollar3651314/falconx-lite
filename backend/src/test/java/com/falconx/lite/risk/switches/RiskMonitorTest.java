package com.falconx.lite.risk.switches;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.risk.api.RiskApi;
import com.falconx.lite.support.FixedClockConfig;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 风控敞口和自动禁开（S11，AC-22），真实 MySQL。和交易测试共用一个 Spring 上下文。数据库里可能有其他测试留下的持仓，所以按"前后差值"断言。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
class RiskMonitorTest {

  @Autowired RiskApi risk;
  @Autowired RiskSwitchMapper mapper;
  @Autowired QuoteProcessor processor;
  @Autowired JdbcTemplate jdbc;
  @MockitoBean MailApi mail;

  MailApi alerts = mock(MailApi.class);
  ExposureMonitor monitor;

  @BeforeEach
  void setUp() {
    processor.process(new RawQuote("AUDUSD", new BigDecimal("0.66000"), new BigDecimal("0.66020"), FixedClockConfig.NOW));
    RiskProperties props = new RiskProperties(false, List.of("risk@example.com"));
    monitor = new ExposureMonitor(risk, mapper, new RiskAlerts(alerts, props), props);
  }

  @AfterEach
  void tearDown() {
    jdbc.update("UPDATE risk_switch SET global_open_paused = 0, auto_global_paused = 0, auto_liquidation = 1, platform_net_threshold = NULL WHERE id = 1");
    jdbc.update("DELETE FROM risk_symbol");
    // 这里写的持仓只为算敞口，测完平掉，不影响其他测试
    jdbc.update("UPDATE trading_position SET status = 'CLOSED', closed_at = UTC_TIMESTAMP(3) WHERE user_id = 1 AND symbol = 'AUDUSD' AND status = 'OPEN'");
  }

  /** 直接写一条持仓（风控只看持仓表的合计） */
  void position(String symbol, String side, String lots) {
    jdbc.update("""
        INSERT INTO trading_position (public_no, user_id, order_id, symbol, side, lots, leverage, open_price, contract_size, quote_ccy, open_usd_rate, notional_usd,
          margin, fee, maintenance_margin_rate, liquidation_price, status, opened_at)
        VALUES (?, 1, FLOOR(RAND() * 1000000000000), ?, ?, ?, 100, 0.66, 100000, 'USD', 1, 0, 1, 0, 0.001, 0.0001, 'OPEN', UTC_TIMESTAMP(3))""",
        com.falconx.lite.common.id.Snowflake.shared(1).next(), symbol, side, new BigDecimal(lots));
  }

  RiskApi.SymbolExposure aud() {
    return risk.dashboard().symbols().stream().filter(s -> s.symbol().equals("AUDUSD")).findFirst().orElseThrow();
  }

  @Test
  void 敞口按当前中间价折算USD_净敞口是多减空_平台是各品种绝对值之和() {
    RiskApi.SymbolExposure before = aud();
    BigDecimal platformBefore = risk.dashboard().platformNetUsd();
    position("AUDUSD", "BUY", "2.00");
    position("AUDUSD", "SELL", "0.50");
    RiskApi.SymbolExposure after = aud();
    // 中间价 0.6601：多头 2 × 100000 × 0.6601 = 132,020；空头 33,005；净 99,015
    assertThat(after.longUsd().subtract(before.longUsd())).isEqualByComparingTo("132020");
    assertThat(after.shortUsd().subtract(before.shortUsd())).isEqualByComparingTo("33005");
    assertThat(after.netUsd().subtract(before.netUsd())).isEqualByComparingTo("99015");
    BigDecimal platformAfter = risk.dashboard().platformNetUsd();
    assertThat(platformAfter.subtract(platformBefore)).isEqualByComparingTo(after.netUsd().abs().subtract(before.netUsd().abs()));
  }

  @Test
  void 品种净敞口超阈值自动禁开_只通知一次_手动恢复() {
    position("AUDUSD", "BUY", "1.00");
    BigDecimal net = aud().netUsd().abs();
    risk.setSymbolThreshold("AUDUSD", net.add(BigDecimal.ONE), 7L);
    assertThat(monitor.check()).as("没超过").isZero();
    assertThat(risk.symbolOpenPaused("AUDUSD")).isFalse();

    risk.setSymbolThreshold("AUDUSD", net.subtract(BigDecimal.ONE), 7L);
    assertThat(monitor.check()).isEqualTo(1);
    assertThat(risk.symbolOpenPaused("AUDUSD")).isTrue();
    assertThat(monitor.check()).as("已经禁开，不重复触发").isZero();
    verify(alerts, times(1)).send(eq("risk@example.com"), eq("RISK_AUTO_PAUSE"), anyMap());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM risk_event WHERE kind = 'AUTO_PAUSE_SYMBOL' AND symbol = 'AUDUSD' AND operator_id IS NULL", Integer.class))
        .isGreaterThanOrEqualTo(1);

    risk.resumeSymbol("AUDUSD", 7L);
    assertThat(risk.symbolOpenPaused("AUDUSD")).isFalse();
    assertThat(risk.globalOpenPaused()).isFalse();
  }

  @Test
  void 平台总净敞口超阈值_全部自动禁开() {
    position("AUDUSD", "BUY", "1.00");
    BigDecimal total = risk.dashboard().platformNetUsd();
    risk.setPlatformThreshold(total.subtract(BigDecimal.ONE), 7L);
    assertThat(monitor.check()).isEqualTo(1);
    assertThat(risk.globalOpenPaused()).isTrue();
    assertThat(risk.dashboard().globalAutoPaused()).isTrue();
    risk.resumeGlobal(7L);
    assertThat(risk.globalOpenPaused()).isFalse();
  }

  @Test
  void 没有设置阈值的不监控_手动暂停和自动强平开关() {
    position("AUDUSD", "BUY", "50.00");
    assertThat(monitor.check()).isZero();
    risk.pauseSymbol("AUDUSD", 7L);
    assertThat(risk.symbolOpenPaused("AUDUSD")).isTrue();
    risk.pauseGlobal(7L);
    assertThat(risk.globalOpenPaused()).isTrue();
    risk.setAutoLiquidation(false, 7L);
    assertThat(risk.autoLiquidationEnabled()).isFalse();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM risk_event WHERE operator_id = 7 AND kind IN ('PAUSE_SYMBOL', 'PAUSE_GLOBAL', 'AUTO_LIQUIDATION_OFF')",
        Integer.class)).isGreaterThanOrEqualTo(3);
  }
}
