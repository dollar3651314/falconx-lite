package com.falconx.lite.market.quote.feed;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 真实报价源（application.yml 的 falconx.market.feeds，技术方案/v2-报价源接入.md）。token 只从环境变量来，空 = 不用这家。
 *
 * @param primary AllTick、iTick 之间谁在前（alltick / itick）：每个品种的映射里这两家按它对调，其他报价源（币安）的位置按映射里写的不动
 *     （所以 10 个加密货币始终是"币安、AllTick、iTick"或"币安、iTick、AllTick"）
 * @param failoverAfter 主源这个品种多久没报价就切到备源
 * @param failbackAfter 主源重新连续报价多久后切回主源
 * @param maxDeviation 两家中间价的最大偏差（比例，0.005 = 0.5%），超过时这个品种暂停开仓（平仓、止盈止损、强平照常，用主源价格）
 * @param crossCheckMaxAge 两家的报价都在这个时间以内才做交叉校验
 * @param usdtUsdRate USDT 计价的映射（代码以 USDT 结尾）乘的系数；Amos 2026-10-17 确认 USDT 按 1:1 当 USD
 * @param silenceAlert 开市时一家报价源多久没给任何报价算告警（quote.alltick / quote.itick）
 * @param reconnectInitial 断线重连的第一次等待时间，之后每次翻倍
 * @param reconnectMax 断线重连的最长等待时间
 * @param idleTimeout 一条连接多久没收到任何消息（含心跳回应）就断开重连
 * @param binance 币安公开行情（不需要 token，用启用开关，技术方案/v2-报价源接入.md 第 12 节）
 * @param routes 品种 → [主源, 备源, 第三候补] 映射，每项写成 "报价源:连接:代码"，例如 "alltick:fx:EURUSD"、"itick:forex:EURUSD$GB"、
 *     "binance:spot:BTCUSDT"；{@link QuoteRouter} 只用排在最前面的两个可用的源（没配 token / 没打开开关的跳过）
 */
@ConfigurationProperties(prefix = "falconx.market.feeds")
public record QuoteFeedsProperties(String primary, Duration failoverAfter, Duration failbackAfter, BigDecimal maxDeviation, Duration crossCheckMaxAge,
    BigDecimal usdtUsdRate, Duration silenceAlert, Duration reconnectInitial, Duration reconnectMax, Duration idleTimeout, AllTick alltick, ITick itick,
    Binance binance, Map<String, List<String>> routes) {

  /**
   * AllTick。
   *
   * @param fxUrl 外汇、贵金属、原油、CFD 指数、加密货币的地址（token 由程序加在 URL 参数里）
   * @param stockUrl 美股的地址
   * @param heartbeat 心跳间隔（文档要求每 10 秒）
   * @param channelGap 两条连接之间的请求至少隔多久（文档要求 3 秒）
   */
  public record AllTick(String token, String fxUrl, String stockUrl, Duration heartbeat, Duration channelGap) {
    public AllTick {
      token = token == null ? "" : token.strip();
      fxUrl = blank(fxUrl) ? "wss://quote.alltick.co/quote-b-ws-api" : fxUrl.strip();
      stockUrl = blank(stockUrl) ? "wss://quote.alltick.co/quote-stock-b-ws-api" : stockUrl.strip();
      heartbeat = heartbeat == null ? Duration.ofSeconds(10) : heartbeat;
      channelGap = channelGap == null ? Duration.ofSeconds(3) : channelGap;
    }
  }

  /**
   * iTick。
   *
   * @param url 地址前缀，后面接 /forex、/indices、/crypto、/stock（token 放在请求头）
   * @param heartbeat 心跳间隔（文档要求至少每 30 秒）
   */
  public record ITick(String token, String url, Duration heartbeat) {
    public ITick {
      token = token == null ? "" : token.strip();
      url = blank(url) ? "wss://api.itick.org" : stripSlash(url.strip());
      heartbeat = heartbeat == null ? Duration.ofSeconds(20) : heartbeat;
    }
  }

  /**
   * 币安公开行情（技术方案/v2-报价源接入.md 第 12 节）。公开行情不需要 API Key，所以没有 token，用 {@code enabled} 开关；
   * <b>默认关闭</b>：不改变现有环境的行为，也避开条款风险（币安公开数据是非商业许可），由 Amos 决定何时打开。
   *
   * @param enabled 现货（{@code spot} 连接）开关，{@code FX_QUOTE_BINANCE_ENABLED}
   * @param spotUrl 现货 WebSocket 地址（只读行情专用域名，美国也能连），后面自动接 {@code /stream?streams=…}
   * @param futuresEnabled USDⓈ-M 永续（{@code futures} 连接）开关，默认关闭；同时要求 {@code enabled}。Amos 2026-10-17 决定不用币安永续给
   *     贵金属、原油、美股报价，所以默认映射里没有任何品种用它，代码保留
   * @param futuresUrl 永续 WebSocket 地址（bookTicker 走 {@code /public} 路由），后面自动接 {@code /stream?streams=…}
   * @param heartbeat 多久发一次 {@code LIST_SUBSCRIPTIONS} 确认连接活着（现货每条连接每秒最多 5 条客户端消息，30 秒一次远低于上限）
   * @param maxStreamsPerConnection 一条连接最多订阅几个流（官方上限 1024，留余量也让 URL 不太长），超过就分成多条连接
   * @param maxConnectionAge 一条连接用多久后主动换新连接（官方：一条连接只保持 24 小时，到点服务器会断开），默认 23 小时
   */
  public record Binance(boolean enabled, String spotUrl, boolean futuresEnabled, String futuresUrl, Duration heartbeat, int maxStreamsPerConnection,
      Duration maxConnectionAge) {
    public Binance {
      spotUrl = blank(spotUrl) ? "wss://data-stream.binance.vision" : stripSlash(spotUrl.strip());
      futuresUrl = blank(futuresUrl) ? "wss://fstream.binance.com/public" : stripSlash(futuresUrl.strip());
      heartbeat = heartbeat == null ? Duration.ofSeconds(30) : heartbeat;
      maxStreamsPerConnection = maxStreamsPerConnection <= 0 ? 200 : Math.min(maxStreamsPerConnection, 1024);
      maxConnectionAge = maxConnectionAge == null ? Duration.ofHours(23) : maxConnectionAge;
    }

    /** 全部默认（关闭） */
    public static Binance off() {
      return new Binance(false, null, false, null, null, 0, null);
    }
  }

  /** 映射里的一项 */
  public record Route(String feed, String channel, String code) {

    /** 解析 "报价源:连接:代码"（代码里可以有 $ 和 .，不能有冒号） */
    static Route parse(String symbol, String s) {
      String[] p = s == null ? new String[0] : s.strip().split(":");
      if (p.length != 3 || p[0].isBlank() || p[1].isBlank() || p[2].isBlank()) {
        throw new IllegalArgumentException("falconx.market.feeds.routes." + symbol + " 的 \"" + s + "\" 格式不对，应为 报价源:连接:代码");
      }
      return new Route(p[0].strip().toLowerCase(Locale.ROOT), p[1].strip().toLowerCase(Locale.ROOT), p[2].strip());
    }
  }

  public QuoteFeedsProperties {
    primary = blank(primary) ? AllTickFeed.NAME : primary.strip().toLowerCase(Locale.ROOT);
    failoverAfter = failoverAfter == null ? Duration.ofSeconds(10) : failoverAfter;
    failbackAfter = failbackAfter == null ? Duration.ofSeconds(30) : failbackAfter;
    maxDeviation = maxDeviation == null ? new BigDecimal("0.005") : maxDeviation;
    crossCheckMaxAge = crossCheckMaxAge == null ? Duration.ofSeconds(5) : crossCheckMaxAge;
    usdtUsdRate = usdtUsdRate == null || usdtUsdRate.signum() <= 0 ? BigDecimal.ONE : usdtUsdRate;
    silenceAlert = silenceAlert == null ? Duration.ofSeconds(60) : silenceAlert;
    reconnectInitial = reconnectInitial == null ? Duration.ofSeconds(1) : reconnectInitial;
    reconnectMax = reconnectMax == null ? Duration.ofSeconds(60) : reconnectMax;
    idleTimeout = idleTimeout == null ? Duration.ofSeconds(60) : idleTimeout;
    alltick = alltick == null ? new AllTick(null, null, null, null, null) : alltick;
    itick = itick == null ? new ITick(null, null, null) : itick;
    binance = binance == null ? Binance.off() : binance;
    routes = routes == null ? Map.of() : Map.copyOf(routes);
  }

  /** 这家报价源能用没有：AllTick、iTick 看有没有 token，币安看启用开关 */
  public boolean configured(String feed) {
    return switch (feed) {
      case AllTickFeed.NAME -> !alltick.token().isEmpty();
      case ITickFeed.NAME -> !itick.token().isEmpty();
      case BinanceFeed.NAME -> binance.enabled();
      default -> false;
    };
  }

  /** 映射里的这一项能用没有：报价源能用；币安永续还要单独打开 {@code futures-enabled} */
  public boolean usable(Route r) {
    if (!configured(r.feed())) return false;
    return !(BinanceFeed.NAME.equals(r.feed()) && BinanceFeed.FUTURES.equals(r.channel())) || binance.futuresEnabled();
  }

  /**
   * 每个品种的映射（AllTick、iTick 之间按 {@link #primary} 排先后，其他报价源按写的位置）；格式不对时抛异常（启动失败，避免配错了却悄悄没有报价）。
   * 没配 token、没打开开关的报价源也在里面（由 {@link QuoteRouter} 用 {@link #usable} 过滤）。
   */
  public Map<String, List<Route>> parsedRoutes() {
    Map<String, List<Route>> out = new LinkedHashMap<>();
    routes.forEach((symbol, list) -> {
      List<Route> rs = new ArrayList<>();
      for (String s : list == null ? List.<String>of() : list) {
        Route r = Route.parse(symbol, s);
        if (rs.stream().anyMatch(x -> x.feed().equals(r.feed()))) {
          throw new IllegalArgumentException("falconx.market.feeds.routes." + symbol + " 里 " + r.feed() + " 出现了两次");
        }
        rs.add(r);
      }
      out.put(symbol.strip().toUpperCase(Locale.ROOT), List.copyOf(swapPrimary(rs)));
    });
    return out;
  }

  /** AllTick、iTick 两家之间按 {@link #primary} 排先后（只在它们原来的位置之间对调），其他报价源的位置不动 */
  private List<Route> swapPrimary(List<Route> rs) {
    List<Integer> pos = new ArrayList<>();
    List<Route> pair = new ArrayList<>();
    for (int i = 0; i < rs.size(); i++) {
      String f = rs.get(i).feed();
      if (f.equals(AllTickFeed.NAME) || f.equals(ITickFeed.NAME)) {
        pos.add(i);
        pair.add(rs.get(i));
      }
    }
    pair.sort((a, b) -> Boolean.compare(!a.feed().equals(primary), !b.feed().equals(primary)));
    for (int i = 0; i < pos.size(); i++) rs.set(pos.get(i), pair.get(i));
    return rs;
  }

  private static boolean blank(String s) {
    return s == null || s.isBlank();
  }

  private static String stripSlash(String s) {
    return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
  }
}
