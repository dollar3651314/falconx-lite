package com.falconx.lite.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.jdbc.core.JdbcTemplate;

/** 健康检查的失败分支：数据库或 Redis 不可用时返回 503，且不带错误详情。 */
class HealthControllerUnitTest {

  @Test
  void 数据库不可用时返回503() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), any(Class.class))).thenThrow(new DataAccessResourceFailureException("connection refused 10.0.0.5:3306"));
    RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    when(redis.getConnection()).thenReturn(mock(RedisConnection.class));
    var r = new HealthController(jdbc, redis, "test", "", java.util.List.of()).health();
    assertThat(r.getStatusCode().value()).isEqualTo(503);
    assertThat(r.getBody()).containsEntry("status", "DOWN").containsEntry("db", "DOWN").containsEntry("redis", "UP");
    assertThat(r.getBody().toString()).doesNotContain("10.0.0.5");
  }

  @Test
  void Redis不可用时返回503() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), any(Class.class))).thenReturn(1);
    RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    when(redis.getConnection()).thenThrow(new RedisConnectionFailureException("down"));
    var r = new HealthController(jdbc, redis, "test", "", java.util.List.of()).health();
    assertThat(r.getStatusCode().value()).isEqualTo(503);
    assertThat(r.getBody()).containsEntry("db", "UP").containsEntry("redis", "DOWN");
  }

  @Test
  void 模块检查不通过时返回503_例如钱包配了节点没配USDT合约() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), any(Class.class))).thenReturn(1);
    RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    when(redis.getConnection()).thenReturn(mock(RedisConnection.class));
    com.falconx.lite.common.health.HealthCheck wallet = new com.falconx.lite.common.health.HealthCheck() {
      public String name() { return "wallet"; }
      public boolean ok() { return false; }
    };
    var r = new HealthController(jdbc, redis, "test", "", java.util.List.of(wallet)).health();
    assertThat(r.getStatusCode().value()).isEqualTo(503);
    assertThat(r.getBody()).containsEntry("status", "DOWN").containsEntry("wallet", "DOWN").containsEntry("db", "UP");
  }

  @Test
  void 设置了测试环境标识时返回env字段_没设置时不返回() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), any(Class.class))).thenReturn(1);
    RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    when(redis.getConnection()).thenReturn(mock(RedisConnection.class));
    var test = new HealthController(jdbc, redis, "a1b2c3d", " test ", java.util.List.of()).health();
    assertThat(test.getStatusCode().value()).isEqualTo(200);
    assertThat(test.getBody()).containsEntry("version", "a1b2c3d").containsEntry("env", "test");
    assertThat(test.getBody().keySet()).containsExactly("status", "version", "env", "db", "redis", "alert", "alerts");
    var prod = new HealthController(jdbc, redis, "a1b2c3d", "", java.util.List.of()).health();
    assertThat(prod.getBody()).as("生产不设，返回和以前一样").doesNotContainKey("env");
    assertThat(prod.getBody().keySet()).as("生产不设 env；告警汇总和各项总是返回（E8）").containsExactly("status", "version", "db", "redis", "alert", "alerts");
    assertThat(new HealthController(jdbc, redis, "x", null, java.util.List.of()).health().getBody()).doesNotContainKey("env");
  }

  @Test
  void 业务告警只出现在alerts里_status和HTTP状态码不变_部署脚本不会回滚_E8() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), any(Class.class))).thenReturn(1);
    RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    when(redis.getConnection()).thenReturn(mock(RedisConnection.class));
    com.falconx.lite.common.health.AlertCheck market = () -> java.util.List.of(
        new com.falconx.lite.common.health.AlertCheck.Item("market", "行情全部断流", "Market data stopped", false, "开市的 3 个品种已经 45 秒没有收到任何报价 10.0.0.9"));
    com.falconx.lite.common.health.AlertCheck chain = () -> java.util.List.of(
        new com.falconx.lite.common.health.AlertCheck.Item("node.TRC20", "x", "x", true, "正常"),
        new com.falconx.lite.common.health.AlertCheck.Item("scan.TRC20", "x", "x", true, "正常"));
    com.falconx.lite.common.health.AlertCheck broken = () -> {
      throw new IllegalStateException("检查本身出错");
    };
    var r = new HealthController(jdbc, redis, "v", "", java.util.List.of(), java.util.List.of(market, chain, broken)).health();
    assertThat(r.getStatusCode().value()).as("断流不能让健康检查 503（deploy.sh 会回滚）").isEqualTo(200);
    assertThat(r.getBody()).containsEntry("status", "UP").containsEntry("alert", "ALERT");
    assertThat(r.getBody().get("alerts")).isEqualTo(java.util.Map.of("market", "DOWN", "node.TRC20", "UP", "scan.TRC20", "UP"));
    assertThat(r.getBody().toString()).as("不返回说明和内部信息").doesNotContain("45 秒").doesNotContain("10.0.0.9");

    var ok = new HealthController(jdbc, redis, "v", "", java.util.List.of(), java.util.List.of(chain)).health();
    assertThat(ok.getBody()).containsEntry("alert", "OK");
    var none = new HealthController(jdbc, redis, "v", "", java.util.List.of()).health();
    assertThat(none.getBody()).as("没有配置任何告警项（测试环境没配链、没有报价源）").containsEntry("alert", "OK").containsEntry("alerts", java.util.Map.of());
  }

  @Test
  void 应用本身的检查不通过时仍然是503_和告警无关() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), any(Class.class))).thenThrow(new DataAccessResourceFailureException("down"));
    RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    when(redis.getConnection()).thenReturn(mock(RedisConnection.class));
    var r = new HealthController(jdbc, redis, "v", "", java.util.List.of(), java.util.List.of()).health();
    assertThat(r.getStatusCode().value()).isEqualTo(503);
    assertThat(r.getBody()).containsEntry("status", "DOWN").containsEntry("alert", "OK");
  }
}
