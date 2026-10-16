package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 安全审查（测试报告/v1-安全审查.md 第 2 节"越权"）：客户 B 拿到客户 A 的持仓、挂单、白名单的 ID，经接口（不是直接调服务）逐个尝试，
 * 全部返回 404，A 的数据不变；B 的列表里看不到 A 的任何东西（实际执行）。
 */
class CustomerIdorTest extends TradingTestSupport {

  final ObjectMapper json = new ObjectMapper();

  MockHttpServletResponse call(MockHttpServletRequestBuilder b, Cookie c, String body) throws Exception {
    b = b.cookie(c);
    if (body != null) b = b.contentType(MediaType.APPLICATION_JSON).content(body);
    return mvc.perform(b).andReturn().getResponse();
  }

  JsonNode body(MockHttpServletResponse r) throws Exception {
    return json.readTree(r.getContentAsString());
  }

  @Test
  void 客户不能读改别人的持仓_挂单_白名单() throws Exception {
    Cookie a = login();
    Cookie b = login();
    // A：一个持仓、一个挂单、一个白名单地址
    MockHttpServletResponse r = call(post("/api/trading/orders"), a,
        "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.01\",\"leverage\":100,\"clientOrderId\":\"idor-m-" + System.nanoTime() + "\"}");
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(200);
    String position = body(call(get("/api/trading/positions"), a, null)).get(0).get("id").asString();
    r = call(post("/api/trading/orders"), a, "{\"symbol\":\"XAUUSD\",\"type\":\"limit\",\"side\":\"buy\",\"lots\":\"0.01\",\"leverage\":100,\"limitPrice\":\"4000.00\","
        + "\"clientOrderId\":\"idor-l-" + System.nanoTime() + "\"}");
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(200);
    String order = body(r).get("id").asString();
    r = call(post("/api/wallet/whitelist"), a, "{\"network\":\"TRC20\",\"address\":\"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\",\"label\":\"a\"}");
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(200);
    String whitelist = body(r).get("id").asString();

    // B 用 A 的 ID 逐个尝试
    assertThat(call(post("/api/trading/positions/" + position + "/close"), b, null).getStatus()).as("平别人的仓").isEqualTo(404);
    assertThat(call(put("/api/trading/positions/" + position + "/tpsl"), b, "{\"takeProfit\":\"5000.00\"}").getStatus()).as("改别人的止盈止损").isEqualTo(404);
    assertThat(call(post("/api/trading/positions/" + position + "/margin"), b, "{\"amount\":\"1\"}").getStatus()).as("给别人追加保证金").isEqualTo(404);
    assertThat(call(put("/api/trading/orders/" + order), b, "{\"limitPrice\":\"4001.00\",\"lots\":\"0.02\"}").getStatus()).as("改别人的挂单").isEqualTo(404);
    assertThat(call(delete("/api/trading/orders/" + order), b, null).getStatus()).as("撤别人的挂单").isEqualTo(404);
    assertThat(call(delete("/api/wallet/whitelist/" + whitelist), b, null).getStatus()).as("删别人的白名单").isEqualTo(404);
    // 用别人的白名单提现：WithdrawFlowTest 已经测过（NOT_WHITELISTED），这里 B 没有 KYC 会先被拦下

    // B 的列表里没有 A 的东西
    assertThat(body(call(get("/api/trading/positions"), b, null)).size()).isZero();
    assertThat(body(call(get("/api/trading/orders"), b, null)).size()).isZero();
    assertThat(body(call(get("/api/wallet/whitelist"), b, null)).size()).isZero();
    assertThat(body(call(get("/api/trading/history"), b, null)).get("total").asLong()).isZero();

    // A 的数据没变
    JsonNode pos = body(call(get("/api/trading/positions"), a, null)).get(0);
    assertThat(pos.get("id").asString()).isEqualTo(position);
    assertThat(pos.get("takeProfit").isNull()).isTrue();
    JsonNode ord = body(call(get("/api/trading/orders"), a, null)).get(0);
    assertThat(ord.get("limitPrice").asString()).isEqualTo("4000.00");
    assertThat(body(call(get("/api/wallet/whitelist"), a, null)).size()).isEqualTo(1);
  }
}
