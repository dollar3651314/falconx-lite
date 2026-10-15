package com.falconx.lite.wallet.address;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 充值地址的 SQL，见 resources/mapper/wallet/AddressMapper.xml。 */
@Mapper
interface AddressMapper {

  record AddressRow(long userId, String family, int addressIndex, String address) {}

  List<AddressRow> byUser(@Param("userId") long userId);

  /** 已经有了就不插（注册重试、并发补分配） */
  int insertIgnore(@Param("userId") long userId, @Param("family") String family, @Param("index") int index, @Param("address") String address,
      @Param("key") String key);

  Long userOf(@Param("family") String family, @Param("key") String key);
}
