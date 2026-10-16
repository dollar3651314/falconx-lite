package com.falconx.lite.admin.ops;

import com.falconx.lite.common.error.ValidationException;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/** 后台业务接口的公共小工具：分页、时间和金额格式。 */
final class Ops {

  /** 字段和原型 Page 一致 */
  record Page<T>(List<T> items, long total, int page, int pageSize) {}

  record Slice(int page, int size, int offset) {}

  private Ops() {}

  /** 页码从 1 开始，每页最多 100 条 */
  static Slice slice(int page, int pageSize) {
    int p = Math.max(1, page);
    int s = Math.min(100, Math.max(1, pageSize));
    return new Slice(p, s, (p - 1) * s);
  }

  static String time(LocalDateTime t) {
    return t == null ? null : t.toInstant(ZoneOffset.UTC).toString();
  }

  static String money(BigDecimal v) {
    if (v == null) return null;
    return v.signum() == 0 ? "0" : v.stripTrailingZeros().toPlainString();
  }

  static String blank(String s) {
    return s == null || s.isBlank() ? null : s.strip();
  }

  /** 正数金额，最多 8 位小数；不合法抛字段错误 */
  static BigDecimal amount(String field, String v) {
    try {
      BigDecimal d = new BigDecimal(v == null ? "" : v.strip());
      if (d.signum() > 0 && d.stripTrailingZeros().scale() <= 8 && d.compareTo(new BigDecimal("1000000000")) < 0) return d;
    } catch (NumberFormatException e) {
      // 落到下面
    }
    throw new ValidationException(List.of(new ValidationException.Field(field, "invalid")));
  }

  static String lower(String s) {
    return s == null ? null : s.toLowerCase();
  }
}
