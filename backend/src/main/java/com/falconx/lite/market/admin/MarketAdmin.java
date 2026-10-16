package com.falconx.lite.market.admin;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.MarketAdminApi;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * {@link MarketAdminApi} 的实现。改动在事务提交后重新加载 {@link SymbolCatalog}。
 * 品种的维持保证金率、手续费率改了只影响以后开的仓，已有持仓用开仓时记下的值（强平价不变）。
 * 新增品种（v2 E3）同样只写表、提交后重新加载：行情入口 {@link QuoteProcessor}、撮合、风控敞口、K 线都按 {@link SymbolCatalog} 认品种，不需要重启。
 */
@Service
class MarketAdmin implements MarketAdminApi {

  private final MarketAdminMapper mapper;
  private final SymbolCatalog catalog;
  private final QuoteProcessor processor;
  private final MarketApi market;
  private final MarketProperties props;
  private final Clock clock;

  MarketAdmin(MarketAdminMapper mapper, SymbolCatalog catalog, QuoteProcessor processor, MarketApi market, MarketProperties props, Clock clock) {
    this.mapper = mapper;
    this.catalog = catalog;
    this.processor = processor;
    this.market = market;
    this.props = props;
    this.clock = clock;
  }

  /** 最后报价时间取行情内存里最后一条正常报价的时间（v2 E6） */
  private Symbol symbol(MarketAdminMapper.SymbolRow r) {
    Instant last = processor.book().get(r.code).map(e -> e.quote().time()).orElse(null);
    return new Symbol(new SymbolSpec(r.code, r.nameZh, r.nameEn, r.category, r.digits, r.contractSize, r.unit, r.baseCcy, r.quoteCcy, r.maxLeverage,
        r.minLots, r.maxLots, r.lotStep, r.feeRate, r.maintenanceMarginRate, r.markup, r.swapLong, r.swapShort, r.hot, r.openPaused, r.sortOrder),
        r.enabled, r.updatedAt, last, r.enabled && catalog.isOpen(r.code, clock.instant()));
  }

  private void reloadAfterCommit() {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
          catalog.reload();
        }
      });
    } else {
      catalog.reload();
    }
  }

  @Override
  @Transactional(readOnly = true)
  public List<Symbol> symbols() {
    return mapper.symbols().stream().map(this::symbol).toList();
  }

  private MarketAdminMapper.SymbolRow require(String code) {
    MarketAdminMapper.SymbolRow r = mapper.symbol(code);
    if (r == null) throw new BizException("NOT_FOUND", "品种不存在");
    return r;
  }

  @Override
  @Transactional
  public Symbol updateSymbol(String code, SymbolPatch p) {
    MarketAdminMapper.SymbolRow r = require(code);
    Symbol before = symbol(r);
    if (p == null) return before;
    ValidationException.Collector c = new ValidationException.Collector();
    if (p.nameZh() != null) r.nameZh = text(c, "nameZh", p.nameZh());
    if (p.nameEn() != null) r.nameEn = text(c, "nameEn", p.nameEn());
    if (p.maxLeverage() != null) {
      if (p.maxLeverage() < 1 || p.maxLeverage() > 1000) c.add("maxLeverage", "invalid");
      else r.maxLeverage = p.maxLeverage();
    }
    if (p.minLots() != null) r.minLots = positive(c, "minLots", p.minLots(), r.minLots);
    if (p.maxLots() != null) r.maxLots = positive(c, "maxLots", p.maxLots(), r.maxLots);
    if (p.lotStep() != null) r.lotStep = positive(c, "lotStep", p.lotStep(), r.lotStep);
    if (p.feeRate() != null) r.feeRate = rate(c, "openFeeRate", p.feeRate(), r.feeRate, new BigDecimal("0.01"));
    if (p.maintenanceMarginRate() != null) r.maintenanceMarginRate = rate(c, "maintenanceMarginRate", p.maintenanceMarginRate(), r.maintenanceMarginRate,
        new BigDecimal("0.5"));
    if (p.markup() != null) {
      if (p.markup().signum() < 0) c.add("markup", "invalid");
      else r.markup = p.markup();
    }
    // 隔夜费率可正可负（正为返还、负为扣），绝对值不超过 1%
    if (p.swapLong() != null) r.swapLong = swap(c, "swapLong", p.swapLong(), r.swapLong);
    if (p.swapShort() != null) r.swapShort = swap(c, "swapShort", p.swapShort(), r.swapShort);
    if (p.hot() != null) r.hot = p.hot();
    if (p.sortOrder() != null) r.sortOrder = p.sortOrder();
    if (p.openPaused() != null) r.openPaused = p.openPaused();
    if (r.minLots.compareTo(r.maxLots) > 0) c.add("maxLots", "lessThanMin");
    c.throwIfAny();
    mapper.updateSymbol(r);
    reloadAfterCommit();
    return before;
  }

  private static String text(ValidationException.Collector c, String field, String v) {
    String s = v.strip();
    if (s.isEmpty() || s.length() > 64) c.add(field, "invalid");
    return s;
  }

  private static BigDecimal positive(ValidationException.Collector c, String field, BigDecimal v, BigDecimal old) {
    if (v.signum() <= 0 || v.scale() > 8) {
      c.add(field, "invalid");
      return old;
    }
    return v;
  }

  private static BigDecimal rate(ValidationException.Collector c, String field, BigDecimal v, BigDecimal old, BigDecimal max) {
    if (v.signum() < 0 || v.compareTo(max) > 0 || v.scale() > 8) {
      c.add(field, "invalid");
      return old;
    }
    return v;
  }

  private static BigDecimal swap(ValidationException.Collector c, String field, BigDecimal v, BigDecimal old) {
    if (v.abs().compareTo(new BigDecimal("0.01")) > 0 || v.scale() > 8) {
      c.add(field, "invalid");
      return old;
    }
    return v;
  }

  private static final Set<String> CATEGORIES = Set.of("fx", "metal", "index", "energy", "crypto", "stock");
  /** 代码：大写字母开头，大写字母和数字，2–16 位（和第一版 50 个品种同样的写法，例如 EURUSD、US30、JPN225） */
  private static final Pattern CODE = Pattern.compile("[A-Z][A-Z0-9]{1,15}");

  /** 模板的一周时段：{星期, 开始分钟, 结束分钟}，和 V4 迁移一致 */
  static List<int[]> template(SessionTemplate t) {
    List<int[]> out = new ArrayList<>();
    switch (t) {
      case FX -> {
        out.add(new int[] {7, 1320, 1440});
        for (int d = 1; d <= 4; d++) out.add(new int[] {d, 0, 1440});
        out.add(new int[] {5, 0, 1260});
      }
      case CRYPTO -> {
        for (int d = 1; d <= 7; d++) out.add(new int[] {d, 0, 1440});
      }
      case US_STOCK -> {
        for (int d = 1; d <= 5; d++) out.add(new int[] {d, 810, 1200});
      }
    }
    return out;
  }

  /** 报价货币能不能折算成 USD：USD / USDT、有对应的外汇品种（XXXUSD 或 USDXXX）、或配置了固定汇率；否则这个品种永远不能开仓 */
  private boolean hasUsdRate(String ccy) {
    if ("USD".equals(ccy) || "USDT".equals(ccy)) return true;
    if (catalog.get(ccy + "USD").isPresent() || catalog.get("USD" + ccy).isPresent()) return true;
    return props.fixedUsdRates() != null && props.fixedUsdRates().get(ccy) != null;
  }

  private static String unitOf(String category) {
    return switch (category) {
      case "fx" -> "baseCcy";
      case "metal" -> "ounce";
      case "energy" -> "barrel";
      case "stock" -> "share";
      default -> "unit";
    };
  }

  private static BigDecimal required(ValidationException.Collector c, String field, BigDecimal v) {
    if (v == null) c.add(field, "required");
    return v;
  }

  private static String requiredText(ValidationException.Collector c, String field, String v) {
    if (v == null || v.isBlank()) {
      c.add(field, "required");
      return null;
    }
    return text(c, field, v);
  }

  @Override
  @Transactional
  public Symbol createSymbol(SymbolCreate in) {
    SymbolCreate x = in == null ? new SymbolCreate(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null) : in;
    ValidationException.Collector c = new ValidationException.Collector();
    String code = x.code() == null ? "" : x.code().strip();
    if (code.isEmpty()) c.add("code", "required");
    else if (!CODE.matcher(code).matches()) c.add("code", "invalid");
    String nameZh = requiredText(c, "nameZh", x.nameZh());
    String nameEn = requiredText(c, "nameEn", x.nameEn());
    String category = x.category() == null ? "" : x.category().strip().toLowerCase(Locale.ROOT);
    if (category.isEmpty()) c.add("category", "required");
    else if (!CATEGORIES.contains(category)) c.add("category", "invalid");
    if (x.digits() == null) c.add("digits", "required");
    else if (x.digits() < 0 || x.digits() > 8) c.add("digits", "invalid");
    BigDecimal contract = required(c, "contractSize", x.contractSize());
    if (contract != null) contract = positive(c, "contractSize", contract, null);
    String quote = x.quoteCcy() == null ? "" : x.quoteCcy().strip().toUpperCase(Locale.ROOT);
    if (quote.isEmpty()) c.add("quoteCurrency", "required");
    else if (!quote.matches("[A-Z]{3,4}")) c.add("quoteCurrency", "invalid");
    else if (!hasUsdRate(quote)) c.add("quoteCurrency", "noFxRate");
    if (x.maxLeverage() == null) c.add("maxLeverage", "required");
    else if (x.maxLeverage() < 1 || x.maxLeverage() > 1000) c.add("maxLeverage", "invalid");
    BigDecimal mmr = required(c, "maintenanceMarginRate", x.maintenanceMarginRate());
    if (mmr != null) {
      mmr = rate(c, "maintenanceMarginRate", mmr, null, new BigDecimal("0.5"));
      if (mmr != null && mmr.signum() == 0) {
        c.add("maintenanceMarginRate", "invalid");
        mmr = null;
      }
    }
    BigDecimal fee = required(c, "openFeeRate", x.feeRate());
    if (fee != null) fee = rate(c, "openFeeRate", fee, null, new BigDecimal("0.01"));
    BigDecimal minLots = required(c, "minLots", x.minLots());
    if (minLots != null) minLots = positive(c, "minLots", minLots, null);
    BigDecimal maxLots = required(c, "maxLots", x.maxLots());
    if (maxLots != null) maxLots = positive(c, "maxLots", maxLots, null);
    BigDecimal step = required(c, "lotStep", x.lotStep());
    if (step != null) step = positive(c, "lotStep", step, null);
    if (minLots != null && maxLots != null && minLots.compareTo(maxLots) > 0) c.add("maxLots", "lessThanMin");
    BigDecimal markup = x.markup() == null ? BigDecimal.ZERO : x.markup();
    if (markup.signum() < 0 || markup.scale() > 8) c.add("markup", "invalid");
    // 交易时段：从已有品种复制，或用模板（二选一）
    String copy = x.copySessionsFrom() == null || x.copySessionsFrom().isBlank() ? null : x.copySessionsFrom().strip();
    String tpl = x.sessionTemplate() == null || x.sessionTemplate().isBlank() ? null : x.sessionTemplate().strip().toUpperCase(Locale.ROOT);
    List<int[]> sessions = List.of();
    if (copy == null && tpl == null) c.add("sessions", "required");
    else if (copy != null && tpl != null) c.add("sessions", "invalid");
    else if (copy != null) {
      sessions = mapper.sessions().stream().filter(s -> s.symbol.equals(copy)).map(s -> new int[] {s.dayOfWeek, s.openMinute, s.closeMinute}).toList();
      if (sessions.isEmpty()) c.add("copySessionsFrom", "invalid");
    } else {
      try {
        sessions = template(SessionTemplate.valueOf(tpl));
      } catch (IllegalArgumentException e) {
        c.add("sessionTemplate", "invalid");
      }
    }
    c.throwIfAny();
    if (mapper.codeCount(code) > 0) throw new BizException("SYMBOL_EXISTS", "品种代码已存在");

    MarketAdminMapper.SymbolRow r = new MarketAdminMapper.SymbolRow();
    r.code = code;
    r.nameZh = nameZh;
    r.nameEn = nameEn;
    r.category = category;
    r.digits = x.digits();
    r.contractSize = contract;
    r.unit = unitOf(category);
    // 基础货币只用来显示：代码以报价货币结尾时取前半段（EURUSD → EUR），否则用代码本身（US30、AAPL）
    String base = code.length() > quote.length() && code.endsWith(quote) ? code.substring(0, code.length() - quote.length()) : code;
    r.baseCcy = base.length() > 8 ? base.substring(0, 8) : base;
    r.quoteCcy = quote;
    r.maxLeverage = x.maxLeverage();
    r.minLots = minLots;
    r.maxLots = maxLots;
    r.lotStep = step;
    r.feeRate = fee;
    r.maintenanceMarginRate = mmr;
    r.markup = markup;
    r.swapLong = BigDecimal.ZERO;
    r.swapShort = BigDecimal.ZERO;
    r.hot = Boolean.TRUE.equals(x.hot());
    r.openPaused = true; // 新增后默认暂停开仓：运营确认报价正常后在品种页打开
    r.sortOrder = mapper.maxSortOrder() + 1;
    r.enabled = true;
    mapper.insertSymbol(r);
    for (int[] s : sessions) mapper.insertSession(code, s[0], s[1], s[2]);
    reloadAfterCommit();
    return symbol(mapper.symbol(code));
  }

  @Override
  @Transactional
  public Symbol setEnabled(String code, boolean enabled) {
    MarketAdminMapper.SymbolRow r = require(code);
    Symbol before = symbol(r);
    mapper.setEnabled(code, enabled);
    reloadAfterCommit();
    return before;
  }

  @Override
  @Transactional(readOnly = true)
  public List<Session> sessions() {
    return mapper.sessions().stream().map(s -> new Session(s.symbol, s.dayOfWeek, s.openMinute, s.closeMinute)).toList();
  }

  @Override
  @Transactional(readOnly = true)
  public List<Holiday> holidays(LocalDate from) {
    return mapper.holidays(from).stream().map(h -> new Holiday(h.id, h.symbol, h.tradeDate, h.reason)).toList();
  }

  @Override
  @Transactional
  public Holiday addHoliday(String symbol, LocalDate date, String reason) {
    ValidationException.Collector c = new ValidationException.Collector();
    String s = symbol == null ? "" : symbol.strip();
    if (!"*".equals(s) && mapper.symbol(s) == null) c.add("symbol", "invalid");
    if (date == null) c.add("date", "required");
    if (reason != null && reason.length() > 128) c.add("reason", "tooLong");
    c.throwIfAny();
    if (mapper.holidayOf(s, date) != null) throw new BizException("HOLIDAY_EXISTS", "这一天已经是休市日");
    MarketAdminMapper.HolidayRow h = new MarketAdminMapper.HolidayRow();
    h.symbol = s;
    h.tradeDate = date;
    h.reason = reason == null ? null : reason.strip();
    mapper.insertHoliday(h);
    reloadAfterCommit();
    return new Holiday(h.id, h.symbol, h.tradeDate, h.reason);
  }

  @Override
  @Transactional
  public Holiday deleteHoliday(long id) {
    MarketAdminMapper.HolidayRow h = mapper.holiday(id);
    if (h == null) throw new BizException("NOT_FOUND", "休市日不存在");
    mapper.deleteHoliday(id);
    reloadAfterCommit();
    return new Holiday(h.id, h.symbol, h.tradeDate, h.reason);
  }

  /** 启用品种用到的报价币种（USD 以外）各一行；和 {@link MarketApi#liveUsdRate} 同一口径 */
  @Override
  public List<FxRate> fxRates() {
    Map<String, List<String>> byCcy = new TreeMap<>();
    for (SymbolSpec s : catalog.all()) {
      if ("USD".equals(s.quoteCcy()) || "USDT".equals(s.quoteCcy())) continue;
      byCcy.computeIfAbsent(s.quoteCcy(), k -> new ArrayList<>()).add(s.code());
    }
    List<FxRate> out = new ArrayList<>();
    byCcy.forEach((ccy, symbols) -> {
      String source;
      Optional<MarketQuote> q;
      boolean inverse = false;
      if (catalog.get(ccy + "USD").isPresent()) {
        source = ccy + "USD";
        q = processor.latest(source);
      } else if (catalog.get("USD" + ccy).isPresent()) {
        source = "USD" + ccy;
        q = processor.latest(source);
        inverse = true;
      } else {
        BigDecimal fixed = props.fixedUsdRates() == null ? null : props.fixedUsdRates().get(ccy);
        out.add(new FxRate(ccy, "fixed", fixed, null, fixed == null, symbols));
        return;
      }
      BigDecimal rate = q.map(MarketQuote::mid).map(m -> m.signum() == 0 ? null : m).orElse(null);
      if (rate != null && inverse) rate = BigDecimal.ONE.divide(rate, 12, RoundingMode.HALF_UP);
      boolean stale = market.liveUsdRate(ccy).isEmpty();
      out.add(new FxRate(ccy, source, rate, q.map(MarketQuote::time).orElse(null), stale, symbols));
    });
    return out;
  }
}
