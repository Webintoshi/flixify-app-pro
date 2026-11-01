export const WELCOME_CAMPAIGN = 'welcome-monthly-50-v1';
export const WELCOME_COUPON_ID = 'flixify_welcome_monthly_50_v1';
export const WELCOME_CATALOGUE = { movies: 11955, live: 12677, series: 1675 } as const;
export type WelcomeCheckoutPin = { offerId: string; couponId: string; amountMinor: number };
export function monthlyWelcomeOffer(packageSlug: string) {
  if (packageSlug !== '1-ay' && packageSlug !== '1-ay-2-kullanici') return null;
  const users = packageSlug === '1-ay' ? 1 as const : 2 as const;
  return { id: WELCOME_CAMPAIGN, packageSlug, users, durationMonths: 1 as const,
    amountMinor: users === 1 ? 12500 : 19950, regularAmountMinor: users === 1 ? 25000 : 39900, currency: 'try' as const };
}
export type WelcomeStatus = { campaign: typeof WELCOME_CAMPAIGN; state: 'not_eligible' | 'pending' | 'dismissed' | 'redeemed'; eligible: boolean; offers: NonNullable<ReturnType<typeof monthlyWelcomeOffer>>[]; catalogue: typeof WELCOME_CATALOGUE };
export function welcomeStatus(row: { dismissed_at: unknown; redeemed_at: unknown; paid: boolean } | null): WelcomeStatus {
  const eligible = Boolean(row && !row.redeemed_at && !row.paid);
  return { campaign: WELCOME_CAMPAIGN, state: !row ? 'not_eligible' : row.redeemed_at || row.paid ? 'redeemed' : row.dismissed_at ? 'dismissed' : 'pending',
    eligible, offers: eligible ? [monthlyWelcomeOffer('1-ay')!, monthlyWelcomeOffer('1-ay-2-kullanici')!] : [], catalogue: WELCOME_CATALOGUE };
}
export function assertWelcomeCoupon(value: { id: string; livemode?: boolean; valid?: boolean; percent_off?: number | null; amount_off?: number | null; duration?: string; redeem_by?: number | null; max_redemptions?: number | null; applies_to?: unknown; deleted?: boolean }, liveMode: boolean): void {
  if (value.deleted || value.id !== WELCOME_COUPON_ID || value.livemode !== liveMode || value.valid !== true || value.percent_off !== 50 ||
      value.amount_off != null || value.duration !== 'once' || value.redeem_by != null || value.max_redemptions != null || value.applies_to != null) throw new Error('welcome_coupon_mismatch');
}
export function checkoutDiscount(session: { discounts?: unknown; amount_subtotal?: number | null; total_details?: { amount_discount?: number } | null }) {
  const values = Array.isArray(session.discounts) ? session.discounts : [];
  const couponIds = values.map(value => {
    if (!value || typeof value !== 'object' || (value as {promotion_code?: unknown}).promotion_code != null) return null;
    const coupon = (value as {coupon?: unknown}).coupon;
    return typeof coupon === 'string' ? coupon : coupon && typeof coupon === 'object' && typeof (coupon as {id?:unknown}).id === 'string' ? (coupon as {id:string}).id : null;
  });
  return { couponIds, amountSubtotal: session.amount_subtotal ?? null, amountDiscount: session.total_details?.amount_discount ?? null };
}
