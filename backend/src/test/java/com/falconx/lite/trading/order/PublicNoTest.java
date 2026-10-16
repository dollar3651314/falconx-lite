package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.falconx.lite.common.id.Snowflake;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 对外编号（v2 第 11.4 节，E11，AC2-22）：新订单、持仓的编号是雪花 ID 字符串，接口里不出现内部自增 id；
 * 路径里用对外编号操作；V22 之前的旧数据（对外编号 = 内部 id）照常显示、照常能操作。
 */
class PublicNoTest extends TradingTestSupport {

  static final long JS_MAX_SAFE = (1L << 53) - 1;
  final ObjectMapper json = new ObjectMapper();

  JsonNode getJson(String path, Cookie c) throws Exception {
    return json.readTree(mvc.perform(get(path).cookie(c)).andReturn().getResponse().getContentAsString());
  }

  JsonNode placeJson(Cookie c, String body) throws Exception {
    var r = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse();
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(200);
    return json.readTree(r.getContentAsString());
  }

  long uid(Cookie c) throws Exception {
    return getJson("/api/me/session", c).get("userId").asLong();
  }

  @Test
  void 新订单和持仓的编号是雪花ID字符串_不是内部id_用编号平仓_历史里也是编号() throws Exception {
    Cookie c = login();
    JsonNode placed = placeJson(c, "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.01\",\"leverage\":100,\"clientOrderId\":\""
        + UUID.randomUUID() + "\"}");
    assertThat(placed.get("id").isString()).as("编号超过 JavaScript 的安全整数，接口里必须是字符串").isTrue();
    long orderNo = Long.parseLong(placed.get("id").asString());
    assertThat(orderNo).isGreaterThan(JS_MAX_SAFE);
    assertThat(Snowflake.nodeOf(orderNo)).isEqualTo(1);
    long orderInternal = orderId(placed.get("id").asString());
    assertThat(orderInternal).isNotEqualTo(orderNo);

    JsonNode pos = getJson("/api/trading/positions", c).get(0);
    assertThat(pos.get("id").isString()).isTrue();
    long posNo = Long.parseLong(pos.get("id").asString());
    long posInternal = jdbc.queryForObject("SELECT position_id FROM trading_order WHERE id = ?", Long.class, orderInternal);
    assertThat(posNo).isGreaterThan(JS_MAX_SAFE).isNotEqualTo(posInternal).isNotEqualTo(orderNo);
    assertThat(positionId(pos.get("id").asString())).isEqualTo(posInternal);
    assertThat(mvc.perform(post("/api/trading/positions/" + posInternal + "/close").cookie(c)).andReturn().getResponse().getStatus())
        .as("内部 id 不能当编号用").isEqualTo(404);
    assertThat(mvc.perform(post("/api/trading/positions/" + posNo + "/close").cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(200);
    assertThat(getJson("/api/trading/history", c).get("items").get(0).get("id").asString()).isEqualTo("P" + posNo);
  }

  @Test
  void 挂单用编号改单撤单_历史里是O加编号() throws Exception {
    Cookie c = login();
    JsonNode placed = placeJson(c, "{\"symbol\":\"XAUUSD\",\"type\":\"limit\",\"side\":\"buy\",\"lots\":\"0.01\",\"leverage\":100,\"limitPrice\":\"4000.00\","
        + "\"clientOrderId\":\"" + UUID.randomUUID() + "\"}");
    String no = placed.get("id").asString();
    assertThat(Long.parseLong(no)).isGreaterThan(JS_MAX_SAFE);
    assertThat(getJson("/api/trading/orders", c).get(0).get("id").asString()).isEqualTo(no);
    assertThat(mvc.perform(put("/api/trading/orders/" + no).cookie(c).contentType(MediaType.APPLICATION_JSON).content("{\"limitPrice\":\"4001.00\",\"lots\":\"0.02\"}"))
        .andReturn().getResponse().getStatus()).isEqualTo(200);
    assertThat(mvc.perform(delete("/api/trading/orders/" + no).cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(200);
    assertThat(getJson("/api/trading/history", c).get("items").get(0).get("id").asString()).isEqualTo("O" + no);
  }

  @Test
  void 旧数据的编号等于内部id_照常显示_照常能操作() throws Exception {
    Cookie c = login();
    long uid = uid(c);
    placeJson(c, "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.01\",\"leverage\":100,\"clientOrderId\":\"" + UUID.randomUUID() + "\"}");
    // 把这个持仓改成 V22 之前的样子：迁移时旧数据补的对外编号就是内部 id
    long internal = jdbc.queryForObject("SELECT id FROM trading_position WHERE user_id = ? AND status = 'OPEN'", Long.class, uid);
    jdbc.update("UPDATE trading_position SET public_no = id WHERE id = ?", internal);
    JsonNode pos = getJson("/api/trading/positions", c).get(0);
    assertThat(pos.get("id").asString()).as("旧编号照常显示").isEqualTo(String.valueOf(internal));
    assertThat(mvc.perform(put("/api/trading/positions/" + internal + "/tpsl").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andReturn().getResponse().getStatus()).as("用旧编号照常能操作").isEqualTo(200);
    assertThat(mvc.perform(post("/api/trading/positions/" + internal + "/close").cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(200);
  }
}
