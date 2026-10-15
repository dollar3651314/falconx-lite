package com.falconx.lite.market.kline;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

/** 数据库里存 "1m"、"15m" 这样的周期代码。 */
public class TimeframeTypeHandler extends BaseTypeHandler<Timeframe> {

  @Override
  public void setNonNullParameter(PreparedStatement ps, int i, Timeframe t, JdbcType jdbcType) throws SQLException {
    ps.setString(i, t.code);
  }

  private static Timeframe parse(String s) {
    return s == null ? null : Timeframe.of(s).orElseThrow(() -> new IllegalStateException("未知的 K 线周期：" + s));
  }

  @Override
  public Timeframe getNullableResult(ResultSet rs, String column) throws SQLException {
    return parse(rs.getString(column));
  }

  @Override
  public Timeframe getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
    return parse(rs.getString(columnIndex));
  }

  @Override
  public Timeframe getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
    return parse(cs.getString(columnIndex));
  }
}
