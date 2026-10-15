package com.falconx.lite.wallet.address;

import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.WalletProperties;
import com.falconx.lite.wallet.api.WalletApi;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 充值地址（充值方案 D1）：用 Amos 配置的账户级 xpub 按 BIP44 派生，序号 = 用户 ID。
 * 服务器只有公钥，能生成地址、能识别到账，动不了地址里的钱。
 */
@Service
@EnableConfigurationProperties(WalletProperties.class)
public class AddressService implements WalletApi {

  private static final Logger log = LoggerFactory.getLogger(AddressService.class);

  private final AddressMapper mapper;
  private final WalletProperties props;

  AddressService(AddressMapper mapper, WalletProperties props) {
    this.mapper = mapper;
    this.props = props;
  }

  @Override
  @Transactional
  public void allocateAddresses(long userId) {
    if (userId <= 0 || userId > Integer.MAX_VALUE) throw new IllegalArgumentException("用户 ID 超出派生序号范围");
    int index = (int) userId;
    for (Chain.Family f : Chain.Family.values()) {
      String xpub = xpub(f);
      if (xpub == null) {
        log.warn("没有配置 {} 的 xpub，暂不分配充值地址 user={}", f, userId);
        continue;
      }
      String address = derive(f, xpub, index);
      mapper.insertIgnore(userId, f.name(), index, address, Addresses.key(f, address));
    }
  }

  /** 用户在这条链上的充值地址；还没分配时先补分配 */
  @Transactional
  public Optional<String> addressOf(long userId, Chain chain) {
    Optional<String> a = find(userId, chain.family);
    if (a.isPresent()) return a;
    allocateAddresses(userId);
    return find(userId, chain.family);
  }

  /** 链上收款地址属于哪个用户 */
  public Optional<Long> userOf(Chain chain, String address) {
    return Optional.ofNullable(mapper.userOf(chain.family.name(), Addresses.key(chain.family, address)));
  }

  private Optional<String> find(long userId, Chain.Family family) {
    List<AddressMapper.AddressRow> rows = mapper.byUser(userId);
    return rows.stream().filter(r -> r.family().equals(family.name())).map(AddressMapper.AddressRow::address).findFirst();
  }

  private String xpub(Chain.Family f) {
    String x = f == Chain.Family.ETH ? props.ethXpub() : props.tronXpub();
    return x == null || x.isBlank() ? null : x;
  }

  static String derive(Chain.Family f, String xpub, int index) {
    var point = Bip32.receiving(xpub, index);
    return f == Chain.Family.ETH ? Addresses.eth(point) : Addresses.tron(point);
  }
}
