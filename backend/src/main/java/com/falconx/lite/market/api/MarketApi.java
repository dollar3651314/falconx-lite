package com.falconx.lite.market.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** 行情模块对其他模块开放的操作。 */
public interface MarketApi {

  List<SymbolSpec> symbols();

  Optional<SymbolSpec> symbol(String code);

  /** 最新报价；从没收到过报价时为空 */
  Optional<MarketQuote> quote(String code);

  /** 该时刻是否在交易时段内（每周时段 + 休市日） */
  boolean isTradingOpen(String code, Instant at);

  /** UTC 日期这一天是不是这个品种的交易日（有交易时段、不是休市日）。 */
  boolean isTradingDay(String code, java.time.LocalDate date);

  /** 1 单位 ccy 折合多少 USD（USDT 视同 USD）；找不到汇率时为空，调用方应拒绝交易 */
  Optional<BigDecimal> toUsdRate(String ccy);

  /**
   * 可以用来开仓的汇率：来源报价当前可以成交（新鲜、正常、在交易时段内）才返回；固定汇率和 USD、USDT 总是返回。
   * 返回空表示"汇率失效"，相关品种不能开新仓（需求 4.5-5）。
   */
  Optional<BigDecimal> liveUsdRate(String ccy);

  /**
   * 两家真实报价源这个品种的价格偏差超过阈值，<b>暂停开仓</b>（技术方案/v2-报价源接入.md 第 4 节，Amos 2026-10-17 选 B）。
   * 只影响开仓（市价开仓、挂单成交）；报价照常可以成交（用主源的价格），平仓、止盈止损、强平照常。
   * 和品种自己的 {@link SymbolSpec#openPaused()}、风控的暂停是三个独立的开关，任何一个打开都不能开仓；偏差回落后自动恢复，只恢复这一个。
   */
  boolean quoteDeviationPaused(String code);

  void subscribe(QuoteListener listener);
}
