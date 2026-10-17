package com.falconx.lite.market.web;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 官网公开行情（v2 需求 4.2，application.yml 的 falconx.market.public-quotes）。
 *
 * @param symbols 官网展示的品种代码，按这个顺序返回（需求要求 8–12 个，默认 10 个，见 application.yml）；品种表里没有的代码忽略
 * @param cacheTtl 整份结果的缓存时间：同一时间段内所有访客拿到同一份结果，刷接口不会增加计算量
 * @param source 官网用哪种价格（技术方案/v2-报价源接入.md 第 6 节，FX_PUBLIC_QUOTES_SOURCE）：{@code simulated}（默认）一律用模拟价，
 *     真实报价源接管的品种取"示例行情"；{@code live} 用交易报价（真实源的价格），<b>拿到数据商书面的公开展示授权以后才能打开</b>
 */
@ConfigurationProperties(prefix = "falconx.market.public-quotes")
public record PublicQuoteProperties(List<String> symbols, Duration cacheTtl, String source) {

  public static final String SIMULATED = "simulated";
  public static final String LIVE = "live";

  public PublicQuoteProperties {
    symbols = symbols == null ? List.of() : List.copyOf(symbols);
    cacheTtl = cacheTtl == null ? Duration.ofSeconds(1) : cacheTtl;
    // 只有明确写 live 才用真实价；其他值（含拼错）一律按模拟价，避免误展示
    source = source != null && LIVE.equalsIgnoreCase(source.strip()) ? LIVE : SIMULATED;
  }

  public boolean live() {
    return LIVE.equals(source);
  }
}
