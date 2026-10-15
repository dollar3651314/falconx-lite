package com.falconx.lite.trading.order;

/**
 * 下单请求，字段和客户端 PlaceOrderRequest 一致。数字用字符串传，避免浮点误差。
 *
 * @param type market / limit
 * @param side buy / sell
 * @param clientOrderId 客户端生成的幂等键：同一次提交重试时不变，重复提交只下一次单
 */
record PlaceOrder(String symbol, String type, String side, String lots, Integer leverage, String limitPrice, String takeProfit,
    String stopLoss, String clientOrderId) {

  /**
   * 下单结果。
   *
   * @param kind filled（市价成交）/ pending（限价挂单）
   * @param price 成交价，只有 filled 有
   */
  record Result(String kind, String id, String price) {}
}
