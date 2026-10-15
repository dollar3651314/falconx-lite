package com.falconx.lite.risk.switches;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.risk.api.RiskApi;
import com.falconx.lite.trading.api.ExposureApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link RiskApi} 的实现。开关每次都读数据库（主键查询），后台改了立即生效。
 * 敞口按当前中间价和当前汇率折算成 USD；品种没有报价时用开仓时的名义价值估算。
 */
@Service
@EnableConfigurationProperties(RiskProperties.class)
class RiskSwitchService implements RiskApi {

  private final RiskSwitchMapper mapper;
  private final ExposureApi exposure;
  private final MarketApi market;
  private final RiskAlerts alerts;

  RiskSwitchService(RiskSwitchMapper mapper, ExposureApi exposure, MarketApi market, RiskAlerts alerts) {
    this.mapper = mapper;
    this.exposure = exposure;
    this.market = market;
    this.alerts = alerts;
  }

  @Override
  public void notifyStaff(String template, Map<String, String> params) {
    alerts.send(template, params);
  }

  @Override
  public boolean globalOpenPaused() {
    RiskSwitchMapper.Platform p = mapper.platform();
    return p.globalOpenPaused() || p.autoGlobalPaused();
  }

  @Override
  public boolean symbolOpenPaused(String symbol) {
    return Boolean.TRUE.equals(mapper.symbolPaused(symbol));
  }

  @Override
  public boolean autoLiquidationEnabled() {
    return mapper.platform().autoLiquidation();
  }

  @Override
  public Dashboard dashboard() {
    RiskSwitchMapper.Platform p = mapper.platform();
    Map<String, RiskSwitchMapper.SymbolRow> rows = mapper.symbols().stream().collect(Collectors.toMap(RiskSwitchMapper.SymbolRow::symbol, Function.identity()));
    Map<String, ExposureApi.SymbolLots> lots = exposure.openLots().stream().collect(Collectors.toMap(ExposureApi.SymbolLots::symbol, Function.identity()));
    List<SymbolExposure> out = new ArrayList<>();
    BigDecimal platformNet = BigDecimal.ZERO;
    for (SymbolSpec spec : market.symbols()) {
      ExposureApi.SymbolLots l = lots.get(spec.code());
      RiskSwitchMapper.SymbolRow r = rows.get(spec.code());
      BigDecimal longUsd = l == null ? BigDecimal.ZERO : usd(spec, l.longLots(), l.longNotionalUsd());
      BigDecimal shortUsd = l == null ? BigDecimal.ZERO : usd(spec, l.shortLots(), l.shortNotionalUsd());
      BigDecimal net = longUsd.subtract(shortUsd);
      platformNet = platformNet.add(net.abs());
      out.add(new SymbolExposure(spec.code(), longUsd, shortUsd, net, r == null ? null : r.netThreshold(), r != null && r.manualPaused(), r != null && r.autoPaused()));
    }
    return new Dashboard(out, platformNet, p.platformNetThreshold(), p.globalOpenPaused(), p.autoGlobalPaused(), p.autoLiquidation());
  }

  /** 手数 × 合约大小 × 中间价 × 汇率；没有报价或汇率时用开仓名义价值 */
  private BigDecimal usd(SymbolSpec spec, BigDecimal lots, BigDecimal fallback) {
    if (lots.signum() == 0) return BigDecimal.ZERO;
    Optional<MarketQuote> q = market.quote(spec.code());
    Optional<BigDecimal> rate = market.toUsdRate(spec.quoteCcy());
    if (q.isEmpty() || rate.isEmpty()) return fallback;
    return lots.multiply(spec.contractSize()).multiply(q.get().mid()).multiply(rate.get()).setScale(8, RoundingMode.HALF_UP);
  }

  @Override
  @Transactional
  public void pauseSymbol(String symbol, long operatorId) {
    mapper.upsertSymbol(symbol);
    RiskSwitchMapper.SymbolRow r = row(symbol);
    mapper.setSymbolPaused(symbol, true, r.autoPaused());
    mapper.insertEvent("PAUSE_SYMBOL", symbol, null, null, operatorId);
  }

  @Override
  @Transactional
  public void resumeSymbol(String symbol, long operatorId) {
    mapper.upsertSymbol(symbol);
    mapper.setSymbolPaused(symbol, false, false);
    mapper.insertEvent("RESUME_SYMBOL", symbol, null, null, operatorId);
  }

  @Override
  @Transactional
  public void pauseGlobal(long operatorId) {
    mapper.setGlobal(true, mapper.platform().autoGlobalPaused());
    mapper.insertEvent("PAUSE_GLOBAL", null, null, null, operatorId);
  }

  @Override
  @Transactional
  public void resumeGlobal(long operatorId) {
    mapper.setGlobal(false, false);
    mapper.insertEvent("RESUME_GLOBAL", null, null, null, operatorId);
  }

  @Override
  @Transactional
  public void setAutoLiquidation(boolean enabled, long operatorId) {
    mapper.setAutoLiquidation(enabled);
    mapper.insertEvent(enabled ? "AUTO_LIQUIDATION_ON" : "AUTO_LIQUIDATION_OFF", null, null, null, operatorId);
  }

  @Override
  @Transactional
  public void setSymbolThreshold(String symbol, BigDecimal threshold, long operatorId) {
    mapper.upsertSymbol(symbol);
    mapper.setSymbolThreshold(symbol, threshold);
    mapper.insertEvent("THRESHOLD", symbol, null, threshold, operatorId);
  }

  @Override
  @Transactional
  public void setPlatformThreshold(BigDecimal threshold, long operatorId) {
    mapper.setPlatformThreshold(threshold);
    mapper.insertEvent("THRESHOLD", null, null, threshold, operatorId);
  }

  private RiskSwitchMapper.SymbolRow row(String symbol) {
    return mapper.symbols().stream().filter(r -> r.symbol().equals(symbol)).findFirst().orElseThrow();
  }
}
