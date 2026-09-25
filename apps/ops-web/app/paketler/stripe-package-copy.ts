const PACKAGE_COPY = {
  '1-ay': { price: '249 TL', renewal: 'Her ay otomatik yenilenir.' },
  '3-ay': { price: '640 TL', renewal: 'Her 3 ayda bir otomatik yenilenir.' },
  '6-ay': { price: '990 TL', renewal: 'Her 6 ayda bir otomatik yenilenir.' },
  '12-ay': { price: '1.600 TL', renewal: 'Her 12 ayda bir otomatik yenilenir.' }
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
    default: return 'Abonelik başlatılamadı. Tekrar deneyin veya diğer ödeme yöntemlerine göz atın.';
  }
}
