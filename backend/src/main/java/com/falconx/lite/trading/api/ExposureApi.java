package com.falconx.lite.trading.api;

import java.math.BigDecimal;
import java.util.List;

/** 给风控模块算敞口用：每个品种的多头、空头合计。只给后台和风控，不给客户（T5）。 */
public interface ExposureApi {

  /**
   * 一个品种当前所有持仓的合计。
   *
   * @param longNotionalUsd 多头开仓时的 USD 名义价值合计（没有报价时风控用它估算）
   */
  record SymbolLots(String symbol, BigDecimal longLots, BigDecimal shortLots, BigDecimal longNotionalUsd, BigDecimal shortNotionalUsd) {}

  List<SymbolLots> openLots();
}
