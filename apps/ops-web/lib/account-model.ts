export type AccountUser = {
  kryptoniteCode?: string | null; status?: string; hasAssignedLink?: boolean;
  hasActiveSubscription?: boolean;
  accessHistory?: { hasPreviousAccess: boolean; lastAccessEndedAt: string | null; hasRequestedTrial: boolean; hasReceivedTrial: boolean; canRequestTrial: boolean };
  activePackage?: { title: string; endsAt: string; remainingDays?: number } | null;
};
type PackageChoice = { slug: string; isActive: boolean };
export type MethodChoice = {
  id: string; enabled: boolean; details?: string | null;
  bankTransfer?: { iban: string | null; recipientName?: string | null; bankName?: string | null } | null;
  cryptoAssets?: { id: string; walletAddress: string | null }[];
};
export function supportUrl(value: unknown, channel: 'whatsapp' | 'telegram'): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (channel === 'whatsapp') {
      if (url.hostname !== 'wa.me' || !/^\/[1-9]\d{7,14}\/?$/.test(url.pathname) || /900000000000/.test(url.pathname)) return null;
    } else if (url.hostname !== 't.me' || !/^\/[a-zA-Z][a-zA-Z0-9_]{3,31}\/?$/.test(url.pathname) || /^\/yourchannel\/?$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function packagePaymentHref(slug: string) { return `/odeme-bildirimi?paket=${encodeURIComponent(slug)}`; }
export function accountState(user: AccountUser | null, now = Date.now()) {
  const expires = Date.parse(user?.activePackage?.endsAt ?? '');
  const active = Boolean(user && user.status !== 'blocked' && user.hasActiveSubscription && Number.isFinite(expires) && expires > now);
  return { code: user?.kryptoniteCode ?? '', active, remainingDays: active ? Math.ceil((expires-now)/86400000) : 0 };
}
export function methodConfigured(method: MethodChoice) {
  if (!method.enabled) return false;
  if (method.id === 'bank-transfer-eft') return Boolean(method.bankTransfer?.iban?.trim() && method.bankTransfer?.recipientName?.trim());
  if (method.id === 'crypto') return Boolean(method.cryptoAssets?.some(asset => asset.walletAddress?.trim()));
  return method.id === 'bank-card' && Boolean(method.details?.trim());
}
export function paymentPayload(pkg: PackageChoice | null | undefined, method: MethodChoice | null | undefined, assetId: string | null, confirmed: boolean) {
  if (!pkg?.isActive) throw new Error('Lütfen geçerli bir paket seçin.');
  if (!method || !methodConfigured(method)) throw new Error('Lütfen kullanılabilir bir ödeme yöntemi seçin.');
  if (!confirmed) throw new Error('Bildirimi göndermeden önce ödemenizi yaptığınızı doğrulayın.');
  if (method.id === 'crypto') {
    if (!method.cryptoAssets?.some(asset => asset.id === assetId && asset.walletAddress?.trim())) throw new Error('Cüzdan bilgisi tanımlı bir kripto varlık seçin.');
    return { packageSlug: pkg.slug, paymentMethodId: method.id, cryptoAssetId: assetId };
  }
  return { packageSlug: pkg.slug, paymentMethodId: method.id };
}
// A failed response may still have been committed by the server. Never retry a POST automatically.
export function createSubmission() {
  let locked = false;
  return { async run(send: () => Promise<{ ok: boolean }>) {
    if (locked) return false;
    locked = true;
    const result = await send();
    if (result?.ok !== true) throw new Error('Bildirim sonucu doğrulanamadı.');
    return true;
  } };
}
export async function copyText(text: string, clipboard: { writeText: (text: string) => Promise<void> }) {
  if (!text) throw new Error('Kopyalanacak bilgi bulunamadı.');
  await clipboard.writeText(text);
}
export function paymentStatus(status: string) {
  return ({ 'pending-review': 'İnceleniyor', approved: 'Onaylandı', rejected: 'Reddedildi' } as Record<string,string>)[status] ?? 'Durum alınamadı';
}
