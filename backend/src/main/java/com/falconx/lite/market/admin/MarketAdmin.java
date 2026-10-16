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
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * {@link MarketAdminApi} 的实现。改动在事务提交后重新加载 {@link SymbolCatalog}。
 * 品种的维持保证金率、手续费率改了只影响以后开的仓，已有持仓用开仓时记下的值（强平价不变）。
 */
@Service
class MarketAdmin implements MarketAdminApi {

  private final MarketAdminMapper mapper;
  private final SymbolCatalog catalog;
  private final QuoteProcessor processor;
  private final MarketApi market;
  private final MarketProperties props;

  MarketAdmin(MarketAdminMapper mapper, SymbolCatalog catalog, QuoteProcessor processor, MarketApi market, MarketProperties props) {
    this.mapper = mapper;
    this.catalog = catalog;
    this.processor = processor;
    this.market = market;
    this.props = props;
  }

  private static Symbol symbol(MarketAdminMapper.SymbolRow r) {
    return new Symbol(new SymbolSpec(r.code, r.nameZh, r.nameEn, r.category, r.digits, r.contractSize, r.unit, r.baseCcy, r.quoteCcy, r.maxLeverage,
        r.minLots, r.maxLots, r.lotStep, r.feeRate, r.maintenanceMarginRate, r.markup, r.swapLong, r.swapShort, r.hot, r.openPaused, r.sortOrder),
        r.enabled, r.updatedAt);
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
    return mapper.symbols().stream().map(MarketAdmin::symbol).toList();
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
    if (p.feeRate() != null) r.feeRate = rate(c, "feeRate", p.feeRate(), r.feeRate, new BigDecimal("0.01"));
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
