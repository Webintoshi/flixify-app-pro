export function canUseClientIpPlayback(
  context: {
    canPlay: boolean;
    accessUntil: string | null;
    isThreeHourTrial: boolean;
    trialProviderExpiresAt?: string | null;
  },
  now = Date.now()
): boolean {
  const accessUntil = context.accessUntil ? Date.parse(context.accessUntil) : NaN;
  if (!context.canPlay || !Number.isFinite(now) || !Number.isFinite(accessUntil) || accessUntil <= now) return false;
  if (!context.isThreeHourTrial) return true;
  const providerUntil = context.trialProviderExpiresAt ? Date.parse(context.trialProviderExpiresAt) : NaN;
  return Number.isFinite(providerUntil) && providerUntil > now && providerUntil <= accessUntil;
}

export function getVerifiedTrialProviderExpiry(identity: {
  userId: string;
  jobUserId: string | null;
  status: string | null;
  providerLineId: string | null;
  providerExpiresAt: string | Date | null;
  jobUsername: string | null;
  jobPassword: string | null;
  username: string | null;
  password: string | null;
  sharedUsername: string | null;
  sharedPassword: string | null;
}): string | null {
  if (identity.status !== "completed" || !identity.providerLineId?.trim() || identity.userId !== identity.jobUserId ||
      !identity.username || !identity.password || identity.username !== identity.jobUsername || identity.password !== identity.jobPassword ||
      (identity.username === identity.sharedUsername && identity.password === identity.sharedPassword)) return null;
  const expiry = identity.providerExpiresAt instanceof Date ? identity.providerExpiresAt.getTime() : Date.parse(identity.providerExpiresAt ?? "");
  return Number.isFinite(expiry) ? new Date(expiry).toISOString() : null;
}
