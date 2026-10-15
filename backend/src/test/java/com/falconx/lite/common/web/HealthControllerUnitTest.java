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
    var r = new HealthController(jdbc, redis, "test", java.util.List.of()).health();
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
    var r = new HealthController(jdbc, redis, "test", java.util.List.of()).health();
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
    var r = new HealthController(jdbc, redis, "test", java.util.List.of(wallet)).health();
    assertThat(r.getStatusCode().value()).isEqualTo(503);
    assertThat(r.getBody()).containsEntry("status", "DOWN").containsEntry("wallet", "DOWN").containsEntry("db", "UP");
  }
}
