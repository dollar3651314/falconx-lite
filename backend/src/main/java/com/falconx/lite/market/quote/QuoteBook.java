package com.falconx.lite.market.quote;

import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 每个品种的最新报价和今日开高低（按 UTC 日、对客户的卖价算，前端用来显示涨跌）。
 * 只有 FRESH 的报价会更新价格；非 FRESH 只更新状态，使 executable 变为 false。
 */
public class QuoteBook {

  /** 对客户展示的一行（前端 Quote 类型） */
  public record Entry(MarketQuote quote, BigDecimal dayOpen, BigDecimal dayHigh, BigDecimal dayLow, long day) {}

  private final Map<String, Entry> entries = new ConcurrentHashMap<>();

  void put(MarketQuote q) {
    long day = q.time().atZone(ZoneOffset.UTC).toLocalDate().toEpochDay();
    entries.compute(q.symbol(), (k, old) -> {
      if (old == null || old.day() != day) return new Entry(q, q.bid(), q.bid(), q.bid(), day);
      return new Entry(q, old.dayOpen(), old.dayHigh().max(q.bid()), old.dayLow().min(q.bid()), day);
    });
  }

  /** 非 FRESH 报价：保留上一条价格，状态改为不可成交 */
  void markStatus(String symbol, QuoteStatus status) {
    entries.computeIfPresent(symbol, (k, e) -> {
      MarketQuote q = e.quote();
      return new Entry(new MarketQuote(q.symbol(), q.bid(), q.ask(), q.mid(), q.time(), status, false), e.dayOpen(), e.dayHigh(), e.dayLow(), e.day());
    });
  }

  public Optional<Entry> get(String symbol) {
    return Optional.ofNullable(entries.get(symbol));
  }

  public List<Entry> all() {
    return List.copyOf(entries.values());
  }

  /** 报价超过 staleMillis 没有更新也视为不可成交 */
  Optional<MarketQuote> latest(String symbol, Instant now, long staleMillis) {
    Entry e = entries.get(symbol);
    if (e == null) return Optional.empty();
    MarketQuote q = e.quote();
    boolean fresh = q.executable() && now.toEpochMilli() - q.time().toEpochMilli() <= staleMillis;
    return Optional.of(fresh ? q : new MarketQuote(q.symbol(), q.bid(), q.ask(), q.mid(), q.time(), q.executable() ? QuoteStatus.STALE : q.status(), false));
  }
}
