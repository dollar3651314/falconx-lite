package com.falconx.lite.account.admin;

import com.falconx.lite.account.api.CustomerAdminApi;
import com.falconx.lite.account.auth.AuthAccess;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.storage.ObjectStorage;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link CustomerAdminApi} 的实现：后台查看客户和 KYC。 */
@Service
class CustomerAdmin implements CustomerAdminApi {

  private final CustomerAdminMapper mapper;
  private final AuthAccess auth;
  private final ObjectStorage storage;

  CustomerAdmin(CustomerAdminMapper mapper, AuthAccess auth, ObjectStorage storage) {
    this.mapper = mapper;
    this.auth = auth;
    this.storage = storage;
  }

  static String name(String first, String middle, String last) {
    StringBuilder sb = new StringBuilder();
    for (String s : new String[] {first, middle, last}) {
      if (s == null || s.isBlank()) continue;
      if (!sb.isEmpty()) sb.append(' ');
      sb.append(s.strip());
    }
    return sb.toString();
  }

  private static Customer customer(CustomerAdminMapper.CustomerRow r) {
    return new Customer(r.id, r.email, name(r.firstName, r.middleName, r.lastName), r.nationality, r.status, r.kycStatus, r.createdAt, r.lastLoginAt);
  }

  private static Long idOf(String keyword) {
    if (keyword == null) return null;
    try {
      return Long.parseLong(keyword);
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private static String blank(String s) {
    return s == null || s.isBlank() ? null : s.strip();
  }

  @Override
  @Transactional(readOnly = true)
  public Page<Customer> customers(String keyword, String status, String kycStatus, int offset, int limit) {
    String kw = blank(keyword);
    Long id = idOf(kw);
    return new Page<>(mapper.customers(kw, id, blank(status), blank(kycStatus), offset, limit).stream().map(CustomerAdmin::customer).toList(),
        mapper.countCustomers(kw, id, blank(status), blank(kycStatus)));
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<CustomerDetail> customer(long id) {
    List<CustomerAdminMapper.CustomerRow> rows = mapper.byIds(List.of(id));
    if (rows.isEmpty()) return Optional.empty();
    CustomerAdminMapper.CustomerRow r = rows.getFirst();
    return Optional.of(new CustomerDetail(customer(r), r.firstName, r.middleName, r.lastName, r.birthDate, r.frozenReason, r.docType, r.docNumber,
        r.kycReviewedAt, r.kycRejectReason));
  }

  @Override
  @Transactional(readOnly = true)
  public Map<Long, Customer> customers(Collection<Long> ids) {
    Map<Long, Customer> out = new LinkedHashMap<>();
    if (ids == null || ids.isEmpty()) return out;
    for (CustomerAdminMapper.CustomerRow r : mapper.byIds(ids.stream().distinct().toList())) out.put(r.id, customer(r));
    return out;
  }

  @Override
  @Transactional(readOnly = true)
  public List<Long> search(String keyword, int limit) {
    String kw = blank(keyword);
    if (kw == null) return List.of();
    return mapper.customers(kw, idOf(kw), null, null, 0, limit).stream().map(r -> r.id).toList();
  }

  @Override
  @Transactional
  public void setFrozen(long userId, boolean frozen, String reason) {
    if (frozen) {
      auth.freeze(userId);
      mapper.setFrozenReason(userId, reason);
    } else {
      auth.unfreeze(userId);
      mapper.setFrozenReason(userId, null);
    }
  }

  private static KycApplication kyc(CustomerAdminMapper.KycRow r) {
    return new KycApplication(r.id, r.userId, name(r.firstName, r.middleName, r.lastName), r.email, r.nationality, r.birthDate, r.docType, r.docNumber,
        r.status, r.submittedAt, r.reviewerId, r.reviewedAt, r.rejectReason);
  }

  @Override
  @Transactional(readOnly = true)
  public Page<KycApplication> kycApplications(String status, String keyword, int offset, int limit) {
    String kw = blank(keyword);
    Long id = idOf(kw);
    return new Page<>(mapper.kycs(blank(status), kw, id, offset, limit).stream().map(CustomerAdmin::kyc).toList(), mapper.countKycs(blank(status), kw, id));
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<KycApplication> kycApplication(long id) {
    return Optional.ofNullable(mapper.kyc(id)).map(CustomerAdmin::kyc);
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<Image> kycImage(long applicationId, String side) {
    CustomerAdminMapper.KycRow r = mapper.kyc(applicationId);
    if (r == null) return Optional.empty();
    String key = switch (side == null ? "" : side) {
      case "front" -> r.frontKey;
      case "back" -> r.backKey;
      case "selfie" -> r.selfieKey;
      default -> throw new BizException("NOT_FOUND", "没有这张照片");
    };
    if (key == null || key.isBlank()) return Optional.empty();
    String type = key.endsWith(".png") ? "image/png" : "image/jpeg";
    byte[] content = storage.get(key);
    return content == null ? Optional.empty() : Optional.of(new Image(content, type));
  }

  @Override
  @Transactional(readOnly = true)
  public long pendingKyc() {
    return mapper.pendingKyc();
  }

  @Override
  @Transactional(readOnly = true)
  public long registeredSince(java.time.LocalDateTime since) {
    return mapper.registeredSince(since);
  }

  @Override
  @Transactional(readOnly = true)
  public long activeSince(java.time.LocalDateTime since) {
    return mapper.activeSince(since);
  }
}
