const PACKAGE_COPY = {
  '1-ay': { price: '250 ₺', renewal: 'Tek seferlik ödeme. Otomatik yenilenmez.' },
  '6-ay': { price: '699 ₺', renewal: 'Tek seferlik ödeme. Otomatik yenilenmez.' },
  '12-ay': { price: '999 ₺', renewal: 'Tek seferlik ödeme. Otomatik yenilenmez.' },
  '1-ay-2-kullanici': { price: '399 ₺', renewal: 'Tek seferlik ödeme. Otomatik yenilenmez.' },
  '6-ay-2-kullanici': { price: '999 ₺', renewal: 'Tek seferlik ödeme. Otomatik yenilenmez.' },
  '12-ay-2-kullanici': { price: '1.399 ₺', renewal: 'Tek seferlik ödeme. Otomatik yenilenmez.' }
} as const;

export function packageCopy(slug: string): { price: string; renewal: string } | null {
  return Object.prototype.hasOwnProperty.call(PACKAGE_COPY, slug)
    ? PACKAGE_COPY[slug as keyof typeof PACKAGE_COPY]
    : null;
}

export function paymentResultLabel(status: string): string {
  switch (status) {
    case 'active': return 'Aboneliğiniz etkin';
    case 'past_due': return 'Ödeme tamamlanamadı';
    case 'review_required': return 'Ödemeniz inceleniyor';
    default: return 'Ödemeniz doğrulanıyor';
  }
}

export function checkoutErrorLabel(error: unknown): string {
  let code: string | undefined;
  if (error instanceof Error) {
    try { code = (JSON.parse(error.message) as { error?: string }).error; } catch { /* Network and browser errors are not JSON. */ }
  }
  switch (code) {
    case 'checkout_payment_pending': return 'Ödemeniz doğrulanıyor. Sonuç için Hesabım sayfasını kontrol edin; yeniden ödeme yapmayın.';
    case 'subscription_active': return 'Aboneliğiniz zaten aktif. Paket durumunu Hesabım sayfasından görebilirsiniz.';
    case 'checkout_preparing': return 'Ödeme sayfanız hazırlanıyor. Aynı paketi biraz sonra tekrar açın.';
    case 'checkout_state_unavailable': return 'Ödeme durumu şu anda doğrulanamıyor. Biraz sonra tekrar deneyin; yeniden ödeme yapmayın.';
    default: return 'Ödeme başlatılamadı. Tekrar deneyin veya diğer ödeme yöntemlerine göz atın.';
  }
}
