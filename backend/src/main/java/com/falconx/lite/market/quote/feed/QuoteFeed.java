package com.falconx.lite.market.quote.feed;

import java.time.Instant;
import java.util.List;

/**
 * 一家真实报价源（可插拔，技术方案/v2-报价源接入.md 第 3.3 节）：现在有 {@link AllTickFeed}、{@link ITickFeed}、{@link BinanceFeed}；
 * 以后加 OKX 等，写一个新的实现（WebSocket 的继承 {@link WsFeed}），在 {@link QuoteFeeds} 里按名字创建，映射里写上它的名字即可。
 */
public interface QuoteFeed extends AutoCloseable {

  enum State {
    DISCONNECTED,
    CONNECTING,
    CONNECTED
  }

  /**
   * 一条连接的状态（后台健康检查告警详情、测试用）。
   *
   * @param symbols 这条连接订阅的品种数
   * @param lastError 最后一次错误（已抹掉 token）；没有为空
   */
  record ChannelStatus(String channel, State state, int symbols, Instant connectedSince, Instant lastMessageAt, long reconnects, String lastError) {}

  /** 映射里用的名字，例如 alltick */
  String name();

  void start();

  @Override
  void close();

  List<ChannelStatus> status();

  /** 最后一次解析出买卖价的时间（系统时间）；从来没有为空 */
  Instant lastQuoteAt();
}
