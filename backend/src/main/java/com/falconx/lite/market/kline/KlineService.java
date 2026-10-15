package com.falconx.lite.market.kline;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import org.springframework.stereotype.Service;

/**
 * K 线聚合（规则沿用现有系统，功能地图 M-10）：用基准中间价（不含加点），6 个周期；
 * 报价落到更晚的桶时上一根收盘并写库；没有报价的周期不补空 K 线；比当前桶早的乱序报价丢弃。
 * 未收盘的 K 线只在内存里，应用重启会丢失当前这一根（单实例的已知取舍）。
 */
@Service
public class KlineService {

  private final KlineMapper mapper;
  private final Map<String, Bar> current = new ConcurrentHashMap<>();
  private volatile Consumer<Bar> onUpdate = b -> {};

  KlineService(KlineMapper mapper) {
    this.mapper = mapper;
  }

  /** 推送用：每次有 K 线变化（含新开和更新）时回调 */
  public void onUpdate(Consumer<Bar> listener) {
    this.onUpdate = listener;
  }

  /** 由行情处理线程按品种顺序调用 */
  public void accept(String symbol, BigDecimal mid, Instant at) {
    long sec = at.getEpochSecond();
    for (Timeframe tf : Timeframe.values()) {
      long start = tf.bucket(sec);
      String key = symbol + "|" + tf.code;
      Bar bar = current.get(key);
      Bar next;
      if (bar == null || start > bar.time()) {
        if (bar != null) mapper.upsert(bar);
        next = new Bar(symbol, tf, start, mid, mid, mid, mid, 1);
      } else if (start == bar.time()) {
        next = bar.with(mid);
      } else {
        continue; // 乱序报价丢弃
      }
      current.put(key, next);
      onUpdate.accept(next);
    }
  }

  /** 最近 limit 根 K 线（含当前未收盘的一根），按时间从旧到新 */
  public List<Bar> history(String symbol, Timeframe tf, int limit) {
    List<Bar> bars = new ArrayList<>(mapper.recent(symbol, tf.code, limit));
    Bar cur = current.get(symbol + "|" + tf.code);
    if (cur != null) {
      bars.removeIf(b -> b.time() == cur.time());
      bars.add(0, cur);
      if (bars.size() > limit) bars = bars.subList(0, limit);
    }
    Collections.reverse(bars);
    return bars;
  }
}
