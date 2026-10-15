package com.falconx.lite.wallet.web;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.web.CurrentUser;
import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.WalletProperties;
import com.falconx.lite.wallet.address.AddressService;
import java.util.ArrayList;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 钱包接口（S12a）：充值地址。字段和客户端 DepositAddress 一致。充值记录在 S12b。 */
@RestController
class WalletController {

  record DepositAddressView(String network, String address, int confirmations, int etaMinutes, String minDeposit) {}

  private final AddressService addresses;
  private final WalletProperties props;

  WalletController(AddressService addresses, WalletProperties props) {
    this.addresses = addresses;
    this.props = props;
  }

  /** 三条链的充值地址、需要的确认数、预计到账分钟数、最小充值金额（AC-06、AC-41） */
  @GetMapping("/api/wallet/addresses")
  List<DepositAddressView> addresses() {
    long uid = CurrentUser.id();
    List<DepositAddressView> out = new ArrayList<>();
    for (Chain c : Chain.values()) {
      WalletProperties.ChainConfig cfg = props.chain(c);
      String address = addresses.addressOf(uid, c).orElseThrow(() -> new BizException("WALLET_NOT_READY", "充值地址暂不可用"));
      int conf = cfg == null ? 0 : cfg.confirmations();
      int eta = cfg == null ? 0 : (int) Math.ceil(conf * cfg.blockSeconds() / 60.0);
      out.add(new DepositAddressView(c.name(), address, conf, eta, props.minDeposit().stripTrailingZeros().toPlainString()));
    }
    return out;
  }
}
