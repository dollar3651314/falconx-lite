package com.falconx.lite.market.quote;

import com.falconx.lite.common.health.AlertCheck;
import com.falconx.lite.common.health.AlertProperties;
import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * 行情全部断流告警（E8，功能取舍对照表 M-32）：现在开市的品种里，最近 {@code falconx.alert.market-silence}（默认 30 秒）没有任何一个收到报价，
 * 健康检查的 {@code alerts.market} 变成 DOWN 并发告警邮件。
 * <ul>
 *   <li>只看"全部"：个别品种没报价（例如 LP 不提供）不算断流，各品种的报价年龄看指标 {@code fx_quote_age_seconds}。</li>
 *   <li>没有报价源（{@code FX_MARKET_SOURCE=none}，后端测试）时不检查；模拟报价源（测试环境）和以后的 LP 一样检查。</li>
 *   <li>全部休市（周末）时不检查。应用刚启动时从启动时间算起，给报价源留出连接的时间。</li>
 * </ul>
 */
@Component
class MarketAlert implements AlertCheck {

  private final QuoteProcessor processor;
  private final SymbolCatalog catalog;
  private final MarketProperties market;
  private final AlertProperties props;
  private final Clock clock;
  private final Instant startedAt;

  MarketAlert(QuoteProcessor processor, SymbolCatalog catalog, MarketProperties market, AlertProperties props, Clock clock) {
    this.processor = processor;
    this.catalog = catalog;
    this.market = market;
    this.props = props;
    this.clock = clock;
    this.startedAt = clock.instant();
  }

  @Override
  public List<Item> evaluate() {
    if (market.source() == null || market.source().isBlank() || "none".equalsIgnoreCase(market.source())) return List.of();
    Instant now = clock.instant();
    List<String> open = new ArrayList<>();
    Instant latest = startedAt;
    for (SymbolSpec s : catalog.all()) {
      if (!catalog.isOpen(s.code(), now)) continue;
      open.add(s.code());
      Instant t = processor.lastReceived(s.code()).orElse(null);
      if (t != null && t.isAfter(latest)) latest = t;
    }
    if (open.isEmpty()) return List.of(new Item("market", "行情全部断流", "Market data stopped", true, "全部休市"));
    Duration silent = Duration.between(latest, now);
    boolean ok = silent.compareTo(props.marketSilence()) <= 0;
    String detail = ok ? "正常" : "开市的 " + open.size() + " 个品种已经 " + silent.toSeconds() + " 秒没有收到任何报价（报价源 " + market.source() + "，阈值 "
        + props.marketSilence().toSeconds() + " 秒）";
    return List.of(new Item("market", "行情全部断流", "Market data stopped", ok, detail));
  }
}
