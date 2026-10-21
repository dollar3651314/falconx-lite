package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;

import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.SymbolSpec;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 部分平仓的手数检查和按比例拆分（体验优化 1021 UX-6），不连数据库。
 * 错误码和客户端 web/client/src/lib/validators.ts 的 validateCloseLots 一致（lotsStep、lotsMin、closeLotsMax、closeRemainMin、positiveNumber）。
 */
class CloseLotsTest {

  static BigDecimal d(String s) {
    return new BigDecimal(s);
  }

  static SymbolSpec spec(String minLots, String step) {
    return new SymbolSpec("XAUUSD", "黄金", "Gold", "metal", 2, d("100"), "ounce", "XAU", "USD", 200, d(minLots), d("20"), d(step), d("0.00005"),
        d("0.0025"), BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, true, false, 0);
  }

  static PositionRow position(String lots) {
    PositionRow p = new PositionRow();
    p.lots = d(lots).setScale(8);
    return p;
  }

  static List<String> codes(PositionRow p, SymbolSpec s, String raw) {
    try {
      return List.of(PositionService.closeLots(p, s, raw).stripTrailingZeros().toPlainString());
    } catch (ValidationException e) {
      return e.fields().stream().map(ValidationException.Field::code).toList();
    }
  }

  @Test
  void 不传或等于持仓手数是全部平仓() {
    PositionRow p = position("0.10");
    assertThat(codes(p, spec("0.01", "0.01"), null)).containsExactly("0.1");
    assertThat(codes(p, spec("0.01", "0.01"), " ")).containsExactly("0.1");
    assertThat(codes(p, spec("0.01", "0.01"), "0.1")).containsExactly("0.1");
    assertThat(codes(p, spec("0.01", "0.01"), "0.10")).containsExactly("0.1");
  }

  @Test
  void 边界() {
    PositionRow p = position("0.10");
    SymbolSpec s = spec("0.01", "0.01");
    assertThat(codes(p, s, "0.01")).as("平掉的等于最小手数").containsExactly("0.01");
    assertThat(codes(p, s, "0.09")).as("剩下的等于最小手数").containsExactly("0.09");
    assertThat(codes(p, s, "0.11")).containsExactly("closeLotsMax");
    assertThat(codes(p, s, "0.015")).containsExactly("lotsStep");
    assertThat(codes(p, s, "0.095")).as("步长不对，剩下的 0.005 也小于最小手数").containsExactlyInAnyOrder("lotsStep", "closeRemainMin");
    assertThat(codes(p, s, "-1")).containsExactly("positiveNumber");
    assertThat(codes(p, s, "1e-2")).containsExactly("positiveNumber");
    SymbolSpec big = spec("0.05", "0.01");
    assertThat(codes(p, big, "0.04")).containsExactly("lotsMin");
    assertThat(codes(p, big, "0.06")).containsExactly("closeRemainMin");
    assertThat(codes(p, big, "0.05")).containsExactly("0.05");
    assertThat(codes(p, big, "0.10")).as("全部平仓不受最小手数限制").containsExactly("0.1");
    assertThat(codes(position("0.03"), big, "0.03")).as("持仓本身小于最小手数（改过品种参数）也能全部平仓").containsExactly("0.03");
  }

  @Test
  void 品种参数取不到时只能全部平仓() {
    PositionRow p = position("0.10");
    assertThat(codes(p, null, "0.04")).containsExactlyInAnyOrder("lotsMin", "closeRemainMin");
    assertThat(codes(p, null, "0.10")).containsExactly("0.1");
  }

  @Test
  void 按比例拆_8位小数四舍五入() {
    assertThat(PositionService.share(d("412.685"), d("0.04"), d("0.10"))).isEqualByComparingTo("165.074");
    assertThat(PositionService.share(d("1338.055"), d("0.10"), d("0.30"))).isEqualByComparingTo("446.01833333");
    assertThat(PositionService.share(d("-4.12625"), d("0.04"), d("0.10"))).isEqualByComparingTo("-1.6505");
    assertThat(PositionService.share(d("2"), d("0.02"), d("0.03"))).as("1.3333… 舍去第 9 位").isEqualByComparingTo("1.33333333");
    assertThat(PositionService.share(d("0.00000001"), d("0.01"), d("0.03"))).isEqualByComparingTo("0");
  }
}
