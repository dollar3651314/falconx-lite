package com.falconx.lite.common.web;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 对外的健康检查：Nginx、部署脚本和上线后的冒烟检查用它确认应用、数据库、Redis 都可用。
 * 只返回 UP / DOWN，不返回错误详情和内部地址。应用管理端点（actuator）在单独的内网端口，见 application.yml。
 */
@RestController
public class HealthController {

  private final JdbcTemplate jdbc;
  private final RedisConnectionFactory redis;
  private final String version;

  public HealthController(JdbcTemplate jdbc, RedisConnectionFactory redis, @Value("${falconx.version}") String version) {
    this.jdbc = jdbc;
    this.redis = redis;
    this.version = version;
  }

  @GetMapping("/api/health")
  public ResponseEntity<Map<String, Object>> health() {
    boolean db = check(() -> jdbc.queryForObject("SELECT 1", Integer.class));
    boolean cache = check(() -> {
      try (var conn = redis.getConnection()) {
        conn.ping();
      }
    });
    boolean up = db && cache;
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", up ? "UP" : "DOWN");
    body.put("version", version);
    body.put("db", db ? "UP" : "DOWN");
    body.put("redis", cache ? "UP" : "DOWN");
    return ResponseEntity.status(up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).body(body);
  }

  private static boolean check(ThrowingRunnable r) {
    try {
      r.run();
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  @FunctionalInterface
  private interface ThrowingRunnable {
    void run() throws Exception;
  }
}
