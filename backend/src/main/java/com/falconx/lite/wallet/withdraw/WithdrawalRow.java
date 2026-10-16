package com.falconx.lite.wallet.withdraw;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** wallet_withdrawal 一行。 */
class WithdrawalRow {
  Long id;
  /** 对外编号（雪花 ID；V22 之前的旧数据等于 id） */
  Long publicNo;
  long userId;
  String network;
  String address;
  BigDecimal amount;
  BigDecimal fee;
  String status;
  LocalDateTime coolingEndsAt;
  LocalDateTime delayEndsAt;
  String txHash;
  String rejectReason;
  LocalDateTime createdAt;
}
