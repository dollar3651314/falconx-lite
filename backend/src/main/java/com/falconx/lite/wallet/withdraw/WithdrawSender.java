package com.falconx.lite.wallet.withdraw;

import java.math.BigDecimal;

/**
 * 把一笔提现签名并广播到链上。真实实现在 S13b（热钱包、nonce、三条链），S13a 用替身。
 * 结果只有三种，决定提现单下一步：
 * <ul>
 *   <li>{@link Sent}：已广播，等链上确认</li>
 *   <li>{@link Wait}：暂时不能发（例如热钱包余额不够，提现方案 W4），留在"已审核待上链"，下次再试，不退款</li>
 *   <li>{@link Rejected}：确定没有上链（例如节点直接拒绝），失败退款（AC-20）</li>
 * </ul>
 */
public interface WithdrawSender {

  /** 要发的一笔：链上转出 amount − fee 到 address */
  record Order(long withdrawalId, String network, String address, BigDecimal sendAmount) {}

  sealed interface Outcome permits Sent, Wait, Rejected {}

  record Sent(String txHash) implements Outcome {}

  record Wait(String reason) implements Outcome {}

  record Rejected(String reason) implements Outcome {}

  Outcome send(Order order);
}
