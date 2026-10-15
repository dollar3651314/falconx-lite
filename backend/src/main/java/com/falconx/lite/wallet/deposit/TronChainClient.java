package com.falconx.lite.wallet.deposit;

import com.falconx.lite.wallet.address.Base58;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * TRON 的链客户端：全节点 HTTP 接口（TronGrid 等）。只读。
 * 按区块取交易回执（/wallet/gettransactioninfobyblocknum），从日志里找 USDT 合约的 Transfer 事件。
 * TRON 地址在日志里是 20 字节十六进制，加上 0x41 前缀后转成 T 开头的 Base58Check。
 */
class TronChainClient implements ChainClient {

  private static final String TRANSFER_TOPIC = EvmChainClient.TRANSFER_TOPIC.substring(2);

  private final String baseUrl;
  private final ObjectMapper json;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

  TronChainClient(String baseUrl, ObjectMapper json) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    this.json = json;
  }

  @Override
  public long headBlock() {
    return post("/wallet/getnowblock", Map.of()).path("block_header").path("raw_data").path("number").asLong();
  }

  @Override
  public List<TokenTransfer> transfers(long fromBlock, long toBlock, String contract) {
    String contractHex20 = hex20(contract);
    List<TokenTransfer> out = new ArrayList<>();
    for (long b = fromBlock; b <= toBlock; b++) {
      JsonNode infos = post("/wallet/gettransactioninfobyblocknum", Map.of("num", b));
      if (!infos.isArray() || infos.isEmpty()) continue;
      String blockHash = blockHash(b).orElseThrow(() -> new IllegalStateException("区块不存在"));
      for (JsonNode info : infos) {
        JsonNode logs = info.path("log");
        for (int i = 0; i < logs.size(); i++) {
          JsonNode log = logs.get(i);
          JsonNode topics = log.path("topics");
          if (topics.size() < 3 || !TRANSFER_TOPIC.equalsIgnoreCase(topics.get(0).asString())) continue;
          String address = log.path("address").asString();
          String data = log.path("data").asString("");
          out.add(new TokenTransfer(info.path("id").asString(), i, b, blockHash, base58(topics.get(1).asString()), base58(topics.get(2).asString()),
              address.equalsIgnoreCase(contractHex20) ? contract : base58(address), data.isEmpty() ? BigInteger.ZERO : new BigInteger(data, 16)));
        }
      }
    }
    return out;
  }

  @Override
  public Optional<String> blockHash(long blockNumber) {
    JsonNode block = post("/wallet/getblockbynum", Map.of("num", blockNumber));
    String id = block.path("blockID").asString("");
    return id.isEmpty() ? Optional.empty() : Optional.of(id);
  }

  /** T 开头的地址 → 去掉 0x41 前缀的 20 字节十六进制 */
  static String hex20(String base58) {
    byte[] payload = Base58.decodeChecked(base58);
    return HexFormat.of().formatHex(payload, 1, payload.length);
  }

  /** 20 字节（或 32 字节 topic 的后 20 字节）十六进制 → T 开头的地址 */
  static String base58(String hex) {
    String h = hex.length() > 40 ? hex.substring(hex.length() - 40) : hex;
    byte[] payload = HexFormat.of().parseHex("41" + h);
    return Base58.encodeChecked(payload);
  }

  private JsonNode post(String path, Map<String, Object> body) {
    try {
      HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(20)).header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
      if (r.statusCode() != 200) throw new IllegalStateException("TRON 节点返回 HTTP " + r.statusCode() + "（" + path + "）");
      return json.readTree(r.body());
    } catch (java.io.IOException e) {
      throw new IllegalStateException("连接 TRON 节点失败（" + path + "）", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("连接 TRON 节点被中断", e);
    }
  }
}
