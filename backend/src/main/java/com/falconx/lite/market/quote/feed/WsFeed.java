package com.falconx.lite.market.quote.feed;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 一家 WebSocket 报价源的共用部分（技术方案/v2-报价源接入.md 第 5.2 节），用 JDK 自带的 {@code java.net.http.WebSocket}，不加依赖：
 * <ul>
 *   <li>每条连接（{@link Conn}，例如 AllTick 的外汇地址和股票地址）各自连接、心跳、空闲检测、断线重连；</li>
 *   <li>重连按指数退避：{@code reconnect-initial} 起每次翻倍，最长 {@code reconnect-max}，加 0–20% 随机抖动；连上并收到第一条正常回应
 *       （子类调用 {@link #markHealthy}）后清零；</li>
 *   <li>重连后由子类重新订阅（{@link #opened}）；</li>
 *   <li>超过 {@code idle-timeout} 没有收到任何消息（含心跳回应）就断开重连，防止"连接还在但不推数据"。</li>
 * </ul>
 * 线程：所有连接、发送、重连都在这家报价源自己的一个调度线程上做（JDK 的 WebSocket 不允许并发发送）；收到的消息在 HttpClient 的线程上解析。
 * <b>token 不进日志</b>：所有错误信息经过 {@link #redact}。连接活着没有用注入的时钟（测试时钟是固定的），用系统时间。
 */
public abstract class WsFeed implements QuoteFeed {

  private static final Logger log = LoggerFactory.getLogger(WsFeed.class);
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
  private static final long SEND_TIMEOUT_SECONDS = 10;

  /** 一条连接要订阅什么 */
  protected record ChannelSpec(String channel, URI uri, List<String> codes, Duration startDelay) {}

  /** 一条连接 */
  protected final class Conn {
    final String channel;
    final URI uri;
    final List<String> codes;
    final Duration startDelay;
    /** 每次连接 +1，旧连接的回调一律忽略 */
    int gen;
    int failures;
    volatile State state = State.DISCONNECTED;
    volatile WebSocket ws;
    volatile Instant connectedSince;
    volatile Instant lastMessageAt;
    volatile String lastError;
    volatile long reconnects;
    ScheduledFuture<?> heartbeatTask;
    /** 子类自己的状态（例如 iTick 是否已订阅） */
    volatile boolean subscribed;

    Conn(ChannelSpec s) {
      this.channel = s.channel();
      this.uri = s.uri();
      this.codes = List.copyOf(s.codes());
      this.startDelay = s.startDelay();
    }

    public String channel() {
      return channel;
    }

    public List<String> codes() {
      return codes;
    }
  }

  protected final String name;
  protected final QuoteFeedsProperties props;
  private final QuoteSink sink;
  private final HttpClient http;
  private final ScheduledExecutorService scheduler;
  private final List<Conn> conns = new ArrayList<>();
  private final Counter messages;
  private final Counter quotes;
  private final Counter reconnectCount;
  private volatile boolean stopped;
  private volatile Instant lastQuoteAt;

  protected WsFeed(String name, QuoteFeedsProperties props, QuoteSink sink, MeterRegistry metrics, List<ChannelSpec> channels) {
    this.name = name;
    this.props = props;
    this.sink = sink;
    this.http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
    this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "quote-feed-" + name);
      t.setDaemon(true);
      return t;
    });
    for (ChannelSpec s : channels) {
      if (s.codes().isEmpty()) continue;
      Conn c = new Conn(s);
      conns.add(c);
      Gauge.builder("fx.quote.feed.connected", c, x -> x.state == State.CONNECTED ? 1 : 0).description("报价源的这条连接是否已连上（1 是）")
          .tag("feed", name).tag("channel", c.channel).register(metrics);
    }
    this.messages = Counter.builder("fx.quote.feed.messages").description("报价源收到的消息数（含心跳回应）").tag("feed", name).register(metrics);
    this.quotes = Counter.builder("fx.quote.feed.quotes").description("报价源解析出的买卖价条数").tag("feed", name).register(metrics);
    this.reconnectCount = Counter.builder("fx.quote.feed.reconnects").description("报价源断线重连次数").tag("feed", name).register(metrics);
    Gauge.builder("fx.quote.feed.last.message.age", this, WsFeed::lastMessageAgeSeconds).description("报价源最后一条消息距今的秒数")
        .baseUnit("seconds").tag("feed", name).register(metrics);
  }

  // ---- 子类实现 ----

  /** 这家的 token（只用于从错误信息里抹掉） */
  protected abstract String secret();

  /** 握手前加请求头（例如 iTick 的 token） */
  protected WebSocket.Builder handshake(WebSocket.Builder b) {
    return b;
  }

  protected abstract Duration heartbeatInterval();

  /** 连接已建立（调度线程上）：发订阅，或等鉴权 */
  protected abstract void opened(Conn c);

  /** 收到一条完整的文本消息（HttpClient 线程上）；需要发消息时用 {@link #sendLater} */
  protected abstract void received(Conn c, String text);

  /** 心跳消息 */
  protected abstract String heartbeat(Conn c);

  // ---- 对外 ----

  @Override
  public String name() {
    return name;
  }

  @Override
  public void start() {
    for (Conn c : conns) scheduler.schedule(() -> connect(c), c.startDelay.toMillis(), TimeUnit.MILLISECONDS);
  }

  @Override
  public void close() {
    stopped = true;
    scheduler.execute(() -> {
      for (Conn c : conns) {
        c.gen++;
        if (c.heartbeatTask != null) c.heartbeatTask.cancel(false);
        WebSocket ws = c.ws;
        if (ws != null) ws.abort();
        c.ws = null;
        c.state = State.DISCONNECTED;
      }
    });
    scheduler.shutdown();
    try {
      if (!scheduler.awaitTermination(3, TimeUnit.SECONDS)) scheduler.shutdownNow();
    } catch (InterruptedException e) {
      scheduler.shutdownNow();
      Thread.currentThread().interrupt();
    }
  }

  @Override
  public List<ChannelStatus> status() {
    return conns.stream().map(c -> new ChannelStatus(c.channel, c.state, c.codes.size(), c.connectedSince, c.lastMessageAt, c.reconnects, c.lastError))
        .toList();
  }

  @Override
  public Instant lastQuoteAt() {
    return lastQuoteAt;
  }

  // ---- 给子类用 ----

  /** 解析出一条买卖价 */
  protected final void emit(String code, BigDecimal bid, BigDecimal ask, Instant time) {
    lastQuoteAt = Instant.now();
    quotes.increment();
    sink.onQuote(name, code, bid, ask, time);
  }

  /** 这条连接正常工作了（订阅成功、鉴权成功、收到数据）：重连退避清零 */
  protected final void markHealthy(Conn c) {
    c.failures = 0;
  }

  /** 记下错误（不断开），后台和告警里能看到 */
  protected final void noteError(Conn c, String error) {
    c.lastError = redact(error);
  }

  /** 从别的线程发消息：交给调度线程，连接已经换过就不发 */
  protected final void sendLater(Conn c, String text) {
    int gen = c.gen;
    run(() -> {
      if (gen == c.gen) send(c, text);
    });
  }

  /** 延后一段时间在调度线程上做（连接已经换过就不做） */
  protected final void later(Conn c, Duration delay, Runnable r) {
    int gen = c.gen;
    if (stopped) return;
    try {
      scheduler.schedule(() -> {
        if (gen == c.gen && c.state == State.CONNECTED) r.run();
      }, delay.toMillis(), TimeUnit.MILLISECONDS);
    } catch (RejectedExecutionException e) {
      // 已经停止
    }
  }

  /** 调度线程上发送（等发完，最多 10 秒）；失败就断开重连 */
  protected final void send(Conn c, String text) {
    WebSocket ws = c.ws;
    if (ws == null) return;
    try {
      ws.sendText(text, true).get(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    } catch (ExecutionException | java.util.concurrent.TimeoutException | RuntimeException e) {
      failed(c, c.gen, "发送失败：" + describe(e));
    }
  }

  /** 抹掉错误信息里的 token */
  protected final String redact(String s) {
    String t = secret();
    if (s == null) return null;
    return t == null || t.isEmpty() ? s : s.replace(t, "***");
  }

  /** 日志里显示的地址：去掉参数（AllTick 的 token 在参数里） */
  protected static String safeUri(URI u) {
    return u.getScheme() + "://" + u.getAuthority() + (u.getPath() == null ? "" : u.getPath());
  }

  // ---- 连接 ----

  private void connect(Conn c) {
    if (stopped) return;
    int gen = ++c.gen;
    c.state = State.CONNECTING;
    c.subscribed = false;
    CompletableFuture<WebSocket> f;
    try {
      f = handshake(http.newWebSocketBuilder().connectTimeout(CONNECT_TIMEOUT)).buildAsync(c.uri, new Listener(c, gen));
    } catch (RuntimeException e) {
      failed(c, gen, describe(e));
      return;
    }
    f.whenComplete((ws, err) -> {
      if (err != null) run(() -> failed(c, gen, describe(err)));
    });
  }

  private void onOpen(Conn c, int gen, WebSocket ws) {
    if (gen != c.gen || stopped) {
      ws.abort();
      return;
    }
    c.ws = ws;
    c.state = State.CONNECTED;
    c.connectedSince = Instant.now();
    c.lastMessageAt = Instant.now();
    log.info("报价源 {} 的 {} 连接已建立（{}，{} 个品种）", name, c.channel, safeUri(c.uri), c.codes.size());
    long hb = heartbeatInterval().toMillis();
    c.heartbeatTask = scheduler.scheduleAtFixedRate(() -> beat(c, gen), hb, hb, TimeUnit.MILLISECONDS);
    opened(c);
  }

  private void beat(Conn c, int gen) {
    if (gen != c.gen || c.state != State.CONNECTED) return;
    Instant last = c.lastMessageAt;
    if (last != null && Duration.between(last, Instant.now()).compareTo(props.idleTimeout()) > 0) {
      failed(c, gen, "超过 " + props.idleTimeout().toSeconds() + " 秒没有收到任何消息");
      return;
    }
    send(c, heartbeat(c));
  }

  /** 断开并安排重连（调度线程上） */
  private void failed(Conn c, int gen, String reason) {
    if (gen != c.gen) return;
    c.gen++;
    if (c.heartbeatTask != null) c.heartbeatTask.cancel(false);
    WebSocket ws = c.ws;
    c.ws = null;
    if (ws != null) ws.abort();
    c.state = State.DISCONNECTED;
    c.connectedSince = null;
    c.lastError = redact(reason);
    if (stopped) return;
    long delay = backoffMillis(c.failures++);
    c.reconnects++;
    reconnectCount.increment();
    log.warn("报价源 {} 的 {} 连接断开：{}；{} 毫秒后重连", name, c.channel, c.lastError, delay);
    try {
      scheduler.schedule(() -> connect(c), delay, TimeUnit.MILLISECONDS);
    } catch (RejectedExecutionException e) {
      // 已经停止
    }
  }

  /** 交给调度线程；已经停止时忽略 */
  private void run(Runnable r) {
    if (stopped) return;
    try {
      scheduler.execute(r);
    } catch (RejectedExecutionException e) {
      // 已经停止
    }
  }

  long backoffMillis(int failures) {
    long base = props.reconnectInitial().toMillis();
    long max = props.reconnectMax().toMillis();
    long d = failures >= 30 ? max : Math.min(max, base << Math.min(failures, 30));
    return d + (long) (d * 0.2 * ThreadLocalRandom.current().nextDouble());
  }

  private String describe(Throwable e) {
    Throwable t = e;
    while ((t instanceof CompletionException || t instanceof ExecutionException) && t.getCause() != null) t = t.getCause();
    if (t instanceof WebSocketHandshakeException h) return "握手被拒绝，HTTP " + h.getResponse().statusCode();
    return redact(t.getClass().getSimpleName() + (t.getMessage() == null ? "" : "：" + t.getMessage()));
  }

  private double lastMessageAgeSeconds() {
    Instant last = null;
    for (Conn c : conns) if (c.lastMessageAt != null && (last == null || c.lastMessageAt.isAfter(last))) last = c.lastMessageAt;
    return last == null ? Double.NaN : (System.currentTimeMillis() - last.toEpochMilli()) / 1000.0;
  }

  private final class Listener implements WebSocket.Listener {
    private final Conn c;
    private final int gen;
    private final StringBuilder buf = new StringBuilder();

    Listener(Conn c, int gen) {
      this.c = c;
      this.gen = gen;
    }

    @Override
    public void onOpen(WebSocket ws) {
      ws.request(1);
      if (stopped) ws.abort();
      else run(() -> WsFeed.this.onOpen(c, gen, ws));
    }

    @Override
    public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
      buf.append(data);
      if (last) {
        String text = buf.toString();
        buf.setLength(0);
        if (gen == c.gen) {
          c.lastMessageAt = Instant.now();
          messages.increment();
          try {
            received(c, text);
          } catch (RuntimeException e) {
            log.warn("报价源 {} 的 {} 消息解析失败：{}", name, c.channel, redact(String.valueOf(e.getMessage())));
          }
        }
      }
      ws.request(1);
      return null;
    }

    @Override
    public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
      ws.request(1);
      return null;
    }

    @Override
    public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
      run(() -> failed(c, gen, "服务器关闭连接（" + statusCode + (reason == null || reason.isEmpty() ? "" : " " + reason) + "）"));
      return null;
    }

    @Override
    public void onError(WebSocket ws, Throwable error) {
      run(() -> failed(c, gen, describe(error)));
    }
  }
}
