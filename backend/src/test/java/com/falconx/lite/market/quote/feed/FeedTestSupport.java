package com.falconx.lite.market.quote.feed;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** 报价源测试共用：假 token（明显不是密钥）、短的心跳和重连时间、记录收到的报价 */
final class FeedTestSupport {

  /** 测试用的假 token：只在测试里出现，不是任何真实服务的密钥 */
  static final String FAKE_TOKEN = "ci_only_fake_token";
  static final Duration WAIT = Duration.ofSeconds(10);
  static final ObjectMapper JSON = JsonMapper.builder().build();

  private FeedTestSupport() {}

  /** 一条收到的报价 */
  record Got(String feed, String code, BigDecimal bid, BigDecimal ask, Instant time) {}

  /** 记下收到的报价 */
  static final class Recorder implements QuoteSink {
    final BlockingQueue<Got> got = new LinkedBlockingQueue<>();

    @Override
    public void onQuote(String feed, String code, BigDecimal bid, BigDecimal ask, Instant time) {
      got.add(new Got(feed, code, bid, ask, time));
    }

    Got next() throws InterruptedException {
      return got.poll(WAIT.toMillis(), TimeUnit.MILLISECONDS);
    }

    /** 短时间内没有报价 */
    Got none() throws InterruptedException {
      return got.poll(300, TimeUnit.MILLISECONDS);
    }
  }

  /** 测试用配置：心跳 200 毫秒、重连 50 毫秒起（最长 400 毫秒）、空闲 idle 断开 */
  static QuoteFeedsProperties props(String alltickFx, String alltickStock, String itickUrl, Duration idle, Map<String, List<String>> routes) {
    return new QuoteFeedsProperties("alltick", Duration.ofSeconds(10), Duration.ofSeconds(30), new BigDecimal("0.005"), Duration.ofSeconds(5), BigDecimal.ONE,
        Duration.ofSeconds(60), Duration.ofMillis(50), Duration.ofMillis(400), idle,
        new QuoteFeedsProperties.AllTick(FAKE_TOKEN, alltickFx, alltickStock, Duration.ofMillis(200), Duration.ofMillis(300)),
        new QuoteFeedsProperties.ITick(FAKE_TOKEN, itickUrl, Duration.ofMillis(200)), QuoteFeedsProperties.Binance.off(), routes);
  }

  /** 币安测试用配置：只开币安（AllTick、iTick 没有 token），心跳 200 毫秒、重连 50 毫秒起 */
  static QuoteFeedsProperties binanceProps(QuoteFeedsProperties.Binance binance, Duration idle, Map<String, List<String>> routes) {
    return new QuoteFeedsProperties("alltick", Duration.ofSeconds(10), Duration.ofSeconds(30), new BigDecimal("0.005"), Duration.ofSeconds(5), BigDecimal.ONE,
        Duration.ofSeconds(60), Duration.ofMillis(50), Duration.ofMillis(400), idle, null, null, binance, routes);
  }

  static void await(String what, BooleanSupplier ok) throws InterruptedException {
    long end = System.nanoTime() + WAIT.toNanos();
    while (System.nanoTime() < end) {
      if (ok.getAsBoolean()) return;
      Thread.sleep(20);
    }
    throw new AssertionError("等了 " + WAIT + " 还没有：" + what);
  }
}
