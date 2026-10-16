package com.falconx.lite.common.web;

import com.falconx.lite.common.health.AlertCheck;
import com.falconx.lite.common.health.HealthCheck;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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
 *   <li>{@code alert}、{@code alerts}（E8 监控告警）：业务告警（{@link AlertCheck}：行情全部断流、扫块停滞、链节点连不上、邮件连续发送失败），
 *       每一项 UP / DOWN，汇总 OK / ALERT。<b>告警不影响 {@code status} 和 HTTP 状态码</b>：外部服务出问题时换版本解决不了，
 *       不能让部署脚本把新版本判为失败而回滚（部署脚本只看 {@code status} 和 {@code version}）。没有配置的项不出现。</li>
 * </ul>
 * 这些值都是部署配置写死的普通文字或 UP / DOWN，不含任何密钥、内部地址或错误详情。
 */
@RestController
public class HealthController {

  private static final Logger log = LoggerFactory.getLogger(HealthController.class);

  private final JdbcTemplate jdbc;
  private final RedisConnectionFactory redis;
  private final String version;
  private final String envLabel;
  private final List<HealthCheck> checks;
  private final List<AlertCheck> alerts;

  @Autowired
  public HealthController(JdbcTemplate jdbc, RedisConnectionFactory redis, @Value("${falconx.version}") String version,
      @Value("${falconx.env-label:}") String envLabel, List<HealthCheck> checks, List<AlertCheck> alerts) {
    this.jdbc = jdbc;
    this.redis = redis;
    this.version = version;
    this.envLabel = envLabel == null ? "" : envLabel.strip();
    this.checks = checks;
    this.alerts = alerts;
  }

  public HealthController(JdbcTemplate jdbc, RedisConnectionFactory redis, String version, String envLabel, List<HealthCheck> checks) {
    this(jdbc, redis, version, envLabel, checks, List.of());
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
    Map<String, String> items = new LinkedHashMap<>();
    for (AlertCheck a : alerts) {
      try {
        for (AlertCheck.Item i : a.evaluate()) items.put(i.name(), i.ok() ? "UP" : "DOWN");
      } catch (RuntimeException e) {
        log.warn("告警检查出错 {}", a.getClass().getSimpleName(), e);
      }
    }
    body.put("alert", items.containsValue("DOWN") ? "ALERT" : "OK");
    body.put("alerts", items);
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
