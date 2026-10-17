package com.falconx.lite.market.quote.feed;

import com.falconx.lite.common.health.AlertCheck;
import com.falconx.lite.market.config.SymbolCatalog;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * 真实报价源的业务告警（E8，技术方案/v2-报价源接入.md 第 5.2 节）。只进健康检查的 {@code alerts} 和告警邮件，<b>不影响 status</b>（约定 24）。
 * <ul>
 *   <li>{@code quote.alltick} / {@code quote.itick} / {@code quote.binance}（配了 token、打开了开关才有）：有连接没连上，或者这家负责的品种有开市的、但超过 {@code silence-alert} 没给任何报价；</li>
 *   <li>{@code quote.failover}（配了两家才有）：有品种正在用备源；</li>
 *   <li>{@code quote.deviation}（配了两家才有）：有品种因为两家价格偏差暂停开仓（平仓照常，用主源价格）。</li>
 * </ul>
 * 只看内存里的状态，不访问网络。详情里没有 token（错误信息已经抹掉）。
 */
@Component
class QuoteFeedAlert implements AlertCheck {

  private final QuoteFeeds feeds;
  private final QuoteRouter router;
  private final SymbolCatalog catalog;
  private final QuoteFeedsProperties props;
  private final Clock clock;
  private final Instant startedAt = Instant.now();

  QuoteFeedAlert(QuoteFeeds feeds, QuoteRouter router, SymbolCatalog catalog, QuoteFeedsProperties props, Clock clock) {
    this.feeds = feeds;
    this.router = router;
    this.catalog = catalog;
    this.props = props;
    this.clock = clock;
  }

  @Override
  public List<Item> evaluate() {
    List<Item> out = new ArrayList<>();
    Instant now = clock.instant();
    for (QuoteFeed f : feeds.feeds()) out.add(feedItem(f, now));
    if (feeds.feeds().size() >= 2) {
      List<String> backup = router.onBackup();
      out.add(new Item("quote.failover", "报价源切换到备源", "Quote feed failover", backup.isEmpty(),
          backup.isEmpty() ? "正常" : backup.size() + " 个品种正在用备源：" + String.join("、", backup)));
      List<String> dev = router.deviations();
      out.add(new Item("quote.deviation", "报价源价格偏差", "Quote feed deviation", dev.isEmpty(),
          dev.isEmpty() ? "正常" : dev.size() + " 个品种两家价格偏差超过 " + props.maxDeviation().movePointRight(2).stripTrailingZeros().toPlainString()
              + "%，已暂停开仓（平仓照常，用主源价格）：" + String.join("、", dev)));
    }
    return out;
  }

  private Item feedItem(QuoteFeed f, Instant now) {
    List<QuoteFeed.ChannelStatus> st = f.status();
    List<String> problems = new ArrayList<>();
    for (QuoteFeed.ChannelStatus c : st) {
      if (c.state() != QuoteFeed.State.CONNECTED) {
        problems.add(c.channel() + " 连接" + (c.state() == QuoteFeed.State.CONNECTING ? "正在连接" : "没连上") + "（已重连 " + c.reconnects() + " 次"
            + (c.lastError() == null ? "" : "，最后的错误：" + c.lastError()) + "）");
      }
    }
    boolean anyOpen = router.symbolsOf(f.name()).stream().anyMatch(s -> catalog.isOpen(s, now));
    Instant last = f.lastQuoteAt() == null ? startedAt : f.lastQuoteAt();
    Duration silent = Duration.between(last, Instant.now());
    if (anyOpen && silent.compareTo(props.silenceAlert()) > 0) {
      problems.add("开市的品种已经 " + silent.toSeconds() + " 秒没有收到这家的报价（阈值 " + props.silenceAlert().toSeconds() + " 秒）");
    }
    String detail = problems.isEmpty()
        ? "正常（" + st.stream().map(c -> c.channel() + " " + c.symbols() + " 个品种").collect(Collectors.joining("、")) + "）"
        : String.join("；", problems);
    return new Item("quote." + f.name(), "报价源 " + f.name() + " 异常", "Quote feed " + f.name() + " problem", problems.isEmpty(), detail);
  }
}
