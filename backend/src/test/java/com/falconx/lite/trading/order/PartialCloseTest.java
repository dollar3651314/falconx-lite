package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * 部分平仓（体验优化 1021 UX-6，迁移 V32 拆行）：真实 MySQL（C37）。
 * 报价是原始价，客户价含加点（每边 0.10）：原始 4126.35 / 4126.75 → 客户 4126.25 / 4126.85，多单按 4126.85 开仓。
 * XAUUSD：合约 100、最小手数 0.01、步长 0.01、手续费率 0.005%、维持保证金率 0.25%。
 */
class PartialCloseTest extends TradingTestSupport {

  @Autowired PositionService positions;
  @Autowired MatchingEngine engine;
  @Autowired SwapService swaps;
  @Autowired MarketApi market;
  @Autowired com.falconx.lite.trading.api.CustomerFlowApi flows;

  @AfterEach
  void reset() {
    jdbc.update("UPDATE market_symbol SET swap_long = 0, swap_short = 0, min_lots = 0.01 WHERE code = 'XAUUSD'");
    catalog.reload();
    quote("XAUUSD", "4126.35", "4126.75");
  }

  /** 一行持仓的关键字段 */
  record Row(long id, Long parentId, long orderId, String status, BigDecimal lots, BigDecimal margin, BigDecimal fee, BigDecimal swapTotal, BigDecimal notional,
      BigDecimal liq, BigDecimal tp, BigDecimal sl, BigDecimal pnl, String reason, String openedAt) {}

  Row row(long id) {
    return jdbc.queryForObject("SELECT id, parent_id, order_id, status, lots, margin, fee, swap_total, notional_usd, liquidation_price, take_profit, stop_loss, "
        + "realized_pnl, close_reason, DATE_FORMAT(opened_at, '%Y-%m-%d %H:%i:%s.%f') FROM trading_position WHERE id = ?", (rs, i) -> new Row(rs.getLong(1),
        (Long) rs.getObject(2), rs.getLong(3), rs.getString(4), rs.getBigDecimal(5), rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getBigDecimal(8),
        rs.getBigDecimal(9), rs.getBigDecimal(10), rs.getBigDecimal(11), rs.getBigDecimal(12), rs.getBigDecimal(13), rs.getString(14), rs.getString(15)), id);
  }

  /** 原持仓拆出来的行，按 id */
  List<Row> children(long parentId) {
    return jdbc.queryForList("SELECT id FROM trading_position WHERE parent_id = ? ORDER BY id", Long.class, parentId).stream().map(this::row).toList();
  }

  long open(long uid, String lots, int lev, String tp, String sl) {
    orders.place(uid, new PlaceOrder("XAUUSD", "market", "buy", lots, lev, null, tp, sl, UUID.randomUUID().toString()));
    return orders.positions(uid).getFirst().id;
  }

  List<String> fieldCodes(Runnable r) {
    try {
      r.run();
      return List.of("OK");
    } catch (ValidationException e) {
      return e.fields().stream().map(f -> f.field() + ":" + f.code()).toList();
    }
  }

  void assertLedgerConsistent(long uid) {
    assertThat(ledgerSum(uid, "BALANCE")).as("账本合计 = 余额").isEqualByComparingTo(bucket(uid, "balance"));
    int closedWithPnl = jdbc.queryForObject("SELECT COUNT(*) FROM trading_position WHERE user_id = ? AND status = 'CLOSED' AND realized_pnl <> 0", Integer.class, uid);
    int pnlEntries = jdbc.queryForObject("SELECT COUNT(*) FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id "
        + "WHERE a.user_id = ? AND l.entry_type = 'REALIZED_PNL'", Integer.class, uid);
    assertThat(pnlEntries).as("每一行已平仓（含拆出来的）一笔已实现盈亏").isEqualTo(closedWithPnl);
  }

  @Test
  void 部分平仓_拆一行已平仓_保证金手续费名义价值按比例_盈亏只算平掉的_止盈止损和强平价不变_账本一致() {
    long uid = newUser("1000");
    long id = open(uid, "0.10", 100, "4200.00", "4050.00");
    Row before = row(id);
    quote("XAUUSD", "4136.35", "4136.75");
    var c = positions.close(uid, id, "0.04");
    // (4136.25 − 4126.85) × 0.04 × 100 = 37.6
    assertThat(c.pnl()).isEqualByComparingTo("37.6");
    assertThat(c.price()).isEqualByComparingTo("4136.25");
    assertThat(c.closedLots()).isEqualByComparingTo("0.04");
    assertThat(c.remainingLots()).isEqualByComparingTo("0.06");

    Row rest = row(id);
    assertThat(rest.status()).isEqualTo("OPEN");
    assertThat(rest.lots()).isEqualByComparingTo("0.06");
    assertThat(rest.margin()).as("412.685 × 0.6").isEqualByComparingTo("247.611");
    assertThat(rest.fee()).isEqualByComparingTo("1.238055");
    assertThat(rest.notional()).isEqualByComparingTo("24761.1");
    assertThat(rest.liq()).as("按比例拆分时强平价不变").isEqualByComparingTo(before.liq()).isEqualByComparingTo("4095.90");
    assertThat(rest.tp()).as("止盈止损保留").isEqualByComparingTo("4200");
    assertThat(rest.sl()).isEqualByComparingTo("4050");

    Row part = children(id).getFirst();
    assertThat(children(id)).hasSize(1);
    assertThat(part.parentId()).isEqualTo(id);
    assertThat(part.orderId()).as("和原持仓同一张订单").isEqualTo(before.orderId());
    assertThat(part.openedAt()).as("开仓时间和原持仓相同").isEqualTo(before.openedAt());
    assertThat(part.status()).isEqualTo("CLOSED");
    assertThat(part.reason()).isEqualTo("CLOSED");
    assertThat(part.lots()).isEqualByComparingTo("0.04");
    assertThat(part.margin()).isEqualByComparingTo("165.074");
    assertThat(part.fee()).isEqualByComparingTo("0.82537");
    assertThat(part.pnl()).isEqualByComparingTo("37.6");
    assertThat(part.margin().add(rest.margin())).isEqualByComparingTo(before.margin());
    assertThat(part.fee().add(rest.fee())).isEqualByComparingTo(before.fee());
    assertThat(part.notional().add(rest.notional())).isEqualByComparingTo(before.notional());

    // 1000 − 手续费 2.063425 + 37.6；已实现盈亏的来源是拆出来的那一行
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("1035.536575");
    assertThat(jdbc.queryForObject("SELECT l.biz_id FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id "
        + "WHERE a.user_id = ? AND l.entry_type = 'REALIZED_PNL'", String.class, uid)).isEqualTo(String.valueOf(part.id()));
    assertLedgerConsistent(uid);

    // 部分平仓站内信写明平了多少手、还剩多少手（只发站内信）
    assertThat(notices(uid)).filteredOn(n -> n.startsWith("POSITION_PARTIAL_CLOSED")).singleElement().asString()
        .contains("\"lots\":\"0.04\"").contains("\"remaining\":\"0.06\"").contains("\"price\":\"4136.25\"").contains("\"pnl\":\"37.6\"");
    assertThat(notices(uid)).noneMatch(n -> n.startsWith("POSITION_CLOSED"));
    assertThat(jdbc.queryForList("SELECT channel FROM notify_record WHERE user_id = ? AND template_code = 'POSITION_PARTIAL_CLOSED'", String.class, uid))
        .containsExactly("INBOX");

    // 再全部平掉剩下的：原持仓那一行变成 CLOSED，手数是剩下的 0.06
    var all = positions.close(uid, id, null);
    assertThat(all.closedLots()).isEqualByComparingTo("0.06");
    assertThat(all.remainingLots()).isEqualByComparingTo("0");
    assertThat(all.pnl()).isEqualByComparingTo("56.4");
    assertThat(row(id).status()).isEqualTo("CLOSED");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("1091.936575");
    assertThat(notices(uid)).filteredOn(n -> n.startsWith("POSITION_CLOSED")).singleElement().asString().contains("\"lots\":\"0.06\"");
    assertLedgerConsistent(uid);
    // 提现自动审批读的数据：成交量按订单算一次（拆出来的行不重复算），已实现盈亏是两笔之和
    assertThat(flows.openedNotionalSince(uid, java.time.LocalDateTime.parse("2000-01-01T00:00:00"))).isEqualByComparingTo("41268.5");
    assertThat(flows.realizedPnl(uid, null)).isEqualByComparingTo("94");
  }

  @Test
  void 手数边界_等于最小手数_剩余等于最小手数_步长不对_超过持仓_剩余低于最小手数_等于持仓是全部平仓() {
    long uid = newUser("2000");
    long id = open(uid, "0.10", 100, null, null);
    assertThat(fieldCodes(() -> positions.close(uid, id, "0.055"))).containsExactly("lots:lotsStep");
    assertThat(fieldCodes(() -> positions.close(uid, id, "0.11"))).containsExactly("lots:closeLotsMax");
    assertThat(fieldCodes(() -> positions.close(uid, id, "abc"))).containsExactly("lots:positiveNumber");
    assertThat(fieldCodes(() -> positions.close(uid, id, "0"))).containsExactly("lots:positiveNumber");
    assertThat(fieldCodes(() -> positions.close(uid, id, "0.01"))).as("平掉的等于最小手数").containsExactly("OK");
    assertThat(fieldCodes(() -> positions.close(uid, id, "0.08"))).as("剩下的等于最小手数").containsExactly("OK");
    assertThat(row(id).lots()).isEqualByComparingTo("0.01");
    assertThat(fieldCodes(() -> positions.close(uid, id, "0.02"))).as("超过当前手数（已经变了）").containsExactly("lots:closeLotsMax");
    assertThat(fieldCodes(() -> positions.close(uid, id, "0.01"))).as("等于持仓手数 = 全部平仓").containsExactly("OK");
    assertThat(row(id).status()).isEqualTo("CLOSED");
    assertThat(children(id)).hasSize(2);
    assertLedgerConsistent(uid);

    // 最小手数大于步长的品种：剩下的不能少于最小手数，只能全部平仓
    jdbc.update("UPDATE market_symbol SET min_lots = 0.05 WHERE code = 'XAUUSD'");
    catalog.reload();
    long id2 = open(uid, "0.10", 100, null, null);
    assertThat(fieldCodes(() -> positions.close(uid, id2, "0.06"))).containsExactly("lots:closeRemainMin");
    assertThat(fieldCodes(() -> positions.close(uid, id2, "0.03"))).containsExactly("lots:lotsMin");
    assertThat(fieldCodes(() -> positions.close(uid, id2, "0.051"))).containsExactlyInAnyOrder("lots:lotsStep", "lots:closeRemainMin");
    assertThat(row(id2).lots()).as("检查失败不改数据").isEqualByComparingTo("0.10");
    assertThat(fieldCodes(() -> positions.close(uid, id2, "0.05"))).as("两边都等于最小手数").containsExactly("OK");
    assertThat(row(id2).lots()).isEqualByComparingTo("0.05");
    assertLedgerConsistent(uid);
  }

  @Test
  void 金额精度_按比例拆不尽时8位小数_两行合计和拆分前一分不差_强平价不变() {
    long uid = newUser("3000");
    long id = open(uid, "0.30", 100, null, null);
    positions.addMargin(uid, id, "100");
    Row before = row(id);
    assertThat(before.margin()).isEqualByComparingTo("1338.055");
    positions.close(uid, id, "0.10");
    Row rest = row(id);
    Row part = children(id).getFirst();
    // 1338.055 ÷ 3 = 446.018333…，四舍五入到 8 位；剩下的用减法
    assertThat(part.margin()).isEqualByComparingTo("446.01833333");
    assertThat(rest.margin()).isEqualByComparingTo("892.03666667");
    assertThat(part.margin().add(rest.margin())).isEqualByComparingTo(before.margin());
    assertThat(part.fee().add(rest.fee())).isEqualByComparingTo(before.fee());
    assertThat(part.notional().add(rest.notional())).isEqualByComparingTo(before.notional());
    assertThat(rest.liq()).isEqualByComparingTo(before.liq()).isEqualByComparingTo("4092.57");
    assertThat(PositionService.share(new BigDecimal("1"), new BigDecimal("0.01"), new BigDecimal("0.03"))).isEqualByComparingTo("0.33333333");
    assertLedgerConsistent(uid);
  }

  @Test
  void 逐仓亏损上限是平掉部分的保证金_两次合计正好是整个保证金_余额不为负() {
    long uid = newUser("300");
    long id = open(uid, "0.10", 200, null, null);
    quote("XAUUSD", "3999.60", "4000.00");
    // 实际亏损 (3999.50 − 4126.85) × 4 = −509.4，封顶为这部分的保证金 206.3425 × 0.4
    assertThat(positions.close(uid, id, "0.04").pnl()).isEqualByComparingTo("-82.537");
    assertThat(positions.close(uid, id).pnl()).isEqualByComparingTo("-123.8055");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(new BigDecimal("300").subtract(new BigDecimal("2.063425")).subtract(new BigDecimal("206.3425")));
    assertThat(bucket(uid, "balance").signum()).isPositive();
    assertLedgerConsistent(uid);
  }

  @Test
  void 剩余持仓的止盈由撮合引擎平掉剩下的全部_强平按剩余手数和保证金() {
    long uid = newUser("1000");
    long id = open(uid, "0.10", 100, "4135.00", null);
    positions.close(uid, id, "0.03");
    quote("XAUUSD", "4135.60", "4136.00"); // 客户 bid 4135.50
    engine.trigger(uid, id, market.quote("XAUUSD").orElseThrow(), System.nanoTime());
    Row rest = row(id);
    assertThat(rest.status()).isEqualTo("CLOSED");
    assertThat(rest.reason()).isEqualTo("TP");
    assertThat(rest.lots()).isEqualByComparingTo("0.07");
    // (4135.50 − 4126.85) × 7 = 60.55
    assertThat(rest.pnl()).isEqualByComparingTo("60.55");
    assertLedgerConsistent(uid);

    // 强平：200 倍，部分平仓后剩下 0.06；跳空到 3999.50，亏损封顶为剩下的保证金 206.3425 × 0.6
    long uid2 = newUser("1000");
    quote("XAUUSD", "4126.35", "4126.75");
    long id2 = open(uid2, "0.10", 200, null, null);
    positions.close(uid2, id2, "0.04");
    assertThat(row(id2).liq()).isEqualByComparingTo("4116.53");
    quote("XAUUSD", "3999.60", "4000.00");
    engine.trigger(uid2, id2, market.quote("XAUUSD").orElseThrow(), System.nanoTime());
    assertThat(row(id2).reason()).isEqualTo("LIQUIDATED");
    assertThat(row(id2).pnl()).isEqualByComparingTo("-123.8055");
    assertThat(notices(uid2)).anyMatch(n -> n.startsWith("LIQUIDATED"));
    assertLedgerConsistent(uid2);
  }

  /** 部分平仓和撮合引擎（止盈或强平）同时处理同一个持仓：先锁账户行再锁持仓行，谁先谁后都对，不会多平或少平 */
  void race(String tp, int lev, String raceBid, String raceAsk, String expectReason) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      for (int round = 0; round < 8; round++) {
        quote("XAUUSD", "4126.35", "4126.75");
        long uid = newUser("2000");
        long id = open(uid, "0.10", lev, tp, null);
        long orderId = row(id).orderId();
        quote("XAUUSD", raceBid, raceAsk);
        MarketQuote q = market.quote("XAUUSD").orElseThrow();
        CountDownLatch go = new CountDownLatch(1);
        Future<String> a = pool.submit(() -> {
          go.await();
          try {
            positions.close(uid, id, "0.04");
            return "partial";
          } catch (BizException e) {
            return e.code();
          }
        });
        Future<?> b = pool.submit(() -> {
          go.await();
          engine.trigger(uid, id, q, System.nanoTime());
          return null;
        });
        go.countDown();
        String partial = a.get();
        b.get();
        assertThat(partial).isIn("partial", "NOT_FOUND");
        List<Row> rows = jdbc.queryForList("SELECT id FROM trading_position WHERE order_id = ?", Long.class, orderId).stream().map(this::row).toList();
        assertThat(rows).as("没有剩下未平的").allMatch(r -> "CLOSED".equals(r.status()));
        assertThat(rows.stream().map(Row::lots).reduce(BigDecimal.ZERO, BigDecimal::add)).as("平掉的合计正好是开仓手数").isEqualByComparingTo("0.10");
        assertThat(rows).hasSize("partial".equals(partial) ? 2 : 1);
        assertThat(row(id).reason()).isEqualTo(expectReason);
        assertThat(row(id).lots()).isEqualByComparingTo("partial".equals(partial) ? "0.06" : "0.10");
        assertLedgerConsistent(uid);
      }
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void 并发_部分平仓的同时触发止盈() throws Exception {
    race("4135.00", 100, "4135.60", "4136.00", "TP");
  }

  @Test
  void 并发_部分平仓的同时触发强平() throws Exception {
    // 200 倍强平价约 4116.53；客户 bid 4110.50
    race(null, 200, "4110.60", "4111.00", "LIQUIDATED");
  }

  @Test
  void 已经平掉的持仓不能再部分平仓() {
    long uid = newUser("1000");
    long id = open(uid, "0.10", 100, null, null);
    positions.close(uid, id);
    assertThatThrownBy(() -> positions.close(uid, id, "0.04")).isInstanceOfSatisfying(BizException.class, e -> assertThat(e.code()).isEqualTo("NOT_FOUND"));
  }

  // ---------- 隔夜费 ----------

  void swapRate(String longRate) {
    jdbc.update("UPDATE market_symbol SET swap_long = ? WHERE code = 'XAUUSD'", new BigDecimal(longRate));
    catalog.reload();
  }

  List<BigDecimal> swapRows(long positionId) {
    return jdbc.queryForList("SELECT amount FROM trading_swap WHERE position_id = ? ORDER BY rollover_date", BigDecimal.class, positionId);
  }

  @Test
  void 隔夜费_拆分前已结算的结算日_拆出来的行不再收_以后按剩余手数结算_累计隔夜费按比例拆() {
    swapRate("-0.0001");
    long uid = newUser("1000");
    long id = open(uid, "0.10", 100, null, null);
    jdbc.update("UPDATE trading_position SET opened_at = '2026-10-14 09:00:00' WHERE id = ?", id);
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    // 0.1 × 100 × 4126.25 × 0.0001
    assertThat(swapRows(id)).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("-4.12625"));
    BigDecimal afterSwap = bucket(uid, "balance");
    // 部分平仓（数据库的真实时间，晚于 2026-10-14 22:00）
    positions.close(uid, id, "0.04");
    Row part = children(id).getFirst();
    assertThat(part.swapTotal()).isEqualByComparingTo("-1.6505");
    assertThat(row(id).swapTotal()).isEqualByComparingTo("-2.47575");
    BigDecimal afterClose = bucket(uid, "balance");
    // 补结算再跑一遍：10-14 原持仓已经按 0.10 手收过，拆出来的行不能再收
    swaps.settleDue(Instant.parse("2026-10-14T23:30:00Z"));
    assertThat(swapRows(part.id())).isEmpty();
    assertThat(swapRows(id)).hasSize(1);
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(afterClose);
    // 下一个结算日：只按剩下的 0.06 手（拆出来的行平仓时间改到 10-15 结算时点之前）
    jdbc.update("UPDATE trading_position SET closed_at = '2026-10-15 01:00:00' WHERE id = ?", part.id());
    swaps.settleDue(Instant.parse("2026-10-15T22:01:00Z"));
    assertThat(swapRows(part.id())).isEmpty();
    assertThat(swapRows(id)).hasSize(2).last().satisfies(a -> assertThat(a).isEqualByComparingTo("-2.47575"));
    assertThat(afterSwap).isNotNull();
    assertLedgerConsistent(uid);
  }

  @Test
  void 隔夜费_结算时点之后_结算任务跑之前部分平仓_两行各按自己的手数收_合计等于拆分前的手数() {
    swapRate("-0.0001");
    long uid = newUser("1000");
    long id = open(uid, "0.10", 100, null, null);
    jdbc.update("UPDATE trading_position SET opened_at = '2026-10-14 09:00:00' WHERE id = ?", id);
    positions.close(uid, id, "0.04");
    Row part = children(id).getFirst();
    BigDecimal before = bucket(uid, "balance");
    BigDecimal restMarginBefore = row(id).margin();
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    // 原持仓 0.06 手从保证金扣 2.47575；拆出来的 0.04 手已平仓，从余额扣 1.6505；合计 = 0.10 手的 4.12625
    assertThat(swapRows(id)).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("-2.47575"));
    assertThat(swapRows(part.id())).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("-1.6505"));
    assertThat(row(id).margin()).isEqualByComparingTo(restMarginBefore.subtract(new BigDecimal("2.47575")));
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(before.subtract(new BigDecimal("4.12625")));
    swaps.settleDue(Instant.parse("2026-10-14T23:30:00Z"));
    assertThat(swapRows(part.id())).hasSize(1);
    assertLedgerConsistent(uid);
  }

  // ---------- 接口 ----------

  @Test
  void 接口_带手数是部分平仓_返回平掉和剩下的手数_历史标出原持仓_不带请求体是全部平仓() throws Exception {
    Cookie c = login();
    mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"clientOrderId\":\"pc-1\"}"));
    String pos = mvc.perform(get("/api/trading/positions").cookie(c)).andReturn().getResponse().getContentAsString();
    String pid = pos.replaceAll("(?s).*?\"id\":\"(\\d+)\".*", "$1");
    quote("XAUUSD", "4136.35", "4136.75");

    var bad = mvc.perform(post("/api/trading/positions/" + pid + "/close").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{\"lots\":\"0.11\"}"))
        .andReturn().getResponse();
    assertThat(bad.getStatus()).isEqualTo(400);
    assertThat(bad.getContentAsString()).contains("\"code\":\"VALIDATION_FAILED\"").contains("\"field\":\"lots\"").contains("\"code\":\"closeLotsMax\"");

    String part = mvc.perform(post("/api/trading/positions/" + pid + "/close").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{\"lots\":\"0.04\"}"))
        .andReturn().getResponse().getContentAsString();
    assertThat(part).contains("\"pnl\":\"37.6\"").contains("\"price\":\"4136.25\"").contains("\"closedLots\":\"0.04\"").contains("\"remainingLots\":\"0.06\"");
    assertThat(mvc.perform(get("/api/trading/positions").cookie(c)).andReturn().getResponse().getContentAsString())
        .contains("\"id\":\"" + pid + "\"").contains("\"lots\":\"0.06\"").contains("\"margin\":\"247.611\"");
    String h = mvc.perform(get("/api/trading/history").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(h).contains("\"total\":1").contains("\"lots\":\"0.04\"").contains("\"parentId\":\"" + pid + "\"").doesNotContain("\"id\":\"P" + pid + "\"");

    String all = mvc.perform(post("/api/trading/positions/" + pid + "/close").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(all).contains("\"closedLots\":\"0.06\"").contains("\"remainingLots\":\"0.00\"").contains("\"pnl\":\"56.4\"");
    String h2 = mvc.perform(get("/api/trading/history").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(h2).contains("\"total\":2").contains("\"id\":\"P" + pid + "\"").contains("\"parentId\":null");
  }
}
