package com.falconx.lite.market.kline;

import java.util.Optional;

/** K 线周期（沿用现有系统，功能地图 M-10）：桶的起点按 UTC 向下取整；4h 起点是 UTC 0/4/8/12/16/20 点，1d 是 UTC 0 点。 */
public enum Timeframe {
  M1("1m", 60),
  M5("5m", 300),
  M15("15m", 900),
  H1("1h", 3600),
  H4("4h", 14400),
  D1("1d", 86400);

  public final String code;
  public final long seconds;

  Timeframe(String code, long seconds) {
    this.code = code;
    this.seconds = seconds;
  }

  public long bucket(long epochSecond) {
    return Math.floorDiv(epochSecond, seconds) * seconds;
  }

  public static Optional<Timeframe> of(String code) {
    for (Timeframe t : values()) if (t.code.equals(code)) return Optional.of(t);
    return Optional.empty();
  }
}
