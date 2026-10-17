package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 下单（S7）。公共设置见 {@link TradingTestSupport}。
 * 报价是原始价，客户价含加点（V24：买卖合计 20 点 = 每边 10 点，XAUUSD 每边 0.10、USDJPY 每边 0.010）：XAUUSD 原始 4126.35 / 4126.75 → 客户 4126.25 / 4126.85。
 */
class OrderFlowTest extends TradingTestSupport {

  @Test
  void 市价买入_按ask成交_保证金手续费强平价和手算一致_手续费记账() {
    long uid = newUser("1000");
    var r = orders.place(uid, market("XAUUSD", "buy", "0.10", 100));
    assertThat(r.kind()).isEqualTo("filled");
    assertThat(r.price()).as("原始 ask 4126.75 + 加点 0.10").isEqualTo("4126.85");
    PositionRow p = orders.positions(uid).getFirst();
    // 名义价值 4126.85 × 0.1 × 100 = 41,268.5；保证金 ÷100 = 412.685；手续费 × 0.005% = 2.063425
    assertThat(p.margin).isEqualByComparingTo("412.685");
    assertThat(p.fee).isEqualByComparingTo("2.063425");
    // 强平价 = 4126.85 − 412.685 ÷ 10 + 4126.85 × 0.25% = 4095.898625 → 4095.90
    assertThat(p.liquidationPrice).isEqualByComparingTo("4095.90");
    assertThat(p.maintenanceMarginRate).isEqualByComparingTo("0.0025");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("997.936575");
    assertThat(ledgerSum(uid, "BALANCE")).as("账本合计 = 余额").isEqualByComparingTo(bucket(uid, "balance"));
  }

  @Test
  void 非USD报价品种_卖出按bid_按实时汇率折算() {
    long uid = newUser("1000");
    var r = orders.place(uid, market("USDJPY", "sell", "1.00", 500));
    assertThat(r.price()).as("原始 bid 151.840 − 加点 0.010").isEqualTo("151.830");
    PositionRow p = orders.positions(uid).getFirst();
    // 汇率用不含加点的中间价 151.85
    BigDecimal exact = new BigDecimal("15183000").divide(new BigDecimal("151.85"), java.math.MathContext.DECIMAL64);
    assertThat(p.notionalUsd.subtract(exact).abs()).isLessThanOrEqualTo(new BigDecimal("0.01"));
    assertThat(p.margin.subtract(exact.divide(new BigDecimal("500"), java.math.MathContext.DECIMAL64)).abs()).isLessThanOrEqualTo(new BigDecimal("0.01"));
  }

  @Test
  void 加点只加一次_成交价等于对客报价() {
    BigDecimal before = jdbc.queryForObject("SELECT markup FROM market_symbol WHERE code = 'US500'", BigDecimal.class);
    assertThat(before).as("V24：US500 1 位小数，每边 10 点 = 1.0").isEqualByComparingTo("1.0");
    jdbc.update("UPDATE market_symbol SET markup = 0.5 WHERE code = 'US500'");
    catalog.reload();
    try {
      quote("US500", "6712.0", "6712.4");
      long uid = newUser("5000");
      assertThat(orders.place(uid, market("US500", "buy", "1.00", 100)).price()).as("6712.4 + 0.5，只加一次").isEqualTo("6712.9");
      assertThat(orders.place(uid, market("US500", "sell", "1.00", 100)).price()).as("6712.0 − 0.5").isEqualTo("6711.5");
    } finally {
      jdbc.update("UPDATE market_symbol SET markup = ? WHERE code = 'US500'", before);
      catalog.reload();
    }
  }

  @Test
  void 同一个clientOrderId重复提交只下一次单() {
    long uid = newUser("1000");
    PlaceOrder req = market("XAUUSD", "buy", "0.10", 100);
    var a = orders.place(uid, req);
    var b = orders.place(uid, req);
    assertThat(b.id()).isEqualTo(a.id());
    assertThat(b.price()).isEqualTo(a.price());
    assertThat(orders.positions(uid)).hasSize(1);
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("997.936575");
  }

  @Test
  void 限价单冻结保证金和手续费_撤单后释放_不能重复撤() {
    long uid = newUser("1000");
    var r = orders.place(uid, new PlaceOrder("XAUUSD", "limit", "buy", "0.10", 100, "4100.00", "4200.00", "4050.00", UUID.randomUUID().toString()));
    assertThat(r.kind()).isEqualTo("pending");
    // 4100 × 0.1 × 100 = 41,000；保证金 410 + 手续费 2.05
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("412.05");
    assertThat(orders.pendingOrders(uid).getFirst().takeProfit).isEqualByComparingTo("4200");
    orders.cancel(uid, orderId(r.id()));
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("0");
    assertThat(bucket(uid, "balance")).as("撤单不收手续费").isEqualByComparingTo("1000");
    assertThat(ledgerSum(uid, "ORDER_FROZEN")).isEqualByComparingTo("0");
    assertThat(code(() -> orders.cancel(uid, orderId(r.id())))).isEqualTo("NOT_FOUND");
    long other = newUser("0");
    var r2 = orders.place(uid, new PlaceOrder("XAUUSD", "limit", "buy", "0.10", 100, "4100.00", null, null, UUID.randomUUID().toString()));
    assertThat(code(() -> orders.cancel(other, orderId(r2.id())))).as("不能撤别人的单").isEqualTo("NOT_FOUND");
  }

  @Test
  void 七种拒单原因和报价不可用() {
    long rich = newUser("100000");
    assertThat(code(() -> orders.place(rich, market("AAPL", "buy", "1.00", 10)))).as("美股 10:00 UTC 未开盘").isEqualTo("TRADING_CLOSED");
    assertThat(code(() -> orders.place(rich, market("BTCUSD", "buy", "0.10", 10)))).as("BTCUSD 初始配置为暂停开仓").isEqualTo("SYMBOL_PAUSED");
    jdbc.update("UPDATE risk_switch SET global_open_paused = 1 WHERE id = 1");
    try {
      assertThat(code(() -> orders.place(rich, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("GLOBAL_PAUSED");
    } finally {
      jdbc.update("UPDATE risk_switch SET global_open_paused = 0 WHERE id = 1");
    }
    assertThat(code(() -> orders.place(rich, market("NZDUSD", "buy", "0.10", 100)))).as("没有收到过报价").isEqualTo("QUOTE_UNAVAILABLE");
    // USDJPY 报价异常（买卖倒挂）→ 日元汇率失效，EURJPY 自己的报价正常也不能开仓
    quote("USDJPY", "151.870", "151.850");
    try {
      assertThat(code(() -> orders.place(rich, market("EURJPY", "buy", "0.10", 100)))).isEqualTo("RATE_STALE");
    } finally {
      quote("USDJPY", "151.840", "151.860");
    }
    assertThat(code(() -> orders.place(rich, market("EURJPY", "buy", "0.10", 100)))).as("汇率恢复后可以下单").isEqualTo("OK");
    assertThat(code(() -> orders.place(rich, market("XAUUSD", "buy", "0.10", 201)))).isEqualTo("LEVERAGE_EXCEEDED");
    assertThat(code(() -> orders.place(rich, market("XAUUSD", "buy", "8.00", 200)))).as("8 手黄金约 330 万 USD").isEqualTo("POSITION_LIMIT");
    long poor = newUser("10");
    assertThat(code(() -> orders.place(poor, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("INSUFFICIENT_BALANCE");
    assertThat(orders.positions(poor)).isEmpty();
    assertThat(bucket(poor, "balance")).isEqualByComparingTo("10");
  }

  @Test
  void 持仓上限把挂单也算进去() {
    long uid = newUser("100000");
    // 4100 × 4 × 100 = 1,640,000（挂单）；再市价 4 手约 1,650,700 → 合计超过 3,000,000
    orders.place(uid, new PlaceOrder("XAUUSD", "limit", "buy", "4.00", 200, "4100.00", null, null, UUID.randomUUID().toString()));
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "4.00", 200)))).isEqualTo("POSITION_LIMIT");
  }

  @Test
  void 字段错误一次全部返回_止盈止损方向() {
    long uid = newUser("1000");
    assertThatThrownBy(() -> orders.place(uid, new PlaceOrder("NOPE", "stop", "x", "-1", 0, null, "abc", null, "")))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields()).extracting(ValidationException.Field::field)
            .contains("symbol", "type", "side", "lots", "leverage", "takeProfit", "clientOrderId"));
    assertThatThrownBy(() -> orders.place(uid, new PlaceOrder("XAUUSD", "market", "buy", "0.123", 100, null, null, null, "c1")))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields()).containsExactly(new ValidationException.Field("lots", "lotsStep")));
    assertThatThrownBy(() -> orders.place(uid, new PlaceOrder("XAUUSD", "market", "buy", "0.10", 100, null, "4100.00", "4130.00", "c2")))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields())
            .containsExactlyInAnyOrder(new ValidationException.Field("takeProfit", "tpBuy"), new ValidationException.Field("stopLoss", "slBuy")));
    assertThatThrownBy(() -> orders.place(uid, new PlaceOrder("XAUUSD", "market", "sell", "0.10", 100, null, "4130.00", "4100.00", "c3")))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields())
            .containsExactlyInAnyOrder(new ValidationException.Field("takeProfit", "tpSell"), new ValidationException.Field("stopLoss", "slSell")));
    assertThat(orders.positions(uid)).isEmpty();
  }

  @Test
  void 并发下单不会超出可用余额_账本和余额一致() throws Exception {
    // 每单需要 412.685 + 2.063425；开仓后每单浮亏 (4126.25 − 4126.85) × 10 = 6 USD。1,300 只够 3 单
    long uid = newUser("1300");
    ExecutorService pool = Executors.newFixedThreadPool(10);
    CountDownLatch go = new CountDownLatch(1);
    List<Future<String>> fs = new ArrayList<>();
    for (int i = 0; i < 10; i++) {
      fs.add(pool.submit(() -> {
        go.await();
        return code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)));
      }));
    }
    go.countDown();
    int ok = 0;
    for (Future<String> f : fs) {
      String c = f.get();
      if (c.equals("OK")) ok++;
      else assertThat(c).isEqualTo("INSUFFICIENT_BALANCE");
    }
    pool.shutdown();
    assertThat(ok).isEqualTo(3);
    assertThat(orders.positions(uid)).hasSize(3);
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(new BigDecimal("1300").subtract(new BigDecimal("2.063425").multiply(new BigDecimal(3))));
    assertThat(ledgerSum(uid, "BALANCE")).isEqualByComparingTo(bucket(uid, "balance"));
  }

  @Test
  void 接口_下单_持仓_挂单_账户_撤单_错误格式() throws Exception {
    assertThat(mvc.perform(get("/api/trading/account")).andReturn().getResponse().getStatus()).isEqualTo(401);
    Cookie c = login();
    String filled = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"takeProfit\":\"4200.00\",\"clientOrderId\":\"api-1\"}"))
        .andReturn().getResponse().getContentAsString();
    assertThat(filled).contains("\"kind\":\"filled\"").contains("\"price\":\"4126.85\"");
    String pos = mvc.perform(get("/api/trading/positions").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(pos).contains("\"side\":\"buy\"").contains("\"lots\":\"0.10\"").contains("\"openPrice\":\"4126.85\"").contains("\"margin\":\"412.685\"")
        .contains("\"liquidationPrice\":\"4095.90\"").contains("\"takeProfit\":\"4200.00\"").contains("\"maintenanceMarginRate\":\"0.0025\"").contains("Z\"");
    String pending = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"limit\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"limitPrice\":\"4100.00\",\"clientOrderId\":\"api-2\"}"))
        .andReturn().getResponse().getContentAsString();
    assertThat(pending).contains("\"kind\":\"pending\"");
    assertThat(mvc.perform(get("/api/trading/orders").cookie(c)).andReturn().getResponse().getContentAsString()).contains("\"limitPrice\":\"4100.00\"").contains("\"frozenMargin\":\"412.05\"");
    // 余额 1000 − 2.063425；浮亏 (4126.25 − 4126.85) × 10 = −6；可用 = 997.936575 − 6 − 412.685 − 412.05
    String acc = mvc.perform(get("/api/trading/account").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(acc).contains("\"balance\":\"997.936575\"").contains("\"orderFrozen\":\"412.05\"").contains("\"floatingPnl\":\"-6\"")
        .contains("\"equity\":\"991.936575\"").contains("\"usedMargin\":\"412.685\"").contains("\"available\":\"167.201575\"");
    String id = pending.replaceAll(".*\"id\":\"(\\d+)\".*", "$1");
    assertThat(mvc.perform(delete("/api/trading/orders/" + id).cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(200);
    var notFound = mvc.perform(delete("/api/trading/orders/" + id).cookie(c)).andReturn().getResponse();
    assertThat(notFound.getStatus()).isEqualTo(404);
    assertThat(notFound.getContentAsString()).contains("NOT_FOUND");
    var rejected = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":500,\"clientOrderId\":\"api-3\"}")).andReturn().getResponse();
    assertThat(rejected.getStatus()).isEqualTo(400);
    assertThat(rejected.getContentAsString()).contains("\"code\":\"LEVERAGE_EXCEEDED\"");
    var invalid = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0\",\"leverage\":0,\"clientOrderId\":\"api-4\"}")).andReturn().getResponse().getContentAsString();
    assertThat(invalid).contains("VALIDATION_FAILED").contains("{\"field\":\"lots\",\"code\":\"positiveNumber\"}").contains("{\"field\":\"leverage\",\"code\":\"leverageInteger\"}");
  }
}
