package com.falconx.lite.market.config;

import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolMapper.HolidayRow;
import com.falconx.lite.market.config.SymbolMapper.SessionRow;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 品种、交易时段、休市日的内存快照。启动时加载；后台修改后调用 {@link #reload()}（S16）。
 * 交易时段按 UTC 判断：每周时段 [open, close) 分钟；休市日全天不交易。没有配置任何时段的品种视为休市（不默认开放，和现有系统的"缺配置就放行"相反）。
 */
@Component
public class SymbolCatalog {

  private final SymbolMapper mapper;
  private final Clock clock;
  private volatile Map<String, SymbolSpec> symbols = Map.of();
  private volatile Map<String, List<int[]>[]> sessions = Map.of();
  private volatile Set<String> holidays = Set.of();

  SymbolCatalog(SymbolMapper mapper, Clock clock) {
    this.mapper = mapper;
    this.clock = clock;
    reload();
  }

  public synchronized void reload() {
    Map<String, SymbolSpec> s = new LinkedHashMap<>();
    for (SymbolSpec spec : mapper.enabledSymbols()) s.put(spec.code(), spec);
    Map<String, List<int[]>[]> sess = new HashMap<>();
    for (SessionRow r : mapper.sessions()) {
      @SuppressWarnings("unchecked")
      List<int[]>[] week = sess.computeIfAbsent(r.symbol(), k -> new List[8]);
      if (week[r.dayOfWeek()] == null) week[r.dayOfWeek()] = new ArrayList<>();
      week[r.dayOfWeek()].add(new int[] {r.openMinute(), r.closeMinute()});
    }
    Set<String> h = new HashSet<>();
    // 按注入的时钟取"昨天起"的休市日（以前用数据库的当前日期，和代码里其他地方用的时钟不一致：测试时钟固定时，真实日期一过就读不到测试用的休市日）
    for (HolidayRow r : mapper.holidays(LocalDate.now(clock).minusDays(1))) h.add(r.symbol() + "|" + r.tradeDate());
    symbols = s;
    sessions = sess;
    holidays = h;
  }

  public List<SymbolSpec> all() {
    return List.copyOf(symbols.values());
  }

  public Optional<SymbolSpec> get(String code) {
    return Optional.ofNullable(symbols.get(code));
  }

  /** UTC 日期 d 是不是这个品种的交易日：这一天（星期几）有交易时段，并且不是休市日。隔夜费按交易日结算 */
  public boolean isTradingDay(String code, LocalDate d) {
    if (holidays.contains("*|" + d) || holidays.contains(code + "|" + d)) return false;
    List<int[]>[] week = sessions.get(code);
    return week != null && week[d.getDayOfWeek().getValue()] != null && !week[d.getDayOfWeek().getValue()].isEmpty();
  }

  public boolean isOpen(String code, Instant at) {
    ZonedDateTime t = at.atZone(ZoneOffset.UTC);
    LocalDate d = t.toLocalDate();
    if (holidays.contains("*|" + d) || holidays.contains(code + "|" + d)) return false;
    List<int[]>[] week = sessions.get(code);
    if (week == null) return false;
    List<int[]> today = week[t.getDayOfWeek().getValue()];
    if (today == null) return false;
    int minute = t.getHour() * 60 + t.getMinute();
    for (int[] s : today) if (minute >= s[0] && minute < s[1]) return true;
    return false;
  }
}
