package archfixture.good.trading;

import archfixture.good.account.api.AccountApi;

/** 正例：trading 模块只通过 account 的 api 包调用。 */
public class PlaceOrder {
  private final AccountApi accounts;

  public PlaceOrder(AccountApi accounts) {
    this.accounts = accounts;
  }

  public long run(long userId) {
    return accounts.balance(userId);
  }
}
