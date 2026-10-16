package com.falconx.lite.trading.order;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.notification.api.NotifyApi;
import com.falconx.lite.risk.api.RiskApi;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.annotation.PreDestroy;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 撮合引擎（S9）：行情驱动的挂单成交、止盈止损、强平。
 * <ol>
 *   <li>收到可成交的报价只记下"这个品种有新价格"，不占用行情处理线程。</li>
 *   <li>每个品种同一时间只有一次检查在跑；检查期间来的新报价合并，检查完用最新价格再查一次（不排长队）。</li>
 *   <li>检查用数据库查询找出被触发的挂单和持仓，交给执行线程并行处理；每一条在自己的事务里：锁账户行 → 锁订单或持仓行 → 用这次的价格再确认一次 → 执行。
 *       同一条不会被处理两次（状态在锁内检查），和客户自己的平仓、撤单也不会冲突。</li>
 * </ol>
 * 规则见 技术方案/v1-数据库设计.md 第 11 节。
 */
@Component
class MatchingEngine {

  private static final Logger log = LoggerFactory.getLogger(MatchingEngine.class);

  /**
   * 收到的一个报价和收到它的时间（System.nanoTime）。两者放在同一个不可变对象里一起替换，
   * 检查时拿到哪个报价，用的就是那个报价的收到时间（AC-13 计时口径）。
   * 以前把收到时间单独存成一个字段，检查读完报价、还没读时间时又来了新价格，会读到新价格的时间，耗时被少算。
   */
  record Received(MarketQuote quote, long nanos) {}

  /** 每个品种的状态：最新报价（连同收到时间）、是否已经排了检查 */
  private static final class SymbolState {
    final AtomicReference<Received> latest = new AtomicReference<>();
    final AtomicBoolean scheduled = new AtomicBoolean();
  }

  private final OrderMapper mapper;
  private final PositionService positions;
  private final Funds funds;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final RiskApi risk;
  private final TransactionTemplate tx;
  private final TradingEvents events;
  private final NotifyApi notify;
  private final Map<String, SymbolState> states = new ConcurrentHashMap<>();
  private final AtomicInteger threadNo = new AtomicInteger();
  private final ExecutorService pool;
  private final ExecutorService workers;
  private final AtomicBoolean enabled;
  private final MeterRegistry metrics;
  private final Map<String, Timer> timers = new ConcurrentHashMap<>();

  MatchingEngine(OrderMapper mapper, PositionService positions, Funds funds, LedgerApi ledger, MarketApi market, RiskApi risk,
      TransactionTemplate tx, TradingEvents events, NotifyApi notify, TradingProperties props) {
    this(mapper, positions, funds, ledger, market, risk, tx, events, notify, props, new SimpleMeterRegistry());
  }

  @Autowired
  MatchingEngine(OrderMapper mapper, PositionService positions, Funds funds, LedgerApi ledger, MarketApi market, RiskApi risk,
      TransactionTemplate tx, TradingEvents events, NotifyApi notify, TradingProperties props, MeterRegistry metrics) {
    this.metrics = metrics;
    this.mapper = mapper;
    this.positions = positions;
    this.funds = funds;
    this.ledger = ledger;
    this.market = market;
    this.risk = risk;
    this.tx = tx;
    this.events = events;
    this.notify = notify;
    this.enabled = new AtomicBoolean(props.engineEnabled());
    this.pool = Executors.newFixedThreadPool(props.engineThreads(), r -> new Thread(r, "match-" + threadNo.incrementAndGet()));
    this.workers = Executors.newFixedThreadPool(props.engineWorkers(), r -> new Thread(r, "match-exec-" + threadNo.incrementAndGet()));
  }

  @EventListener(ApplicationReadyEvent.class)
  void start() {
    market.subscribe(this::onQuote);
    log.info("撮合引擎已订阅行情（启用：{}）", enabled.get());
  }

  /** 测试用：开关引擎。正式环境由 falconx.trading.engine-enabled 决定 */
  void setEnabled(boolean on) {
    enabled.set(on);
  }

  void onQuote(MarketQuote q) {
    onQuote(q, System.nanoTime());
  }

  /** 收到报价；receivedNanos 是收到它的时间（测试里可以指定） */
  void onQuote(MarketQuote q, long receivedNanos) {
    if (!enabled.get() || !q.executable()) return;
    SymbolState st = states.computeIfAbsent(q.symbol(), k -> new SymbolState());
    st.latest.set(new Received(q, receivedNanos));
    if (st.scheduled.compareAndSet(false, true)) pool.execute(() -> run(q.symbol(), st));
  }

  private void run(String symbol, SymbolState st) {
    Received done = null;
    try {
      // 检查期间来了新价格就再查一次；没有新价格就结束。先记下 done 再检查，检查出错也不会对同一个价格反复重试
      while (true) {
        Received r = st.latest.get();
        if (r == done) break;
        done = r;
        scan(r.quote(), r.nanos());
      }
    } catch (RuntimeException e) {
      log.error("撮合检查失败 {}", symbol, e);
    } finally {
      st.scheduled.set(false);
      // 释放标记前后刚好进来的新价格：补排一次
      if (st.latest.get() != done && enabled.get() && st.scheduled.compareAndSet(false, true)) {
        pool.execute(() -> run(symbol, st));
      }
    }
  }

  /**
   * 一次检查：先挂单，再持仓（同一个价格下新成交的持仓也会被检查到止盈止损）。
   * 被触发的每一条交给执行线程并行处理（不同用户互不影响，同一用户在账户行锁上排队），全部完成后这次检查才结束。
   */
  void scan(MarketQuote q, long receivedNanos) {
    List<CompletableFuture<Void>> fs = new ArrayList<>();
    for (OrderRow o : mapper.triggeredOrders(q.symbol(), q.bid(), q.ask())) {
      fs.add(CompletableFuture.runAsync(() -> safely(() -> fill(o.userId, o.id, q, receivedNanos), "挂单成交", o.id), workers));
    }
    CompletableFuture.allOf(fs.toArray(CompletableFuture[]::new)).join();
    fs.clear();
    for (PositionRow p : mapper.triggeredPositions(q.symbol(), q.bid(), q.ask())) {
      fs.add(CompletableFuture.runAsync(() -> safely(() -> trigger(p.userId, p.id, q, receivedNanos), "止盈止损强平", p.id), workers));
    }
    CompletableFuture.allOf(fs.toArray(CompletableFuture[]::new)).join();
  }

  private void safely(Runnable r, String what, long id) {
    try {
      r.run();
    } catch (RuntimeException e) {
      log.error("{}失败 id={}", what, id, e);
    }
  }

  /**
   * 挂单成交：买单在 ask ≤ 限价时、卖单在 bid ≥ 限价时成交，成交价取限价和市价里对客户更好的那个。
   * 品种暂停或全局暂停时不成交（继续挂着）；汇率失效时等下一次报价。
   * 先释放冻结，再按成交价开仓；可用余额不够（例如期间别的持仓亏损）时撤销这张挂单。
   */
  void fill(long userId, long orderId, MarketQuote q, long receivedNanos) {
    record Outcome(String kind, String symbol, String price) {}
    Outcome out = tx.execute(st -> {
      AccountSnapshot acc = ledger.lock(userId);
      OrderRow o = mapper.lockPending(userId, orderId);
      if (o == null) return null;
      Side side = Side.valueOf(o.side);
      boolean hit = side == Side.BUY ? q.ask().compareTo(o.limitPrice) <= 0 : q.bid().compareTo(o.limitPrice) >= 0;
      if (!hit) return null;
      Optional<SymbolSpec> spec = market.symbol(o.symbol);
      if (spec.isEmpty() || spec.get().openPaused() || risk.symbolOpenPaused(o.symbol) || risk.globalOpenPaused()) return null;
      Optional<BigDecimal> rate = market.liveUsdRate(spec.get().quoteCcy());
      if (rate.isEmpty()) return null;
      BigDecimal price = side == Side.BUY ? q.ask().min(o.limitPrice) : q.bid().max(o.limitPrice);

      ledger.apply(new LedgerCommand(userId, Bucket.ORDER_FROZEN, o.frozenAmount.negate(), LedgerEntryType.ORDER_UNFREEZE, OrderService.BIZ_ORDER,
          String.valueOf(o.id), "挂单成交解冻 " + o.symbol));
      AccountSnapshot after = new AccountSnapshot(acc.userId(), acc.balance(), acc.withdrawFrozen(), acc.orderFrozen().subtract(o.frozenAmount));
      BigDecimal notional = OrderCalc.notionalUsd(price, o.lots, spec.get().contractSize(), rate.get());
      BigDecimal need = OrderCalc.margin(notional, o.leverage).add(OrderCalc.fee(notional, spec.get().feeRate()));
      if (need.compareTo(funds.available(after, mapper.openPositions(userId))) > 0) {
        mapper.markCancelled(o.id);
        log.warn("挂单成交时可用余额不足，已撤销 order={} user={}", o.id, userId);
        return new Outcome("cancelled", o.symbol, null);
      }
      positions.openLocked(o, spec.get(), price, rate.get());
      String filled = price.setScale(spec.get().digits()).toPlainString();
      // 挂单成交通知（X-04），和成交同一事务
      notify.toUser(userId, "ORDER_FILLED", Map.of("symbol", o.symbol, "side", o.side, "lots", o.lots.stripTrailingZeros().toPlainString(), "price", filled));
      return new Outcome("fill", o.symbol, filled);
    });
    if (out == null) return;
    logLatency("挂单成交", orderId, receivedNanos);
    events.changed(userId, "orders", "positions", "account");
    if ("fill".equals(out.kind())) events.trade(userId, "fill", out.symbol(), null, out.price());
  }

  /**
   * 持仓触发：强平优先（风控的自动强平开关打开时），其次止损、止盈。都按当前市价平仓（多单 bid、空单 ask）；
   * 价格跳空越过强平价时亏损封顶为保证金，余额不会变负（AC-14）。
   */
  void trigger(long userId, long positionId, MarketQuote q, long receivedNanos) {
    record Outcome(PositionService.CloseReason reason, String symbol, PositionService.Closed closed, int digits) {}
    Outcome out = tx.execute(st -> {
      ledger.lock(userId);
      PositionRow p = mapper.lockOpenPosition(userId, positionId);
      if (p == null) return null;
      Side side = Side.valueOf(p.side);
      BigDecimal px = side.closePrice(q);
      boolean buy = side == Side.BUY;
      PositionService.CloseReason reason = null;
      boolean liqHit = buy ? px.compareTo(p.liquidationPrice) <= 0 : px.compareTo(p.liquidationPrice) >= 0;
      // 风控关闭自动强平时，触及强平价也不平（止盈止损照常）
      if (liqHit && risk.autoLiquidationEnabled()) reason = PositionService.CloseReason.LIQUIDATED;
      else if (p.stopLoss != null && (buy ? px.compareTo(p.stopLoss) <= 0 : px.compareTo(p.stopLoss) >= 0)) reason = PositionService.CloseReason.SL;
      else if (p.takeProfit != null && (buy ? px.compareTo(p.takeProfit) >= 0 : px.compareTo(p.takeProfit) <= 0)) reason = PositionService.CloseReason.TP;
      if (reason == null) return null;
      int digits = market.symbol(p.symbol).map(SymbolSpec::digits).orElse(8);
      PositionService.Closed closed = positions.closeLocked(p, px, reason);
      // 止盈止损、强平通知（X-04），和平仓同一事务
      String price = closed.price().setScale(digits, java.math.RoundingMode.HALF_UP).toPlainString();
      String pnl = TradingController.money(closed.pnl());
      if (reason == PositionService.CloseReason.LIQUIDATED) {
        notify.toUser(userId, "LIQUIDATED", Map.of("symbol", p.symbol, "price", price, "pnl", pnl));
      } else {
        notify.toUser(userId, "TP_SL_TRIGGERED", Map.of("symbol", p.symbol, "trigger", reason.name(), "price", price, "pnl", pnl));
      }
      return new Outcome(reason, p.symbol, closed, digits);
    });
    if (out == null) return;
    logLatency(out.reason().name(), positionId, receivedNanos);
    events.changed(userId, "positions", "account");
    String kind = switch (out.reason()) {
      case LIQUIDATED -> "liquidation";
      case TP -> "tp";
      case SL -> "sl";
      case CLOSED -> "closed";
    };
    events.trade(userId, kind, out.symbol(), TradingController.money(out.closed().pnl()), out.closed().price().setScale(out.digits(), java.math.RoundingMode.HALF_UP).toPlainString());
  }

  /** AC-13：从收到触发价格到写入成交记录，超过 1 秒记警告（压测按日志统计，日志格式不要改）；同时记进指标 fx_matching_latency_seconds（E10） */
  private void logLatency(String what, long id, long receivedNanos) {
    long nanos = System.nanoTime() - receivedNanos;
    latency(what).record(nanos, java.util.concurrent.TimeUnit.NANOSECONDS);
    long ms = nanos / 1_000_000;
    if (ms > 1000) log.warn("撮合耗时超过 1 秒：{} id={} 耗时 {}ms", what, id, ms);
    else log.info("撮合完成：{} id={} 耗时 {}ms", what, id, ms);
  }

  /** 撮合耗时直方图（按类型：挂单成交、TP、SL、LIQUIDATED），分桶到 5 秒 */
  private Timer latency(String what) {
    return timers.computeIfAbsent(what, k -> Timer.builder("fx.matching.latency").description("从收到触发价格到成交记录所在事务提交的耗时（AC-13）")
        .tag("type", k).publishPercentileHistogram().minimumExpectedValue(Duration.ofMillis(1)).maximumExpectedValue(Duration.ofSeconds(5)).register(metrics));
  }

  @PreDestroy
  void stop() {
    pool.shutdownNow();
    workers.shutdownNow();
  }

  /** 引擎是否在跑（健康检查和测试用） */
  boolean isEnabled() {
    return enabled.get();
  }
}
