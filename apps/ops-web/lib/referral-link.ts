const REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{12}$/;

export function buildReferralUrl(origin: string, code: string): string {
  if (!REFERRAL_CODE.test(code)) throw new Error('invalid_referral_code');
  const url = new URL('/kayit-ol', origin);
  url.searchParams.set('ref', code);
  return url.toString();
}

export function readReferralCode(search: string): string | null {
  const code = new URLSearchParams(search).get('ref')?.toUpperCase() ?? '';
  return REFERRAL_CODE.test(code) ? code : null;
}
