package com.falconx.lite.admin.ops;

import com.falconx.lite.admin.security.Audit;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.MarketAdminApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.trading.api.TradingAdminApi;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * 后台"品种与行情"（S16c）：品种（改参数、启用停用）、交易时段（只读）、休市日（增删）、汇率（只读）。
 * 和原型的不同见后台方案第 9 节：交易时段按品种配置（原型是时段模板），休市日是全天休市（原型还有提前收市）。
 */
@Service
class MarketOps {

  /** 品种（原型 TradingSymbol 的字段按后端实际调整，见后台方案第 9 节） */
  /**
   * 品种。v2 E6：lastQuoteAt 最后一条正常报价的时间（从没收到过为空，页面显示"暂无报价"）、tradingOpen 现在是否在交易时段内
   * （休市时没有报价是正常的，页面不标红）。simStartPrice：模拟起始价（只在模拟报价源下使用），没填为空。
   * quoteSource / quoteSourceState：当前报价源（alltick / itick / simulated，没有报价源为空）和状态（primary / backup / deviation，模拟为空），
   * 见 技术方案/v2-报价源接入.md 第 5.5 节。
   */
  record SymbolView(String code, String nameZh, String nameEn, String category, String quoteCurrency, String contractSize, String minLots, String maxLots,
      String lotStep, int maxLeverage, String maintenanceMarginRate, String openFeeRate, String swapLong, String swapShort, String markup, int digits, boolean hot,
      boolean enabled, boolean openPaused, int sortOrder, String updatedAt, String lastQuoteAt, boolean tradingOpen, String simStartPrice, String quoteSource,
      String quoteSourceState) {}

  /** 品种列表：分页字段同 {@link Ops.Page}，多一个 simulatedQuotes（当前报价源是不是模拟源，是的话页面显示"模拟起始价"输入框） */
  record SymbolPage(List<SymbolView> items, long total, int page, int pageSize, boolean simulatedQuotes) {}

  /**
   * openPaused：品种自己的"暂停开仓"（新增的品种默认暂停，运营确认报价正常后在这里打开）。
   * simStartPrice：给已建好的品种补模拟起始价（只在模拟报价源下生效，否则忽略；空字符串和不传一样，表示不改）。
   */
  record SymbolPatchBody(String nameZh, String nameEn, Integer maxLeverage, String minLots, String maxLots, String lotStep, String openFeeRate,
      String maintenanceMarginRate, String markup, String swapLong, String swapShort, Boolean hot, Integer sortOrder, Boolean openPaused, String simStartPrice,
      String reason) {}

  /**
   * 新增品种（v2 E3）。数值都用字符串（不经过浮点）；交易时段二选一：copySessionsFrom（已有品种代码）或 sessionTemplate（fx / crypto / us_stock）。
   * simStartPrice：模拟起始价（可选，正数，小数位不超过 digits），只在模拟报价源下生效，否则忽略。
   */
  record SymbolCreateBody(String code, String nameZh, String nameEn, String category, Integer digits, String contractSize, String quoteCurrency,
      Integer maxLeverage, String maintenanceMarginRate, String openFeeRate, String minLots, String maxLots, String lotStep, String markup, Boolean hot,
      String copySessionsFrom, String sessionTemplate, String simStartPrice, String reason) {}

  record Range(int day, String open, String close) {}

  /** 一个品种一周的交易时段（UTC）；day 1=周一 … 7=周日 */
  record SessionView(String symbol, List<Range> ranges) {}

  record HolidayView(String id, String date, String symbol, String reason) {}

  record FxView(String currency, String pair, String rate, String source, String updatedAt, Long ageSeconds, String status, List<String> affectedSymbols) {}

  private final MarketAdminApi market;
  private final TradingAdminApi trading;
  private final Audit audit;
  private final Clock clock;

  MarketOps(MarketAdminApi market, TradingAdminApi trading, Audit audit, Clock clock) {
    this.market = market;
    this.trading = trading;
    this.audit = audit;
    this.clock = clock;
  }

  static SymbolView view(MarketAdminApi.Symbol s) {
    SymbolSpec x = s.spec();
    return new SymbolView(x.code(), x.nameZh(), x.nameEn(), x.category(), x.quoteCcy(), Ops.money(x.contractSize()), Ops.money(x.minLots()),
        Ops.money(x.maxLots()), Ops.money(x.lotStep()), x.maxLeverage(), Ops.money(x.maintenanceMarginRate()), Ops.money(x.feeRate()), Ops.money(x.swapLong()),
        Ops.money(x.swapShort()), Ops.money(x.markup()), x.digits(), x.hot(), s.enabled(), x.openPaused(), x.sortOrder(), Ops.time(s.updatedAt()),
        s.lastQuoteAt() == null ? null : s.lastQuoteAt().toString(), s.tradingOpen(), Ops.money(s.simStartPrice()),
        s.quoteSource() == null ? null : s.quoteSource().feed(), s.quoteSource() == null ? null : s.quoteSource().state());
  }

  /** missingSwap：多空隔夜费率都是 0（没配置，不收隔夜费，后台标红） */
  SymbolPage symbols(String category, String keyword, Boolean enabled, Boolean missingSwap, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    String kw = Ops.blank(keyword) == null ? null : keyword.strip().toLowerCase(Locale.ROOT);
    List<MarketAdminApi.Symbol> all = market.symbols().stream()
        .filter(x -> Ops.blank(category) == null || x.spec().category().equals(category.strip()))
        .filter(x -> kw == null || x.spec().code().toLowerCase(Locale.ROOT).contains(kw) || x.spec().nameZh().toLowerCase(Locale.ROOT).contains(kw)
            || x.spec().nameEn().toLowerCase(Locale.ROOT).contains(kw))
        .filter(x -> enabled == null || x.enabled() == enabled)
        .filter(x -> missingSwap == null || !missingSwap || (x.spec().swapLong().signum() == 0 && x.spec().swapShort().signum() == 0))
        .toList();
    List<SymbolView> items = all.stream().skip(s.offset()).limit(s.size()).map(MarketOps::view).toList();
    return new SymbolPage(items, all.size(), s.page(), s.size(), market.simulatedQuotes());
  }

  private static BigDecimal dec(String field, String v) {
    if (v == null) return null;
    try {
      return new BigDecimal(v.strip());
    } catch (NumberFormatException e) {
      throw new ValidationException(List.of(new ValidationException.Field(field, "invalid")));
    }
  }

  private SymbolView current(String code) {
    return market.symbols().stream().filter(x -> x.spec().code().equals(code)).findFirst().map(MarketOps::view)
        .orElseThrow(() -> new BizException("NOT_FOUND", "品种不存在"));
  }

  /** 改品种参数（高危）：只影响以后开的仓，已有持仓的强平价不变 */
  SymbolView updateSymbol(String code, SymbolPatchBody b) {
    SymbolPatchBody body = b == null ? new SymbolPatchBody(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null) : b;
    String r = Audit.requireReason(body.reason());
    MarketAdminApi.SymbolPatch patch = new MarketAdminApi.SymbolPatch(body.nameZh(), body.nameEn(), body.maxLeverage(), dec("minLots", body.minLots()),
        dec("maxLots", body.maxLots()), dec("lotStep", body.lotStep()), dec("openFeeRate", body.openFeeRate()),
        dec("maintenanceMarginRate", body.maintenanceMarginRate()), dec("markup", body.markup()), dec("swapLong", body.swapLong()),
        dec("swapShort", body.swapShort()), body.hot(), body.sortOrder(), body.openPaused(), num(body.simStartPrice()));
    return audit.run("symbol.update", code, true, r, () -> {
      SymbolView before = view(market.updateSymbol(code, patch));
      SymbolView after = current(code);
      return Audit.Change.of(after, diff(before, after, true), diff(before, after, false));
    });
  }

  /** 不是配置的字段（随时间变化），审计不记 */
  private static final java.util.Set<String> IGNORED_IN_DIFF = java.util.Set.of("updatedAt", "lastQuoteAt", "tradingOpen", "quoteSource", "quoteSourceState");

  /**
   * 新增品种（v2 E3，高危，必须填原因）：默认暂停开仓；审计记新品种的全部参数（含模拟起始价，没用上时为空）和交易时段来源。
   * 数值格式不对的字段和其他字段错误一起返回。
   */
  SymbolView createSymbol(SymbolCreateBody b) {
    SymbolCreateBody body = b == null
        ? new SymbolCreateBody(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null) : b;
    String r = Audit.requireReason(body.reason());
    MarketAdminApi.SymbolCreate create = new MarketAdminApi.SymbolCreate(body.code() == null ? null : body.code().strip().toUpperCase(Locale.ROOT),
        body.nameZh(), body.nameEn(), body.category(), body.digits(), num(body.contractSize()), body.quoteCurrency(), body.maxLeverage(),
        num(body.maintenanceMarginRate()), num(body.openFeeRate()), num(body.minLots()),
        num(body.maxLots()), num(body.lotStep()), num(body.markup()), body.hot(), body.copySessionsFrom(),
        body.sessionTemplate(), num(body.simStartPrice()));
    String target = create.code() == null ? "" : create.code();
    return audit.run("symbol.create", target, true, r, () -> {
      // 行情模块的事务已经提交、内存里的品种已经重新加载，再取一次（交易时段状态按新品种算）
      SymbolView v = current(market.createSymbol(create).spec().code());
      Map<String, Object> after = new LinkedHashMap<>();
      for (var c : SymbolView.class.getRecordComponents()) {
        if (IGNORED_IN_DIFF.contains(c.getName())) continue;
        try {
          after.put(c.getName(), c.getAccessor().invoke(v));
        } catch (ReflectiveOperationException e) {
          throw new IllegalStateException(e);
        }
      }
      after.put("sessions", create.copySessionsFrom() != null && !create.copySessionsFrom().isBlank() ? "copy:" + create.copySessionsFrom().strip()
          : "template:" + create.sessionTemplate());
      return Audit.Change.of(v, null, after);
    });
  }

  /** 不是数字时传给行情模块的值：所有数值字段都不接受负数，行情模块会把它和其他字段错误一起报成 invalid */
  private static final BigDecimal NOT_A_NUMBER = BigDecimal.ONE.negate();

  /** 数值字段：空表示没填（由行情模块报 required），格式不对报 invalid */
  private static BigDecimal num(String v) {
    if (v == null || v.isBlank()) return null;
    try {
      return new BigDecimal(v.strip());
    } catch (NumberFormatException e) {
      return NOT_A_NUMBER;
    }
  }

  /** 只记改了的字段 */
  private static Map<String, Object> diff(SymbolView a, SymbolView b, boolean before) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (var c : SymbolView.class.getRecordComponents()) {
      try {
        Object x = c.getAccessor().invoke(a);
        Object y = c.getAccessor().invoke(b);
        if (!java.util.Objects.equals(x, y) && !IGNORED_IN_DIFF.contains(c.getName())) out.put(c.getName(), before ? x : y);
      } catch (ReflectiveOperationException e) {
        throw new IllegalStateException(e);
      }
    }
    return out;
  }

  /** 启用 / 停用（高危）。还有持仓或挂单的品种不能停用（停用后这些持仓没法报价和平仓） */
  SymbolView setEnabled(String code, boolean enabled, String reason) {
    String r = Audit.requireReason(reason);
    return audit.run(enabled ? "symbol.enable" : "symbol.disable", code, true, r, () -> {
      if (!enabled && trading.openUsage(code) > 0) throw new BizException("SYMBOL_IN_USE", "品种还有持仓或挂单，不能停用");
      MarketAdminApi.Symbol before = market.setEnabled(code, enabled);
      return Audit.Change.of(current(code), Map.of("enabled", before.enabled()), Map.of("enabled", enabled));
    });
  }

  List<SessionView> sessions() {
    Map<String, List<Range>> by = new LinkedHashMap<>();
    for (MarketAdminApi.Session s : market.sessions()) {
      by.computeIfAbsent(s.symbol(), k -> new ArrayList<>()).add(new Range(s.dayOfWeek(), hhmm(s.openMinute()), hhmm(s.closeMinute())));
    }
    return by.entrySet().stream().map(e -> new SessionView(e.getKey(), e.getValue())).toList();
  }

  static String hhmm(int minutes) {
    return String.format("%02d:%02d", minutes / 60, minutes % 60);
  }

  /** 今天（UTC）起的休市日 */
  List<HolidayView> holidays() {
    return market.holidays(LocalDate.now(clock)).stream().map(MarketOps::holiday).toList();
  }

  private static HolidayView holiday(MarketAdminApi.Holiday h) {
    return new HolidayView(String.valueOf(h.id()), h.date().toString(), h.symbol(), h.reason());
  }

  HolidayView addHoliday(String symbol, String date, String reason) {
    LocalDate d;
    try {
      d = date == null ? null : LocalDate.parse(date.strip());
    } catch (DateTimeParseException e) {
      throw new ValidationException(List.of(new ValidationException.Field("date", "invalid")));
    }
    if (d != null && d.isBefore(LocalDate.now(clock))) throw new ValidationException(List.of(new ValidationException.Field("date", "past")));
    LocalDate day = d;
    return audit.run("holiday.add", symbol + " " + date, false, Ops.blank(reason), () -> {
      HolidayView h = holiday(market.addHoliday(symbol == null ? null : symbol.strip().toUpperCase(), day, Ops.blank(reason)));
      return Audit.Change.of(h, null, Map.of("symbol", h.symbol(), "date", h.date()));
    });
  }

  void deleteHoliday(long id) {
    audit.run("holiday.delete", String.valueOf(id), false, null, () -> {
      HolidayView h = holiday(market.deleteHoliday(id));
      return Audit.Change.of(null, Map.of("symbol", h.symbol(), "date", h.date()), null);
    });
  }

  List<FxView> fx() {
    java.time.Instant now = clock.instant();
    return market.fxRates().stream().map(f -> new FxView(f.currency(), "fixed".equals(f.source()) ? f.currency() + "USD" : f.source(), Ops.money(f.rate()),
        f.source(), f.updatedAt() == null ? null : f.updatedAt().toString(), f.updatedAt() == null ? null : Duration.between(f.updatedAt(), now).toSeconds(),
        f.stale() ? "stale" : "ok", f.symbols())).toList();
  }
}
