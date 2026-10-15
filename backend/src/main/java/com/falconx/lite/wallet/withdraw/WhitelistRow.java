package com.falconx.lite.wallet.withdraw;

import java.time.LocalDateTime;

/** wallet_whitelist 一行。 */
class WhitelistRow {
  Long id;
  long userId;
  String network;
  String address;
  String addressKey;
  String label;
  LocalDateTime activeAt;
  LocalDateTime createdAt;
}
