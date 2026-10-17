package com.falconx.lite.market;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteListener;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;

/**
 * {@link MarketApi} 的实现。
 * 汇率：用外汇品种的基准中间价换算（XXXUSD 直接用、USDXXX 取倒数，USDT 视同 USD）；没有对应品种的币种用固定汇率（例如港币）。
 */
@Service
@EnableConfigurationProperties(MarketProperties.class)
class MarketService implements MarketApi {

  private final SymbolCatalog catalog;
  private final QuoteProcessor processor;
  private final MarketProperties props;

  MarketService(SymbolCatalog catalog, QuoteProcessor processor, MarketProperties props) {
    this.catalog = catalog;
    this.processor = processor;
    this.props = props;
  }

  @Override
  public List<SymbolSpec> symbols() {
    return catalog.all();
  }

  @Override
  public Optional<SymbolSpec> symbol(String code) {
    return catalog.get(code);
  }

  @Override
  public Optional<MarketQuote> quote(String code) {
    return processor.latest(code);
  }

  @Override
  public boolean isTradingOpen(String code, Instant at) {
    return catalog.isOpen(code, at);
  }

  @Override
  public boolean isTradingDay(String code, java.time.LocalDate date) {
    return catalog.isTradingDay(code, date);
  }

  @Override
  public Optional<BigDecimal> toUsdRate(String ccy) {
    if (ccy == null) return Optional.empty();
    if ("USD".equals(ccy) || "USDT".equals(ccy)) return Optional.of(BigDecimal.ONE);
    Optional<MarketQuote> direct = processor.book().get(ccy + "USD").map(e -> e.quote());
    if (direct.isPresent()) return Optional.of(direct.get().mid());
    Optional<MarketQuote> inverse = processor.book().get("USD" + ccy).map(e -> e.quote());
    if (inverse.isPresent()) return Optional.of(BigDecimal.ONE.divide(inverse.get().mid(), 12, RoundingMode.HALF_UP));
    return Optional.ofNullable(props.fixedUsdRates() == null ? null : props.fixedUsdRates().get(ccy));
  }

  @Override
  public Optional<BigDecimal> liveUsdRate(String ccy) {
    if (ccy == null) return Optional.empty();
    if ("USD".equals(ccy) || "USDT".equals(ccy)) return Optional.of(BigDecimal.ONE);
    if (catalog.get(ccy + "USD").isPresent()) return processor.latest(ccy + "USD").filter(MarketQuote::executable).map(MarketQuote::mid);
    if (catalog.get("USD" + ccy).isPresent()) {
      return processor.latest("USD" + ccy).filter(MarketQuote::executable).map(q -> BigDecimal.ONE.divide(q.mid(), 12, RoundingMode.HALF_UP));
    }
    return Optional.ofNullable(props.fixedUsdRates() == null ? null : props.fixedUsdRates().get(ccy));
  }

  @Override
  public boolean quoteDeviationPaused(String code) {
    return processor.isDeviationPaused(code);
  }

  @Override
  public void subscribe(QuoteListener listener) {
    processor.subscribe(listener);
  }
}
