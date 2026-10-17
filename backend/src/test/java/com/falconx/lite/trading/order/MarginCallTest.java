package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 追保预警（AC-15，通知方案 N4）：跌破追保线通知一次；一直在线下不重复；回到线上再跌破，满 5 分钟才再通知。 */
class MarginCallTest extends TradingTestSupport {

  @Autowired MarginCallMonitor monitor;

  long open(long uid) {
    // 200 倍，按客户买价 4126.85（原始 4126.75 + 加点 0.10）开仓：保证金 206.3425，手续费 2.063425，强平价约 4116.53（测试里撮合引擎关闭，不会强平）
    return orderId(orders.place(uid, new PlaceOrder("XAUUSD", "market", "buy", "0.10", 200, null, null, null, UUID.randomUUID().toString())).id());
  }

  long marginCalls(long uid) {
    return notices(uid).stream().filter(n -> n.startsWith("MARGIN_CALL")).count();
  }

  @Test
  void 跌破追保线只通知一次_回到线上再跌破_满5分钟才再通知() {
    long uid = newUser("300");
    open(uid);
    monitor.check();
    // 客户 bid 4126.25：浮亏 (4126.25 − 4126.85) × 10 = −6，净值 300 − 2.063425 − 6 = 291.936575，÷ 保证金 206.3425 = 141.48%
    assertThat(monitor.level(uid)).get().satisfies(l -> assertThat(l).isEqualByComparingTo("1.414815"));
    assertThat(marginCalls(uid)).isZero();

    // 客户 bid 4116.90：浮亏 (4116.90 − 4126.85) × 10 = −99.5，净值 198.436575，水平 96.16%
    quote("XAUUSD", "4117.00", "4117.40");
    monitor.check();
    assertThat(marginCalls(uid)).isEqualTo(1);
    assertThat(notices(uid).getLast()).contains("\"level\":\"96.16\"").contains("\"line\":\"100\"");
    monitor.check();
    monitor.check();
    assertThat(marginCalls(uid)).as("一直在线下不重复").isEqualTo(1);

    quote("XAUUSD", "4126.35", "4126.75");
    monitor.check();
    quote("XAUUSD", "4117.00", "4117.40");
    monitor.check();
    assertThat(marginCalls(uid)).as("回到线上再跌破，但离上次不到 5 分钟").isEqualTo(1);

    jdbc.update("UPDATE trading_margin_call SET last_notified_at = last_notified_at - INTERVAL 5 MINUTE WHERE user_id = ?", uid);
    monitor.check();
    assertThat(marginCalls(uid)).as("满 5 分钟还在线下，再通知一次").isEqualTo(2);
    monitor.check();
    assertThat(marginCalls(uid)).isEqualTo(2);
  }

  @Test
  void 没有持仓不检查_平仓后状态恢复() {
    long uid = newUser("300");
    long id = open(uid);
    quote("XAUUSD", "4117.00", "4117.40");
    monitor.check();
    assertThat(marginCalls(uid)).isEqualTo(1);
    long pos = jdbc.queryForObject("SELECT position_id FROM trading_order WHERE id = ?", Long.class, id);
    jdbc.update("UPDATE trading_position SET status = 'CLOSED' WHERE id = ?", pos);
    monitor.check();
    assertThat(monitor.level(uid)).isEmpty();
    assertThat(jdbc.queryForObject("SELECT below FROM trading_margin_call WHERE user_id = ?", Boolean.class, uid)).isFalse();
  }
}
