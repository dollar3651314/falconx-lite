package com.falconx.lite.market.quote.feed;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * 创建和启动配了 token（币安：打开了开关）的真实报价源（技术方案/v2-报价源接入.md）。没有 token、开关关闭、或报价模式是 none 时什么都不创建（和接入以前完全一样）。
 * 应用启动完成后才连接，停机时断开。
 */
@Component
public class QuoteFeeds {

  private final List<QuoteFeed> feeds = new ArrayList<>();

  QuoteFeeds(QuoteRouter router, QuoteFeedsProperties props, ObjectMapper json, MeterRegistry metrics) {
    for (var e : router.subscriptions().entrySet()) {
      Map<String, List<String>> codes = e.getValue();
      switch (e.getKey()) {
        case AllTickFeed.NAME -> feeds.add(new AllTickFeed(props, codes, router, json, metrics));
        case ITickFeed.NAME -> feeds.add(new ITickFeed(props, codes, router, json, metrics));
        case BinanceFeed.NAME -> feeds.add(new BinanceFeed(props, codes, router, json, metrics));
        default -> throw new IllegalStateException("不认识的报价源 " + e.getKey());
      }
    }
  }

  @EventListener(ApplicationReadyEvent.class)
  void start() {
    feeds.forEach(QuoteFeed::start);
  }

  /** 已创建的报价源（配了 token 的） */
  public List<QuoteFeed> feeds() {
    return List.copyOf(feeds);
  }

  @PreDestroy
  void stop() {
    feeds.forEach(QuoteFeed::close);
  }
}
