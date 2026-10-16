package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 客户端资金流水接口（S17 补充）和时间格式统一带时区。 */
class ClientLedgerTest extends TradingTestSupport {

  final ObjectMapper json = new ObjectMapper();

  JsonNode getJson(String url, Cookie c) throws Exception {
    return json.readTree(mvc.perform(get(url).cookie(c)).andReturn().getResponse().getContentAsString());
  }

  @Test
  void 资金流水_按类型和时间筛选_备注里取品种_追加保证金没有记录() throws Exception {
    Cookie c = login();
    String r = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"clientOrderId\":\"l-" + System.nanoTime() + "\"}"))
        .andReturn().getResponse().getContentAsString();
    String positionId = jdbc.queryForObject("SELECT position_id FROM trading_order WHERE id = ?", String.class, json.readTree(r).get("id").asString());
    mvc.perform(post("/api/trading/positions/" + positionId + "/close").cookie(c));

    JsonNode all = getJson("/api/trading/ledger?range=all", c);
    assertThat(all.get("total").asLong()).isEqualTo(3);
    assertThat(all.get("items").get(0).get("type").asString()).isEqualTo("pnl");
    assertThat(all.get("items").get(1).get("type").asString()).isEqualTo("fee");
    assertThat(all.get("items").get(1).get("ref").asString()).isEqualTo("XAUUSD");
    assertThat(all.get("items").get(2).get("type").asString()).isEqualTo("deposit");
    assertThat(all.get("items").get(2).get("time").asString()).endsWith("Z");
    JsonNode fee = getJson("/api/trading/ledger?type=fee&range=7d", c);
    assertThat(fee.get("total").asLong()).isEqualTo(1);
    assertThat(fee.get("items").get(0).get("amount").asString()).startsWith("-");
    assertThat(getJson("/api/trading/ledger?type=margin", c).get("total").asLong()).isZero();
    assertThat(mvc.perform(get("/api/trading/ledger?type=nope").cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(400);
    assertThat(mvc.perform(get("/api/trading/ledger?range=1y").cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(400);
    assertThat(getJson("/api/me/profile", c).get("registeredAt").asString()).as("时间带时区").endsWith("Z");
  }
}
