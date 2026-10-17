package com.falconx.lite.market.quote.feed;

import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * AllTick（技术方案/v2-报价源接入.md 第 1.1 节，出处 https://alltick.co/apis/en/websocket/introduction）：
 * <ul>
 *   <li>两条连接：{@code fx}（外汇、贵金属、原油、CFD 指数、加密货币）和 {@code stock}（美股），token 放在 URL 参数 {@code token} 里；</li>
 *   <li>订阅订单簿 22002（{@code depth_level} 1，只要第一档的买卖价），每次订阅覆盖上一次，所以每次连上都发完整清单；
 *       两条连接的请求至少隔 3 秒（第二条连接晚 3 秒开始）；</li>
 *   <li>心跳 22000，每 10 秒；推送 22999：{@code data.code}、{@code bids[0].price}、{@code asks[0].price}、{@code tick_time}
 *       （文档写毫秒，示例是秒，两种都认）。</li>
 * </ul>
 * 成交价（22998）没有买卖价，不订阅、收到也忽略（第 8 节：只有成交价的品种这个源不用）。
 */
public class AllTickFeed extends WsFeed {

  public static final String NAME = "alltick";
  static final Set<String> CHANNELS = Set.of("fx", "stock");

  private static final Logger log = LoggerFactory.getLogger(AllTickFeed.class);

  private final ObjectMapper json;
  private final AtomicLong seq = new AtomicLong();

  public AllTickFeed(QuoteFeedsProperties props, Map<String, List<String>> codesByChannel, QuoteSink sink, ObjectMapper json, MeterRegistry metrics) {
    super(NAME, props, sink, metrics, channels(props.alltick(), codesByChannel));
    this.json = json;
  }

  private static List<ChannelSpec> channels(QuoteFeedsProperties.AllTick p, Map<String, List<String>> codes) {
    List<ChannelSpec> out = new ArrayList<>();
    String token = URLEncoder.encode(p.token(), StandardCharsets.UTF_8);
    int n = 0;
    for (String ch : List.of("fx", "stock")) {
      List<String> c = codes.getOrDefault(ch, List.of());
      if (c.isEmpty()) continue;
      String base = "fx".equals(ch) ? p.fxUrl() : p.stockUrl();
      URI uri = URI.create(base + (base.contains("?") ? "&" : "?") + "token=" + token);
      out.add(new ChannelSpec(ch, uri, c, p.channelGap().multipliedBy(n++)));
    }
    return out;
  }

  @Override
  protected String secret() {
    return props.alltick().token();
  }

  @Override
  protected Duration heartbeatInterval() {
    return props.alltick().heartbeat();
  }

  @Override
  protected void opened(Conn c) {
    ObjectNode m = request(22002);
    ArrayNode list = m.putObject("data").putArray("symbol_list");
    for (String code : c.codes()) list.addObject().put("code", code).put("depth_level", 1);
    send(c, json.writeValueAsString(m));
  }

  @Override
  protected String heartbeat(Conn c) {
    ObjectNode m = request(22000);
    m.putObject("data");
    return json.writeValueAsString(m);
  }

  private ObjectNode request(int cmd) {
    long n = seq.incrementAndGet();
    ObjectNode m = json.createObjectNode();
    m.put("cmd_id", cmd);
    m.put("seq_id", n);
    // trace 每次不能重复（文档要求）
    m.put("trace", "fx-" + cmd + "-" + System.currentTimeMillis() + "-" + n);
    return m;
  }

  @Override
  protected void received(Conn c, String text) {
    JsonNode m = json.readTree(text);
    int cmd = m.path("cmd_id").asInt(0);
    switch (cmd) {
      case 22999 -> depth(c, m.path("data"));
      case 22003, 22005, 22007 -> {
        int ret = m.path("ret").asInt(0);
        if (ret == 200) {
          markHealthy(c);
        } else {
          String err = "订阅被拒绝：ret=" + ret + " " + m.path("msg").asString("");
          noteError(c, err);
          log.warn("报价源 alltick 的 {} 连接{}", c.channel(), redact(err));
        }
      }
      case 22001 -> {
        int ret = m.path("ret").asInt(200);
        if (ret != 200) noteError(c, "心跳回应 ret=" + ret + " " + m.path("msg").asString(""));
      }
      default -> {
        // 22998（成交价，没有买卖价）和其他消息忽略
      }
    }
  }

  private void depth(Conn c, JsonNode d) {
    String code = d.path("code").asString("");
    BigDecimal bid = price(d.path("bids"));
    BigDecimal ask = price(d.path("asks"));
    if (code.isEmpty() || bid == null || ask == null) return; // 一边为空（涨跌停、没有盘口）时不用
    markHealthy(c);
    emit(code, bid, ask, time(d.path("tick_time")));
  }

  /** 第一档价格；价格是字符串（也接受数字）；没有或不是正数为空 */
  static BigDecimal price(JsonNode levels) {
    if (!levels.isArray() || levels.isEmpty()) return null;
    JsonNode p = levels.get(0).path("price");
    try {
      BigDecimal v = p.isNumber() ? p.decimalValue() : new BigDecimal(p.asString("").strip());
      return v.signum() > 0 ? v : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /** tick_time：毫秒（文档）或秒（示例），数字或字符串；看不懂为空（用收到的时间） */
  static Instant time(JsonNode t) {
    long v;
    if (t.isNumber()) {
      v = t.asLong();
    } else {
      try {
        v = Long.parseLong(t.asString("").strip());
      } catch (NumberFormatException e) {
        return null;
      }
    }
    if (v <= 0) return null;
    return v < 100_000_000_000L ? Instant.ofEpochSecond(v) : Instant.ofEpochMilli(v);
  }
}
