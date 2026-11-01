export type EmbeddedCheckoutSession = { sessionId: string; clientSecret: string; publishableKey: string };
export type PackagePaymentStatus = { status: string; packageSlug?: string; endsAt?: string | null };

export function embeddedCheckout(value: unknown): EmbeddedCheckoutSession {
  const result = value as Partial<EmbeddedCheckoutSession> | null;
  const mode = result?.sessionId?.match(/^cs_(live|test)_[A-Za-z0-9]+$/)?.[1];
  if (!mode || typeof result?.clientSecret !== 'string' || result.clientSecret.length > 4096 ||
    !result.clientSecret.startsWith(`${result.sessionId}_secret_`) || /\s/.test(result.clientSecret) ||
    typeof result.publishableKey !== 'string' || !new RegExp(`^pk_${mode}_[A-Za-z0-9]+$`).test(result.publishableKey)) {
    throw new Error('embedded_checkout_invalid');
  }
  return { sessionId: result.sessionId!, clientSecret: result.clientSecret, publishableKey: result.publishableKey };
}

export function packagePaymentMessage(status: string, endsAt?: string | null): { title: string; description: string } {
  switch (status) {
    case 'active': return { title: 'Paketin kullanıma hazır', description: 'Ödemen doğrulandı ve paket hesabına tanımlandı.' };
    case 'awaiting_payment': return { title: 'Ödeme henüz tamamlanmadı', description: 'Açık ödeme ekranından işlemini tamamlayabilirsin.' };
    case 'review_required': return { title: 'Ödemen kontrol ediliyor', description: 'Paket tanımlaması kontrol ediliyor. Lütfen yeniden ödeme yapma; destek ekibimiz yardımcı olacak.' };
    case 'failed': return { title: 'Ödeme tamamlanamadı', description: 'Ödeme durumunu kontrol et. İşlemin beklemedeyse yeniden ödeme yapmadan destek ekibimize ulaş.' };
    case 'expired': return endsAt ? { title: 'Paketinin süresi doldu', description: 'İzlemeye devam etmek için yeni bir paket satın alabilirsin.' } : { title: 'Ödeme ekranının süresi doldu', description: 'Bu ödeme işlemi tamamlanmadı. Paketler sayfasından tekrar başlayabilirsin.' };
    default: return { title: 'Paketin hazırlanıyor', description: 'Ödemen ve paket tanımlaması doğrulanıyor. Lütfen yeniden ödeme yapma; sonuç burada güncellenecek.' };
  }
}
