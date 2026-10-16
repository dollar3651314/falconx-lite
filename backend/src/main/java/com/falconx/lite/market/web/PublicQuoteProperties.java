package com.falconx.lite.market.web;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 官网公开行情（v2 需求 4.2，application.yml 的 falconx.market.public-quotes）。
 *
 * @param symbols 官网展示的品种代码，按这个顺序返回（需求要求 8–12 个，默认 10 个，见 application.yml）；品种表里没有的代码忽略
 * @param cacheTtl 整份结果的缓存时间：同一时间段内所有访客拿到同一份结果，刷接口不会增加计算量
 */
@ConfigurationProperties(prefix = "falconx.market.public-quotes")
public record PublicQuoteProperties(List<String> symbols, Duration cacheTtl) {

  public PublicQuoteProperties {
    symbols = symbols == null ? List.of() : List.copyOf(symbols);
    cacheTtl = cacheTtl == null ? Duration.ofSeconds(1) : cacheTtl;
  }
}
