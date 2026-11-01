export const WELCOME_CAMPAIGN = 'welcome-monthly-50-v1';
export type WelcomeOffer = {
  id: typeof WELCOME_CAMPAIGN;
  packageSlug: '1-ay' | '1-ay-2-kullanici';
  users: 1 | 2;
  durationMonths: 1;
  amountMinor: number;
  regularAmountMinor: number;
  currency: 'try';
};
export type WelcomeOfferStatus = {
  campaign: typeof WELCOME_CAMPAIGN;
  state: 'not_eligible' | 'pending' | 'dismissed' | 'redeemed';
  eligible: boolean;
  offers: WelcomeOffer[];
  catalogue: { movies: number; live: number; series: number };
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseWelcomeOffer(value: unknown): WelcomeOfferStatus {
  const data = record(value);
  const catalogue = record(data?.catalogue);
  if (!data || data.campaign !== WELCOME_CAMPAIGN || typeof data.state !== 'string' || !['not_eligible', 'pending', 'dismissed', 'redeemed'].includes(data.state) ||
      typeof data.eligible !== 'boolean' || !Array.isArray(data.offers) || !catalogue ||
      !['movies', 'live', 'series'].every(key => Number.isSafeInteger(catalogue[key]) && Number(catalogue[key]) >= 0)) throw new Error('welcome_offer_invalid');
  const offers: WelcomeOffer[] = [];
  for (const raw of data.offers) {
    const offer = record(raw);
    const users = offer?.users;
    const dual = users === 2;
    if (!offer || (users !== 1 && users !== 2) || offer.id !== WELCOME_CAMPAIGN || offer.durationMonths !== 1 || offer.currency !== 'try' ||
        offer.packageSlug !== (dual ? '1-ay-2-kullanici' : '1-ay') || offer.amountMinor !== (dual ? 19950 : 12500) ||
        offer.regularAmountMinor !== (dual ? 39900 : 25000) || offers.some(existing => existing.users === users)) throw new Error('welcome_offer_invalid');
    offers.push(offer as unknown as WelcomeOffer);
  }
  if (data.eligible && (offers.length !== 2 || data.state === 'not_eligible' || data.state === 'redeemed')) throw new Error('welcome_offer_invalid');
  return { campaign: WELCOME_CAMPAIGN, state: data.state as WelcomeOfferStatus['state'], eligible: data.eligible, offers,
    catalogue: { movies: Number(catalogue.movies), live: Number(catalogue.live), series: Number(catalogue.series) } };
}

export function welcomeMonthlyOffer(value: unknown, users: 1 | 2): WelcomeOffer | null {
  try {
    const status = parseWelcomeOffer(value);
    return status.eligible && status.state !== 'redeemed' && status.state !== 'not_eligible' ? status.offers.find(offer => offer.users === users) ?? null : null;
  } catch { return null; }
}

export function welcomeEndpointMissing(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 404;
}

export function unavailableWelcomeOffer(): WelcomeOfferStatus {
  return { campaign: WELCOME_CAMPAIGN, state: 'not_eligible', eligible: false, offers: [], catalogue: { movies: 0, live: 0, series: 0 } };
}

export function welcomeUsers(search: string): 1 | 2 {
  return new URLSearchParams(search).get('users') === '2' ? 2 : 1;
}
