export type TrialClock = { status: 'active' | 'expired'; endsAt: string; expiresMonotonic: number };
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;

export function createTrialClock(value: unknown, monotonic: number, previous?: TrialClock | null): TrialClock | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(monotonic)) return null;
  const raw = value as Record<string, unknown>, serverNow = date(raw.serverNow), end = date(raw.endsAt);
  if (raw.status !== 'active' && raw.status !== 'expired' || !Number.isFinite(serverNow) || !Number.isFinite(end)) return null;
  if (raw.status === 'active' && end <= serverNow || raw.status === 'expired' && end > serverNow) return null;
  const expiresMonotonic = monotonic + Math.max(0, end - serverNow);
  return { status: raw.status as TrialClock['status'], endsAt: raw.endsAt as string,
    expiresMonotonic: previous && previous.endsAt === raw.endsAt ? Math.min(previous.expiresMonotonic, expiresMonotonic) : expiresMonotonic };
}

export function remainingTrialSeconds(clock: TrialClock, monotonic: number): number {
  return Math.max(0, Math.ceil((clock.expiresMonotonic - monotonic) / 1000));
}

export function formatTrialSeconds(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(part => String(part).padStart(2, '0')).join(':');
}
