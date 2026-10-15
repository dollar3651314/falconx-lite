package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import com.falconx.lite.support.FixedClockConfig;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 交易测试的公共部分：真实 MySQL（C37）；时钟固定在 2026-10-14（周三）10:00 UTC：外汇、指数、黄金、加密在交易时段，美股休市。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
abstract class TradingTestSupport {

  static final Instant NOW = FixedClockConfig.NOW;

  @Autowired OrderService orders;
  @Autowired QuoteProcessor processor;
  @Autowired SymbolCatalog catalog;
  @Autowired LedgerApi ledger;
  @Autowired JdbcTemplate jdbc;
  @Autowired MockMvc mvc;
  @MockitoBean MailApi mail;

  void quote(String symbol, String bid, String ask) {
    processor.process(new RawQuote(symbol, new BigDecimal(bid), new BigDecimal(ask), NOW));
  }

  @BeforeEach
  void baseQuotes() {
    quote("XAUUSD", "4126.35", "4126.75");
    quote("USDJPY", "151.840", "151.860");
    quote("EURJPY", "176.400", "176.420");
  }

  long newUser(String deposit) {
    long uid = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) + 1000000 + FLOOR(RAND() * 1000000) FROM account_user", Long.class);
    jdbc.update("INSERT INTO account_user (id, email, status) VALUES (?, ?, 'ACTIVE')", uid, "o" + uid + "@example.com");
    ledger.openAccount(uid);
    if (new BigDecimal(deposit).signum() > 0) {
      ledger.apply(new LedgerCommand(uid, Bucket.BALANCE, new BigDecimal(deposit), LedgerEntryType.DEPOSIT, "TEST", "dep-" + uid, "测试入金"));
    }
    return uid;
  }

  static PlaceOrder market(String symbol, String side, String lots, int lev) {
    return new PlaceOrder(symbol, "market", side, lots, lev, null, null, null, UUID.randomUUID().toString());
  }

  String code(Runnable r) {
    try {
      r.run();
      return "OK";
    } catch (BizException e) {
      return e.code();
    }
  }

  BigDecimal bucket(long uid, String col) {
    return jdbc.queryForObject("SELECT " + col + " FROM trading_account WHERE user_id = ?", BigDecimal.class, uid);
  }

  BigDecimal ledgerSum(long uid, String bucket) {
    return jdbc.queryForObject("SELECT COALESCE(SUM(l.amount), 0) FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.bucket = ?",
        BigDecimal.class, uid, bucket);
  }

  @SuppressWarnings("unchecked")
  Cookie login() throws Exception {
    String email = "t" + System.nanoTime() + "@example.com";
    mvc.perform(post("/api/auth/email-code").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"purpose\":\"REGISTER\"}"));
    ArgumentCaptor<Map<String, String>> p = ArgumentCaptor.forClass(Map.class);
    verify(mail, atLeastOnce()).send(eq(email), eq("EMAIL_CODE"), p.capture());
    Cookie c = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"code\":\"" + p.getValue().get("code")
        + "\",\"password\":\"password123\",\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-05-01\",\"nationality\":\"CN\"}")).andReturn().getResponse().getCookie("fx_session");
    long uid = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    ledger.apply(new LedgerCommand(uid, Bucket.BALANCE, new BigDecimal("1000"), LedgerEntryType.DEPOSIT, "TEST", "dep-" + uid, "测试入金"));
    return c;
  }

  /** 这个客户收到的站内信："模板编号 变量 JSON"，按时间先后 */
  java.util.List<String> notices(long uid) {
    return jdbc.queryForList("SELECT CONCAT(template_code, ' ', params) FROM notify_message WHERE user_id = ? ORDER BY id", String.class, uid);
  }
}
