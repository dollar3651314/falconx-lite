package com.falconx.lite.wallet.deposit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.support.FixedClockConfig;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.WalletProperties;
import com.falconx.lite.wallet.address.AddressService;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/** 充值（S12a）：链替身 + 真实 MySQL（C37）。和其他测试共用一个 Spring 上下文。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
class DepositFlowTest {

  static final String ERC20_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  static final String BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
  static final String TRC20_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

  @Autowired DepositService deposits;
  @Autowired DepositMapper mapper;
  @Autowired ChainClients clients;
  @Autowired AddressService addresses;
  @Autowired LedgerApi ledger;
  @Autowired WalletProperties props;
  @Autowired TransactionTemplate tx;
  @Autowired JdbcTemplate jdbc;
  @Autowired MockMvc mvc;
  @MockitoBean MailApi mail;

  @AfterEach
  void cleanup() {
    for (Chain c : Chain.values()) clients.remove(c);
  }

  long newUser() {
    long uid = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 + FLOOR(RAND() * 1000) FROM account_user", Long.class);
    jdbc.update("INSERT INTO account_user (id, email, status) VALUES (?, ?, 'ACTIVE')", uid, "w" + uid + "@example.com");
    ledger.openAccount(uid);
    addresses.allocateAddresses(uid);
    return uid;
  }

  /** 新建一条链替身，扫块从 block 开始 */
  FakeChain chain(Chain c, long block) {
    FakeChain f = new FakeChain(block);
    clients.register(c, f);
    jdbc.update("REPLACE INTO wallet_chain_cursor (chain, last_block) VALUES (?, ?)", c.name(), block - 1);
    return f;
  }

  String status(Chain c, String txHash) {
    return jdbc.queryForObject("SELECT status FROM wallet_deposit WHERE chain = ? AND tx_hash = ?", String.class, c.name(), txHash);
  }

  BigDecimal balance(long uid) {
    return ledger.snapshot(uid).balance();
  }

  static BigInteger usdt6(String v) {
    return new BigDecimal(v).movePointRight(6).toBigIntegerExact();
  }

  @Test
  void ERC20_达到12个确认后入账_之前是待确认() {
    long uid = newUser();
    String to = addresses.addressOf(uid, Chain.ERC20).orElseThrow();
    FakeChain f = chain(Chain.ERC20, 1000);
    String tx = f.transfer(1000, ERC20_USDT, to.toLowerCase(), usdt6("100"));
    deposits.run(Chain.ERC20);
    assertThat(status(Chain.ERC20, tx)).isEqualTo("PENDING");
    f.head = 1010;
    deposits.run(Chain.ERC20);
    assertThat(status(Chain.ERC20, tx)).as("11 个确认").isEqualTo("PENDING");
    assertThat(jdbc.queryForObject("SELECT confirmations FROM wallet_deposit WHERE tx_hash = ?", Integer.class, tx)).isEqualTo(11);
    f.head = 1011;
    deposits.run(Chain.ERC20);
    assertThat(status(Chain.ERC20, tx)).isEqualTo("CREDITED");
    assertThat(balance(uid)).isEqualByComparingTo("100");
    deposits.run(Chain.ERC20);
    assertThat(balance(uid)).as("不会重复入账").isEqualByComparingTo("100");
  }

  @Test
  void 假币不入账_F3_AC08() {
    long uid = newUser();
    String to = addresses.addressOf(uid, Chain.ERC20).orElseThrow();
    FakeChain f = chain(Chain.ERC20, 2000);
    String fake = f.transfer(2000, "0x1111111111111111111111111111111111111111", to, usdt6("500"));
    f.head = 2020;
    deposits.run(Chain.ERC20);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wallet_deposit WHERE tx_hash = ?", Integer.class, fake)).isZero();
    assertThat(balance(uid)).isEqualByComparingTo("0");
  }

  @Test
  void 最小充值1USDT_低于的不入账_AC41() {
    long uid = newUser();
    String to = addresses.addressOf(uid, Chain.ERC20).orElseThrow();
    FakeChain f = chain(Chain.ERC20, 3000);
    String small = f.transfer(3000, ERC20_USDT, to, usdt6("0.99"));
    String ok = f.transfer(3000, ERC20_USDT, to, usdt6("1"));
    f.head = 3020;
    deposits.run(Chain.ERC20);
    assertThat(status(Chain.ERC20, small)).isEqualTo("BELOW_MIN");
    assertThat(status(Chain.ERC20, ok)).isEqualTo("CREDITED");
    assertThat(balance(uid)).isEqualByComparingTo("1");
  }

  @Test
  void 确认前区块被回滚_作废不入账() {
    long uid = newUser();
    String to = addresses.addressOf(uid, Chain.ERC20).orElseThrow();
    FakeChain f = chain(Chain.ERC20, 4000);
    String tx = f.transfer(4000, ERC20_USDT, to, usdt6("50"));
    deposits.run(Chain.ERC20);
    f.reorg(4000);
    f.head = 4020;
    deposits.run(Chain.ERC20);
    assertThat(status(Chain.ERC20, tx)).isEqualTo("DROPPED");
    assertThat(balance(uid)).isEqualByComparingTo("0");
  }

  @Test
  void 同一笔重复扫到只记一次() {
    long uid = newUser();
    String to = addresses.addressOf(uid, Chain.ERC20).orElseThrow();
    FakeChain f = chain(Chain.ERC20, 5000);
    String tx = f.transfer(5000, ERC20_USDT, to, usdt6("20"));
    f.head = 5020;
    deposits.run(Chain.ERC20);
    jdbc.update("UPDATE wallet_chain_cursor SET last_block = 4999 WHERE chain = 'ERC20'");
    deposits.run(Chain.ERC20);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wallet_deposit WHERE tx_hash = ?", Integer.class, tx)).isEqualTo(1);
    assertThat(balance(uid)).isEqualByComparingTo("20");
  }

  @Test
  void BSC和ERC20同一个地址_BSC按18位精度_15个确认() {
    long uid = newUser();
    assertThat(addresses.addressOf(uid, Chain.BSC)).isEqualTo(addresses.addressOf(uid, Chain.ERC20));
    String to = addresses.addressOf(uid, Chain.BSC).orElseThrow();
    FakeChain f = chain(Chain.BSC, 6000);
    String tx = f.transfer(6000, BSC_USDT, to, new BigInteger("5000000000000000000"));
    f.head = 6013;
    deposits.run(Chain.BSC);
    assertThat(status(Chain.BSC, tx)).as("14 个确认").isEqualTo("PENDING");
    f.head = 6014;
    deposits.run(Chain.BSC);
    assertThat(status(Chain.BSC, tx)).isEqualTo("CREDITED");
    assertThat(balance(uid)).isEqualByComparingTo("5");
  }

  @Test
  void TRC20_T开头的地址_19个确认入账_别人的地址不记() {
    long uid = newUser();
    String to = addresses.addressOf(uid, Chain.TRC20).orElseThrow();
    assertThat(to).startsWith("T");
    FakeChain f = chain(Chain.TRC20, 7000);
    String tx = f.transfer(7000, TRC20_USDT, to, usdt6("12.345678"));
    String other = f.transfer(7000, TRC20_USDT, "TXYZnotOurs111111111111111111111", usdt6("99"));
    f.head = 7018;
    deposits.run(Chain.TRC20);
    assertThat(status(Chain.TRC20, tx)).isEqualTo("CREDITED");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wallet_deposit WHERE tx_hash = ?", Integer.class, other)).isZero();
    assertThat(balance(uid)).isEqualByComparingTo("12.345678");
  }

  @Test
  void 没有配置USDT合约的链不扫块_F3() {
    var noContract = new WalletProperties(props.ethXpub(), props.tronXpub(), props.minDeposit(),
        Map.of(Chain.ERC20, new WalletProperties.ChainConfig(null, "", 6, 12, 12, 200, null)));
    DepositService service = new DepositService(mapper, clients, addresses, ledger, noContract, tx);
    FakeChain f = chain(Chain.ERC20, 8000);
    service.run(Chain.ERC20);
    assertThat(f.calls).isZero();
  }

  @SuppressWarnings("unchecked")
  @Test
  void 注册时分配地址_接口返回三条链的地址确认数和最小充值_AC06() throws Exception {
    String email = "dep" + System.nanoTime() + "@example.com";
    mvc.perform(post("/api/auth/email-code").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"purpose\":\"REGISTER\"}"));
    ArgumentCaptor<Map<String, String>> p = ArgumentCaptor.forClass(Map.class);
    verify(mail, atLeastOnce()).send(eq(email), eq("EMAIL_CODE"), p.capture());
    Cookie c = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"code\":\"" + p.getValue().get("code")
        + "\",\"password\":\"password123\",\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-05-01\",\"nationality\":\"CN\"}")).andReturn().getResponse().getCookie("fx_session");
    long uid = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wallet_address WHERE user_id = ?", Integer.class, uid)).as("注册时已分配").isEqualTo(2);
    String body = mvc.perform(get("/api/wallet/addresses").cookie(c)).andReturn().getResponse().getContentAsString();
    String eth = addresses.addressOf(uid, Chain.ERC20).orElseThrow();
    String tron = addresses.addressOf(uid, Chain.TRC20).orElseThrow();
    assertThat(body).contains("{\"network\":\"ERC20\",\"address\":\"" + eth + "\",\"confirmations\":12,\"etaMinutes\":3,\"minDeposit\":\"1\"}")
        .contains("{\"network\":\"BSC\",\"address\":\"" + eth + "\",\"confirmations\":15,\"etaMinutes\":1,\"minDeposit\":\"1\"}")
        .contains("{\"network\":\"TRC20\",\"address\":\"" + tron + "\",\"confirmations\":19,\"etaMinutes\":1,\"minDeposit\":\"1\"}");
    assertThat(mvc.perform(get("/api/wallet/addresses")).andReturn().getResponse().getStatus()).isEqualTo(401);
  }
}
