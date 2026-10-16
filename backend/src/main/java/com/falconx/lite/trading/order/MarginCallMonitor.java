package com.falconx.lite.trading.order;

import com.falconx.lite.common.config.ConfigKey;
import com.falconx.lite.common.config.SystemConfig;
import com.falconx.lite.notification.api.NotifyApi;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.LedgerApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 追保预警（S15a，AC-15，通知方案 N4）。每 10 秒检查有持仓的客户：
 * <ul>
 *   <li>保证金水平 = 净值 ÷ 已用保证金；净值 = 余额 + 各持仓浮动盈亏（和客户端显示的口径一致）。有持仓没有报价时这一轮跳过这个客户。</li>
 *   <li>跌破追保线（默认 100%）通知一次；一直在线下不重复；回到线上以后再跌破才再通知，并且同一客户两次通知至少隔 5 分钟（后台系统配置 {@code notify.marginCallThrottleMinutes} 可改）。</li>
 *   <li>状态存在 {@code trading_margin_call}，服务重启不会重复通知。</li>
 * </ul>
 * 只通知，不平仓：强平按每个持仓的强平价由撮合引擎处理（逐仓）。
 */
@Service
class MarginCallMonitor {

  private static final Logger log = LoggerFactory.getLogger(MarginCallMonitor.class);
  private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

  /** trading_margin_call 的一行 */
  static class State {
    boolean below;
    boolean notified;
    LocalDateTime lastNotifiedAt;
  }

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final Funds funds;
  private final NotifyApi notify;
  private final TransactionTemplate tx;
  private final TradingProperties.MarginCall props;
  private final Clock clock;
  private final SystemConfig config;

  MarginCallMonitor(OrderMapper mapper, LedgerApi ledger, Funds funds, NotifyApi notify, TransactionTemplate tx, TradingProperties props, Clock clock,
      SystemConfig config) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.funds = funds;
    this.notify = notify;
    this.tx = tx;
    this.props = props.marginCall();
    this.clock = clock;
    this.config = config;
  }

  @Scheduled(fixedDelay = 10_000, initialDelay = 20_000)
  void tick() {
    if (!props.enabled()) return;
    try {
      check();
    } catch (RuntimeException e) {
      log.error("追保检查失败", e);
    }
  }

  /** 检查一轮，返回这一轮发出的通知数 */
  int check() {
    LocalDateTime now = LocalDateTime.now(clock);
    int n = 0;
    for (long userId : mapper.usersWithOpenPositions()) {
      try {
        if (checkUser(userId, now)) n++;
      } catch (RuntimeException e) {
        log.warn("追保检查失败 user={}", userId, e);
      }
    }
    // 持仓全部平掉的客户回到"线上"，以后再跌破会重新通知
    mapper.clearMarginCallWithoutPositions(now);
    return n;
  }

  /** 保证金水平（小数，1.00 即 100%）；没有持仓或有持仓没有报价时为空 */
  Optional<BigDecimal> level(long userId) {
    List<PositionRow> positions = mapper.openPositions(userId);
    if (positions.isEmpty()) return Optional.empty();
    AccountSnapshot acc = ledger.snapshot(userId);
    BigDecimal used = BigDecimal.ZERO;
    BigDecimal equity = acc.balance();
    for (PositionRow p : positions) {
      Optional<BigDecimal> pnl = funds.floatingPnl(p);
      if (pnl.isEmpty()) return Optional.empty();
      used = used.add(p.margin);
      equity = equity.add(pnl.get());
    }
    if (used.signum() <= 0) return Optional.empty();
    return Optional.of(equity.divide(used, 6, RoundingMode.DOWN));
  }

  private boolean checkUser(long userId, LocalDateTime now) {
    Optional<BigDecimal> level = level(userId);
    if (level.isEmpty()) return false;
    State s = mapper.marginCallState(userId);
    BigDecimal lineLevel = line();
    boolean below = level.get().compareTo(lineLevel) < 0;
    if (!below) {
      if (s != null && s.below) mapper.saveMarginCallState(userId, false, false, s.lastNotifiedAt, now);
      return false;
    }
    if (s != null && s.below && s.notified) return false;
    LocalDateTime last = s == null ? null : s.lastNotifiedAt;
    if (last != null && last.plus(config.minutes(ConfigKey.NOTIFY_MARGIN_CALL_THROTTLE_MINUTES, props.minInterval())).isAfter(now)) {
      // 刚通知过：先记下"在线下、还没通知"，满 5 分钟后还在线下再通知
      if (s == null || !s.below) mapper.saveMarginCallState(userId, true, false, last, now);
      return false;
    }
    String pct = level.get().multiply(HUNDRED).setScale(2, RoundingMode.DOWN).toPlainString();
    String line = lineLevel.multiply(HUNDRED).stripTrailingZeros().toPlainString();
    tx.executeWithoutResult(st -> {
      mapper.saveMarginCallState(userId, true, true, now, now);
      notify.toUser(userId, "MARGIN_CALL", Map.of("level", pct, "line", line));
    });
    log.info("追保预警 user={} 保证金水平 {}%", userId, pct);
    return true;
  }

  /** 追保线（小数）：交易参数页改的值优先（S16c，百分数），没有时用 application.yml */
  BigDecimal line() {
    BigDecimal pct = config.decimal(ConfigKey.TRADING_MARGIN_CALL_LEVEL, null);
    return pct == null ? props.line() : pct.divide(HUNDRED, 6, RoundingMode.HALF_UP);
  }
}
