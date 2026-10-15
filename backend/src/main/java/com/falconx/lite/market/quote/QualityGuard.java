package com.falconx.lite.market.quote;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.QuoteStatus;
import java.math.BigDecimal;
import java.math.MathContext;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 报价质量守卫，规则照搬现有系统（功能地图 M-05、M-06），按顺序判断，命中即返回：
 * 价格非正、买卖倒挂、点差率过大 → ABNORMAL；报价时间偏差过大 → STALE；
 * 价格长时间不变 → NO_QUOTE；单次跳变过大、短时波动过大 → ABNORMAL；否则 FRESH。
 * 同一品种的报价由同一个线程按顺序调用（见 {@link QuoteProcessor}）。
 */
class QualityGuard {

  private static final MathContext MC = MathContext.DECIMAL64;

  private record Point(Instant at, BigDecimal mid) {}

  private static final class State {
    BigDecimal bid;
    BigDecimal ask;
    BigDecimal mid;
    Instant changedAt;
    final Deque<Point> window = new ArrayDeque<>();
  }

  private final MarketProperties p;
  private final Map<String, State> states = new ConcurrentHashMap<>();

  QualityGuard(MarketProperties p) {
    this.p = p;
  }

  static BigDecimal mid(BigDecimal bid, BigDecimal ask) {
    return bid.add(ask).divide(BigDecimal.TWO, 8, java.math.RoundingMode.DOWN);
  }

  QuoteStatus evaluate(RawQuote q, Instant now) {
    if (q.bid().signum() <= 0 || q.ask().signum() <= 0) return QuoteStatus.ABNORMAL;
    if (q.bid().compareTo(q.ask()) >= 0) return QuoteStatus.ABNORMAL;
    BigDecimal mid = mid(q.bid(), q.ask());
    if (q.ask().subtract(q.bid()).divide(mid, MC).compareTo(p.maxSpreadRate()) > 0) return QuoteStatus.ABNORMAL;
    if (Math.abs(now.toEpochMilli() - q.time().toEpochMilli()) > p.staleAfter().toMillis()) return QuoteStatus.STALE;

    State s = states.computeIfAbsent(q.symbol(), k -> new State());
    BigDecimal prevMid = s.mid;
    boolean changed = s.bid == null || s.bid.compareTo(q.bid()) != 0 || s.ask.compareTo(q.ask()) != 0;
    if (changed) {
      s.bid = q.bid();
      s.ask = q.ask();
      s.changedAt = now;
    }
    s.mid = mid;
    s.window.addLast(new Point(now, mid));
    Instant from = now.minus(p.volatilityWindow());
    while (!s.window.isEmpty() && s.window.peekFirst().at().isBefore(from)) s.window.removeFirst();

    if (!changed && s.changedAt.plus(p.unchangedMaxAge()).isBefore(now)) return QuoteStatus.NO_QUOTE;
    if (prevMid != null && mid.subtract(prevMid).abs().divide(prevMid, MC).compareTo(p.maxTickJumpRate()) > 0) return QuoteStatus.ABNORMAL;
    if (s.window.size() >= 2) {
      BigDecimal min = s.window.stream().map(Point::mid).min(BigDecimal::compareTo).orElseThrow();
      BigDecimal max = s.window.stream().map(Point::mid).max(BigDecimal::compareTo).orElseThrow();
      if (max.subtract(min).divide(min, MC).compareTo(p.maxVolatilityRate()) > 0) return QuoteStatus.ABNORMAL;
    }
    return QuoteStatus.FRESH;
  }
}
