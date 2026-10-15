package com.falconx.lite.notification.service;

import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.common.task.TaskService;
import com.falconx.lite.notification.api.NotifyAdminApi;
import com.falconx.lite.notification.api.NotifyApi;
import com.falconx.lite.notification.api.NotifyChannel;
import com.falconx.lite.trading.api.UserEventsApi;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 通知（技术方案/v1-通知方案.md）：
 * <ul>
 *   <li>站内信始终发送；存模板编号和变量，打开时按客户当前界面语言生成（切换语言后旧消息也跟着变）。</li>
 *   <li>推送和邮件按客户的开关（X-05），关闭的渠道记为已跳过（AC-25）。推送在 S15b 接上，现在记"没有订阅推送的设备"。</li>
 *   <li>邮件写成 {@code MAIL_SEND} 任务，和业务同一事务；业务提交后由 {@link NotifyWorker} 发出。</li>
 *   <li>每个渠道一条通知记录（后台"通知记录"页面）。</li>
 * </ul>
 */
@Service
class NotifyService implements NotifyApi, NotifyAdminApi {

  static final String MAIL_TASK = "MAIL_SEND";
  static final int MAIL_ATTEMPTS = 5;

  static final String SKIP_PUSH_OFF = "客户关闭了推送";
  static final String SKIP_EMAIL_OFF = "客户关闭了邮件";
  static final String SKIP_NO_DEVICE = "没有订阅推送的设备";

  private static final Logger log = LoggerFactory.getLogger(NotifyService.class);
  private static final TypeReference<Map<String, String>> PARAMS = new TypeReference<>() {};

  /** 站内信，字段和客户端 NotificationItem 一致 */
  record Item(String id, String kind, String title, String body, boolean read, String createdAt) {}

  record Page<T>(List<T> items, long total, int page, int pageSize) {}

  record Prefs(boolean push, boolean email) {}

  private final NotifyMapper mapper;
  private final TaskService tasks;
  private final ObjectMapper json;
  private final UserEventsApi events;
  private final Clock clock;

  NotifyService(NotifyMapper mapper, TaskService tasks, ObjectMapper json, UserEventsApi events, Clock clock) {
    this.mapper = mapper;
    this.tasks = tasks;
    this.json = json;
    this.events = events;
    this.clock = clock;
  }

  private LocalDateTime now() {
    return LocalDateTime.now(clock);
  }

  // ---------- 发送 ----------

  @Override
  @Transactional
  public void toUser(long userId, String template, Map<String, String> params) {
    Rows.TemplateRow t = mapper.template(template);
    if (t == null || !"USER".equals(t.audience)) throw new IllegalArgumentException("不是发给客户的模板：" + template);
    if (!t.enabled) {
      log.info("模板 {} 已停用，不发送 user={}", template, userId);
      return;
    }
    Rows.PrefRow pref = prefRow(userId);
    String title = Render.render(t, params, Render.ZH).title();
    String paramsJson = json.writeValueAsString(params == null ? Map.of() : params);
    if (t.has("INBOX")) {
      Rows.MessageRow m = new Rows.MessageRow();
      m.userId = userId;
      m.kind = t.kind;
      m.templateCode = t.code;
      m.params = paramsJson;
      m.createdAt = now();
      mapper.insertMessage(m);
      record(userId, null, "TEMPLATE", t.code, "INBOX", title, "SENT", null, null);
      afterCommit(() -> pushItem(userId, view(m, t, pref.lang)));
    }
    if (t.has("PUSH")) {
      record(userId, null, "TEMPLATE", t.code, "PUSH", title, "SKIPPED", pref.pushEnabled ? SKIP_NO_DEVICE : SKIP_PUSH_OFF, null);
    }
    if (t.has("EMAIL")) {
      if (!pref.emailEnabled) {
        record(userId, null, "TEMPLATE", t.code, "EMAIL", title, "SKIPPED", SKIP_EMAIL_OFF, null);
      } else {
        long rid = record(userId, null, "TEMPLATE", t.code, "EMAIL", title, "PENDING", null, null);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("recordId", rid);
        p.put("userId", userId);
        p.put("template", t.code);
        p.put("params", params == null ? Map.of() : params);
        p.put("lang", pref.lang);
        enqueueMail(p);
      }
    }
  }

  /** 按邮箱发（验证码、风控人员，{@link AddressMailer}）。不知道收件人语言，中英文各一份 */
  @Transactional
  void sendToAddress(String to, String template, Map<String, String> params) {
    Rows.TemplateRow t = mapper.template(template);
    if (t == null || "USER".equals(t.audience)) throw new IllegalArgumentException("不能按邮箱发的模板：" + template);
    String title = Render.render(t, params, Render.ZH).title();
    long rid = record(null, to, "TEMPLATE", t.code, "EMAIL", title, "PENDING", null, null);
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("recordId", rid);
    p.put("to", to);
    p.put("template", t.code);
    p.put("params", params == null ? Map.of() : params);
    enqueueMail(p);
  }

  @Override
  @Transactional
  public void manual(long userId, Set<NotifyChannel> channels, String title, String body, long operatorId) {
    List<ValidationException.Field> errors = new ArrayList<>();
    if (channels == null || channels.isEmpty()) errors.add(new ValidationException.Field("channels", "required"));
    if (title == null || title.isBlank()) errors.add(new ValidationException.Field("title", "required"));
    else if (title.length() > 200) errors.add(new ValidationException.Field("title", "tooLong"));
    if (body == null || body.isBlank()) errors.add(new ValidationException.Field("body", "required"));
    else if (body.length() > 2000) errors.add(new ValidationException.Field("body", "tooLong"));
    if (!errors.isEmpty()) throw new ValidationException(errors);
    String tt = title.trim();
    String bb = body.trim();
    Rows.PrefRow pref = prefRow(userId);
    if (channels.contains(NotifyChannel.INBOX)) {
      Rows.MessageRow m = new Rows.MessageRow();
      m.userId = userId;
      m.kind = "system";
      m.title = tt;
      m.body = bb;
      m.createdAt = now();
      mapper.insertMessage(m);
      record(userId, null, "MANUAL", null, "INBOX", tt, "SENT", null, operatorId);
      afterCommit(() -> pushItem(userId, view(m, null, pref.lang)));
    }
    if (channels.contains(NotifyChannel.PUSH)) {
      record(userId, null, "MANUAL", null, "PUSH", tt, "SKIPPED", pref.pushEnabled ? SKIP_NO_DEVICE : SKIP_PUSH_OFF, operatorId);
    }
    if (channels.contains(NotifyChannel.EMAIL)) {
      if (!pref.emailEnabled) {
        record(userId, null, "MANUAL", null, "EMAIL", tt, "SKIPPED", SKIP_EMAIL_OFF, operatorId);
      } else {
        long rid = record(userId, null, "MANUAL", null, "EMAIL", tt, "PENDING", null, operatorId);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("recordId", rid);
        p.put("userId", userId);
        p.put("subject", tt);
        p.put("body", bb);
        enqueueMail(p);
      }
    }
  }

  private void enqueueMail(Map<String, Object> payload) {
    tasks.enqueue(MAIL_TASK, json.writeValueAsString(payload), 0, MAIL_ATTEMPTS);
  }

  private long record(Long userId, String recipient, String source, String template, String channel, String title, String status, String error,
      Long operatorId) {
    Rows.RecordRow r = new Rows.RecordRow();
    r.userId = userId;
    r.recipient = recipient;
    r.source = source;
    r.templateCode = template;
    r.channel = channel;
    r.title = title.length() > 200 ? title.substring(0, 200) : title;
    r.status = status;
    r.error = error;
    r.operatorId = operatorId;
    r.createdAt = now();
    mapper.insertRecord(r);
    return r.id;
  }

  /** 新站内信实时推给客户端（{"type":"notification","item":{…}}，和客户端 ServerEvent 一致）；事务提交后再推 */
  private void pushItem(long userId, Item item) {
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("type", "notification");
    e.put("item", item);
    events.send(userId, e);
  }

  private static void afterCommit(Runnable r) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
          r.run();
        }
      });
    } else {
      r.run();
    }
  }

  // ---------- 客户端读取 ----------

  @Transactional(readOnly = true)
  Page<Item> list(long userId, String lang, int page, int pageSize) {
    int p = Math.max(1, page);
    int size = Math.min(100, Math.max(1, pageSize));
    Map<String, Rows.TemplateRow> cache = new LinkedHashMap<>();
    List<Item> items = mapper.messages(userId, (p - 1) * size, size).stream()
        .map(m -> view(m, m.templateCode == null ? null : cache.computeIfAbsent(m.templateCode, mapper::template), lang)).toList();
    return new Page<>(items, mapper.countMessages(userId), p, size);
  }

  @Transactional(readOnly = true)
  long unread(long userId) {
    return mapper.countUnread(userId);
  }

  @Transactional
  void markRead(long userId, long id) {
    mapper.markRead(userId, id, now());
  }

  @Transactional
  void markAllRead(long userId) {
    mapper.markAllRead(userId, now());
  }

  @Transactional(readOnly = true)
  Prefs prefs(long userId) {
    Rows.PrefRow p = prefRow(userId);
    return new Prefs(p.pushEnabled, p.emailEnabled);
  }

  @Transactional
  Prefs setPrefs(long userId, boolean push, boolean email) {
    mapper.upsertPref(userId, push, email);
    return new Prefs(push, email);
  }

  /** 客户端切换语言时告诉服务端，推送和邮件按这个语言生成 */
  @Transactional
  void setLang(long userId, String lang) {
    if (!Render.ZH.equals(lang) && !Render.EN.equals(lang)) throw new ValidationException(List.of(new ValidationException.Field("lang", "invalid")));
    mapper.upsertLang(userId, lang);
  }

  private Rows.PrefRow prefRow(long userId) {
    Rows.PrefRow p = mapper.pref(userId);
    return p == null ? Rows.PrefRow.defaults() : p;
  }

  private Item view(Rows.MessageRow m, Rows.TemplateRow t, String lang) {
    String title = m.title;
    String body = m.body;
    if (t != null) {
      Render.Text text = Render.render(t, json.readValue(m.params == null ? "{}" : m.params, PARAMS), lang);
      title = text.title();
      body = text.body();
    }
    return new Item(String.valueOf(m.id), m.kind, title, body, m.readAt != null, m.createdAt.toInstant(ZoneOffset.UTC).toString());
  }
}
