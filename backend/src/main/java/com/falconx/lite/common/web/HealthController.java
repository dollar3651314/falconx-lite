package com.falconx.lite.common.web;

import com.falconx.lite.common.health.HealthCheck;
import java.util.LinkedHashMap;
import java.util.List;
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
 * 只返回 UP / DOWN，不返回错误详情和内部地址。各模块可以加自己的检查（{@link HealthCheck}，例如钱包合约没配置）。应用管理端点（actuator）在单独的内网端口，见 application.yml。
 * <ul>
 *   <li>{@code version}：部署时是镜像的 git 提交号（{@code FX_VERSION}），本地和测试里是 Maven 的 project.version。用来从外部确认新版本已经生效（部署方案第 8 节）。</li>
 *   <li>{@code env}：测试环境标识（{@code FX_ENV_LABEL}，测试环境是 {@code test}）。<b>没有设置时（生产）不返回这个字段</b>，生产的返回和以前一样。
 *       前端在真实接口模式下据此显示"测试环境"标识条。</li>
 * </ul>
 * 这两个值都是部署配置写死的普通文字，不含任何密钥或内部地址。
 */
@RestController
public class HealthController {

  private final JdbcTemplate jdbc;
  private final RedisConnectionFactory redis;
  private final String version;
  private final String envLabel;
  private final List<HealthCheck> checks;

  public HealthController(JdbcTemplate jdbc, RedisConnectionFactory redis, @Value("${falconx.version}") String version,
      @Value("${falconx.env-label:}") String envLabel, List<HealthCheck> checks) {
    this.jdbc = jdbc;
    this.redis = redis;
    this.version = version;
    this.envLabel = envLabel == null ? "" : envLabel.strip();
    this.checks = checks;
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
    body.put("status", "UP");
    body.put("version", version);
    if (!envLabel.isEmpty()) body.put("env", envLabel);
    body.put("db", db ? "UP" : "DOWN");
    body.put("redis", cache ? "UP" : "DOWN");
    for (HealthCheck c : checks) {
      boolean ok = check(() -> {
        if (!c.ok()) throw new IllegalStateException();
      });
      body.put(c.name(), ok ? "UP" : "DOWN");
      up &= ok;
    }
    body.put("status", up ? "UP" : "DOWN");
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
