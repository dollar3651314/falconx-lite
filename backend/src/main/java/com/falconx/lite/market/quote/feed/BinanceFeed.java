package com.falconx.lite.market.quote.feed;

import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 币安公开行情（技术方案/v2-报价源接入.md 第 12 节）。<b>不需要 API Key</b>，所以没有 token，由 {@code FX_QUOTE_BINANCE_ENABLED} 开关控制（默认关闭）。
 * 接口要点（出处：现货 https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md ；
 * 永续 https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams 及其 "Important WebSocket Change Notice"）：
 * <ul>
 *   <li>两种连接：{@code spot}（现货，只读行情专用域名 {@code wss://data-stream.binance.vision}）和 {@code futures}
 *       （USDⓈ-M 永续，{@code wss://fstream.binance.com/public}，bookTicker 属于 {@code /public} 路由；默认关闭，默认映射里也没有品种用它）；</li>
 *   <li>组合流：{@code /stream?streams=btcusdt@bookTicker/ethusdt@bookTicker}（流名小写），推送包在 {@code {"stream":"…","data":{…}}} 里；
 *       <b>订阅写在 URL 里，连上不用发任何订阅消息</b>，重连就是重新带着同一个 URL 连接，自然"重新订阅"；</li>
 *   <li>一条连接最多 1024 个流（这里默认每条最多 200 个，超过分多条连接，每条晚 1 秒开始，远低于"每 IP 每 5 分钟 300 次连接"）；</li>
 *   <li>客户端每秒最多发 5 条消息（现货，永续 10 条，ping/pong 和 JSON 请求都算）：这里只每 30 秒发一次 {@code LIST_SUBSCRIPTIONS} 作心跳；</li>
 *   <li>服务器每 20 秒（永续每 3 分钟）发 ping 帧，一分钟（永续 10 分钟）内不回 pong 就断开：JDK 自动回 pong；</li>
 *   <li>一条连接只保持 24 小时，到点服务器断开：这里 23 小时主动换新连接（{@code max-connection-age}）；万一被服务器先断开，按普通断线重连
 *       （之前正常过，退避已清零，1 秒左右重连）；</li>
 *   <li>bookTicker 推送：现货 {@code {"u":…,"s":"BNBUSDT","b":"25.35190000","B":"…","a":"25.36520000","A":"…"}}，<b>没有时间字段</b>，
 *       用收到的时间（交给 {@link QuoteRouter} 的时间为空，由它取当时的时钟）；永续多了 {@code e}、{@code E}（事件时间）、{@code T}（撮合时间），
 *       有 {@code T} 用 {@code T}，否则用 {@code E}。价格是字符串。</li>
 * </ul>
 * 不需要 token，所以没有要从日志里抹掉的东西（{@link #secret()} 为空）。
 */
public class BinanceFeed extends WsFeed {

  public static final String NAME = "binance";
  public static final String SPOT = "spot";
  public static final String FUTURES = "futures";
  static final Set<String> CHANNELS = Set.of(SPOT, FUTURES);
  private static final Duration CHANNEL_GAP = Duration.ofSeconds(1);

  private static final Logger log = LoggerFactory.getLogger(BinanceFeed.class);

  private final ObjectMapper json;
  private final AtomicLong seq = new AtomicLong();

  public BinanceFeed(QuoteFeedsProperties props, Map<String, List<String>> codesByChannel, QuoteSink sink, ObjectMapper json, MeterRegistry metrics) {
    super(NAME, props, sink, metrics, channels(props.binance(), codesByChannel));
    this.json = json;
  }

  /** 每种连接按 {@code max-streams-per-connection} 分组，一组一条连接；只有一组时连接名就是 spot / futures，多组是 spot-1、spot-2… */
  static List<ChannelSpec> channels(QuoteFeedsProperties.Binance p, Map<String, List<String>> codes) {
    List<ChannelSpec> out = new ArrayList<>();
    int n = 0;
    for (String ch : List.of(SPOT, FUTURES)) {
      if (FUTURES.equals(ch) && !p.futuresEnabled()) continue;
      List<String> c = codes.getOrDefault(ch, List.of());
      if (c.isEmpty()) continue;
      String base = SPOT.equals(ch) ? p.spotUrl() : p.futuresUrl();
      int size = p.maxStreamsPerConnection();
      int groups = (c.size() + size - 1) / size;
      for (int g = 0; g < groups; g++) {
        List<String> part = c.subList(g * size, Math.min(c.size(), (g + 1) * size));
        String name = groups == 1 ? ch : ch + "-" + (g + 1);
        out.add(new ChannelSpec(name, streamUri(base, part), part, CHANNEL_GAP.multipliedBy(n++)));
      }
    }
    return out;
  }

  /** 组合流地址：{@code <base>/stream?streams=btcusdt@bookTicker/…} */
  static URI streamUri(String base, List<String> codes) {
    StringBuilder b = new StringBuilder(base).append("/stream?streams=");
    for (int i = 0; i < codes.size(); i++) {
      if (i > 0) b.append('/');
      b.append(codes.get(i).toLowerCase(Locale.ROOT)).append("@bookTicker");
    }
    return URI.create(b.toString());
  }

  @Override
  protected String secret() {
    return "";
  }

  @Override
  protected Duration heartbeatInterval() {
    return props.binance().heartbeat();
  }

  @Override
  protected Duration maxConnectionAge() {
    return props.binance().maxConnectionAge();
  }

  @Override
  protected void opened(Conn c) {
    // 订阅已经写在 URL 里，不用发消息
  }

  @Override
  protected String heartbeat(Conn c) {
    return "{\"method\":\"LIST_SUBSCRIPTIONS\",\"id\":" + seq.incrementAndGet() + "}";
  }

  @Override
  protected void received(Conn c, String text) {
    JsonNode m = json.readTree(text);
    JsonNode d = m.path("data");
    if (d.isObject()) {
      bookTicker(c, d);
      return;
    }
    if (m.has("error") || (m.has("code") && m.has("msg"))) {
      JsonNode e = m.has("error") ? m.path("error") : m;
      String err = "请求被拒绝：" + e.path("code").asString("") + " " + e.path("msg").asString("");
      noteError(c, err);
      log.warn("报价源 binance 的 {} 连接{}", c.channel(), err);
      return;
    }
    if (m.has("id")) {
      markHealthy(c); // LIST_SUBSCRIPTIONS 的回应
      return;
    }
    if (m.has("s") && m.has("b")) bookTicker(c, m); // 单个流（/ws/…）的格式，也认
  }

  private void bookTicker(Conn c, JsonNode d) {
    String s = d.path("s").asString("");
    BigDecimal bid = price(d.path("b"));
    BigDecimal ask = price(d.path("a"));
    if (s.isEmpty() || bid == null || ask == null) return;
    markHealthy(c);
    long t = d.path("T").asLong(0);
    if (t <= 0) t = d.path("E").asLong(0);
    emit(s.toUpperCase(Locale.ROOT), bid, ask, t > 0 ? Instant.ofEpochMilli(t) : null);
  }

  /** 价格：字符串（也接受数字）；不是正数为空（一边没有挂单时币安给 "0.00000000"） */
  static BigDecimal price(JsonNode p) {
    try {
      BigDecimal v = p.isNumber() ? p.decimalValue() : new BigDecimal(p.asString("").strip());
      return v.signum() > 0 ? v : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
