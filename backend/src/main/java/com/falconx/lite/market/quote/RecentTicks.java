package com.falconx.lite.market.quote;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 每个品种最近 {@link #CAPACITY} 笔对客户的报价（客户端 Tick 图用，需求说明书 4.2-5、v2 E5）。
 * <p>只在内存里保留，重启就清空，不写数据库（对照表 M-09 去掉了 Tick 历史存储）。50 个品种 × 500 笔，占用很小。
 * 只记录 FRESH 的报价（和 K 线同一个时点写入）；同一品种的写入都在该品种的处理线程上，读取来自 HTTP 线程，按品种加锁。
 */
public class RecentTicks {

  /** 每个品种保留的笔数 */
  public static final int CAPACITY = 500;

  /** 一笔报价：bid、ask 已含加点 */
  public record Tick(Instant time, BigDecimal bid, BigDecimal ask) {}

  private final Map<String, ArrayDeque<Tick>> bySymbol = new ConcurrentHashMap<>();

  void add(String symbol, Tick t) {
    ArrayDeque<Tick> q = bySymbol.computeIfAbsent(symbol, k -> new ArrayDeque<>(CAPACITY));
    synchronized (q) {
      if (q.size() >= CAPACITY) q.pollFirst();
      q.addLast(t);
    }
  }

  /** 最近 limit 笔，按时间从旧到新；limit 限制在 1～{@link #CAPACITY} */
  public List<Tick> recent(String symbol, int limit) {
    ArrayDeque<Tick> q = bySymbol.get(symbol);
    if (q == null) return List.of();
    int n = Math.max(1, Math.min(limit, CAPACITY));
    List<Tick> out = new ArrayList<>(n);
    synchronized (q) {
      int skip = Math.max(0, q.size() - n);
      Iterator<Tick> it = q.iterator();
      while (it.hasNext()) {
        Tick t = it.next();
        if (skip > 0) {
          skip--;
          continue;
        }
        out.add(t);
      }
    }
    return out;
  }
}
