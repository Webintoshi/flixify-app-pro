export type TrialCountdown = {
  status: 'none' | 'pending' | 'active' | 'expired' | 'unavailable';
  serverNow: string;
  endsAt: string | null;
};

type TrialContext = {
  isThreeHourTrial: boolean;
  accessUntil: string | null;
  trialProviderExpiresAt?: string | null;
  summary: {
    status?: string;
    hasAssignedLink?: boolean;
    hasActiveSubscription?: boolean;
    trialProvisionStatus?: string | null;
    activePackage?: { title: string; endsAt: string } | null;
  };
};

export function deriveTrialCountdown(context: TrialContext, now = Date.now()): TrialCountdown {
  const serverNow = new Date(now).toISOString();
  const result = (status: TrialCountdown['status'], endsAt: string | null = null): TrialCountdown => ({ status, serverNow, endsAt });
  const user = context.summary;
  if (user.status === 'blocked') return result('none');
  const legacy = user.activePackage?.title === '24 Saat Test';
  if (user.hasActiveSubscription && !context.isThreeHourTrial && !legacy) return result('none');
  if (user.trialProvisionStatus === 'pending') return result('pending');
  if (user.trialProvisionStatus === 'review') return result('unavailable');
  if (!context.isThreeHourTrial && !legacy) return result('none');
  const appEnd = Date.parse(context.accessUntil ?? '');
  const providerEnd = context.isThreeHourTrial ? Date.parse(context.trialProviderExpiresAt ?? '') : appEnd;
  if (!Number.isFinite(appEnd) || !Number.isFinite(providerEnd) || providerEnd > appEnd) return result('unavailable');
  const end = Math.min(appEnd, providerEnd), endsAt = new Date(end).toISOString();
  if (end <= now) return result('expired', endsAt);
  if (!user.hasActiveSubscription || !user.hasAssignedLink) return result('unavailable');
  return result('active', endsAt);
}

export function withTrialCountdown<T extends object>(payload: T, context: TrialContext, now = Date.now()): T & { trialCountdown: TrialCountdown } {
  return { ...payload, trialCountdown: deriveTrialCountdown(context, now) };
}
