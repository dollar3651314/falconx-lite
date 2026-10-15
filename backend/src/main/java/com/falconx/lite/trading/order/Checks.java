package com.falconx.lite.trading.order;

import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.SymbolSpec;
import java.math.BigDecimal;
import java.util.regex.Pattern;

/** 下单、改单、改止盈止损共用的字段检查。错误码和客户端翻译键一致。 */
final class Checks {

  private static final Pattern DECIMAL = Pattern.compile("\\d{1,16}(\\.\\d{1,8})?");

  private Checks() {}

  /** 正数，最多 8 位小数。required=false 时空值返回 null */
  static BigDecimal decimal(ValidationException.Collector errs, String field, String raw, boolean required) {
    if (raw == null || raw.isBlank()) {
      if (required) errs.add(field, "required");
      return null;
    }
    String s = raw.trim();
    if (!DECIMAL.matcher(s).matches()) {
      errs.add(field, "positiveNumber");
      return null;
    }
    BigDecimal v = new BigDecimal(s);
    if (v.signum() <= 0) {
      errs.add(field, "positiveNumber");
      return null;
    }
    return v;
  }

  static void lots(ValidationException.Collector errs, SymbolSpec spec, BigDecimal lots) {
    if (lots == null || spec == null) return;
    if (lots.compareTo(spec.minLots()) < 0) errs.add("lots", "lotsMin");
    if (lots.compareTo(spec.maxLots()) > 0) errs.add("lots", "lotsMax");
    if (lots.remainder(spec.lotStep()).signum() != 0) errs.add("lots", "lotsStep");
  }

  /** 价格小数位不能超过品种精度 */
  static void digits(ValidationException.Collector errs, SymbolSpec spec, String field, BigDecimal price) {
    if (price != null && spec != null && price.scale() > spec.digits()) errs.add(field, "priceDigits");
  }

  /** 止盈止损方向：多单 止盈 &gt; 基准 &gt; 止损，空单相反 */
  static void tpSl(ValidationException.Collector errs, Side side, BigDecimal tp, BigDecimal sl, BigDecimal base) {
    boolean buy = side == Side.BUY;
    if (tp != null && (buy ? tp.compareTo(base) <= 0 : tp.compareTo(base) >= 0)) errs.add("takeProfit", buy ? "tpBuy" : "tpSell");
    if (sl != null && (buy ? sl.compareTo(base) >= 0 : sl.compareTo(base) <= 0)) errs.add("stopLoss", buy ? "slBuy" : "slSell");
  }
}
