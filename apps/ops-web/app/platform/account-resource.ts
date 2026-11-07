"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import type { AccountUser } from '../../lib/account-model';
import { sessionIdentity } from './personal-integration';
import type { Session } from './types';
import { createTrialClock, type TrialClock } from './trial-countdown-model';

export type AccountSnapshot = { user: AccountUser & { id: string }; trialCountdown?: unknown };
export type SharedAccountResource = { data: AccountSnapshot | null; trialClock: TrialClock | null; loading: boolean; error: boolean; reload: () => void; refresh: (signal?: AbortSignal) => Promise<void> };
type State = { owner: string; data: AccountSnapshot | null; trialClock: TrialClock | null; loading: boolean; error: boolean };

function subject(session: Session | null): string {
  if (session?.user?.id) return session.user.id;
  try { const value = JSON.parse(atob(session!.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof value.sub === 'string' ? value.sub : ''; } catch { return ''; }
}

export function useSharedAccountResource(session: Session | null): SharedAccountResource {
  const owner = sessionIdentity(session), current = useRef({ owner, session }); current.current = { owner, session };
  const alive = useRef(false), flight = useRef<{ owner: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const clock = useRef<{ owner: string; value: TrialClock | null }>({ owner: '', value: null });
  const [state, setState] = useState<State>({ owner: '', data: null, trialClock: null, loading: false, error: false });
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const selected = current.current;
    if (!alive.current || !selected.owner || !selected.session || signal?.aborted) return;
    if (flight.current?.owner === selected.owner) return flight.current.promise;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    const pending = { owner: selected.owner, controller, promise: Promise.resolve() };
    const owned = () => alive.current && current.current.owner === selected.owner;
    const valid = () => owned() && !controller.signal.aborted;
    pending.promise = (async () => {
      try {
        const data = await apiRequest<AccountSnapshot>('/me', { accessToken: selected.session!.accessToken, signal: controller.signal });
        const accountId = subject(selected.session);
        if (!data?.user?.id || typeof data.user.hasAssignedLink !== 'boolean' || typeof data.user.hasActiveSubscription !== 'boolean' || accountId && accountId !== data.user.id) throw new Error('Invalid account response');
        if (!valid()) return;
        const trialClock = createTrialClock(data.trialCountdown, performance.now(), clock.current.owner === selected.owner ? clock.current.value : null);
        clock.current = { owner: selected.owner, value: trialClock };
        setState({ owner: selected.owner, data, trialClock, loading: false, error: false });
      } catch {
        if (owned()) setState(previous => previous.owner === selected.owner && previous.data ? previous : { owner: selected.owner, data: null, trialClock: null, loading: false, error: true });
      } finally { clearTimeout(timeout); if (flight.current === pending) flight.current = null; }
    })();
    flight.current = pending;
    return pending.promise;
  }, []);
  const reload = useCallback(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    alive.current = true;
    setState({ owner, data: null, trialClock: null, loading: Boolean(owner), error: false });
    clock.current = { owner, value: null };
    void refresh();
    const visible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const timer = window.setInterval(visible, 60000);
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); flight.current?.controller.abort(); flight.current = null; };
  }, [owner, refresh]);
  const selected = state.owner === owner ? state : { data: null, trialClock: null, loading: Boolean(owner), error: false };
  return useMemo(() => ({ data: selected.data, trialClock: selected.trialClock, loading: selected.loading, error: selected.error, reload, refresh }), [selected.data, selected.trialClock, selected.loading, selected.error, reload, refresh]);
}
