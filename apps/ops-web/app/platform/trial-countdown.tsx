"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { trackAnalytics } from './analytics';
import { formatTrialSeconds, remainingTrialSeconds, type TrialClock } from './trial-countdown-model';
import s from './trial-countdown.module.css';

export function TrialCountdown({ clock, onExpired, account = false }: { clock: TrialClock | null; onExpired?: () => void | Promise<void>; account?: boolean }) {
  const [value, setValue] = useState<{ clock: TrialClock | null; seconds: number }>({ clock: null, seconds: 0 });
  const notified = useRef(''), refresh = useRef(onExpired); refresh.current = onExpired;
  useEffect(() => {
    if (!clock) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const seconds = remainingTrialSeconds(clock, performance.now()); setValue({ clock, seconds });
      if (!seconds && clock.status === 'active' && notified.current !== clock.endsAt) { notified.current = clock.endsAt; void refresh.current?.(); }
      return seconds;
    };
    const visible = () => { clearInterval(timer); if (document.visibilityState !== 'hidden' && tick() > 0) timer = setInterval(() => { if (!tick()) clearInterval(timer); }, 1000); };
    visible(); document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [clock]);
  if (!clock) return null;
  const seconds = value.clock === clock ? value.seconds : remainingTrialSeconds(clock, performance.now());
  return <div className={`${s.countdown}${account ? ` ${s.account}` : ''}`} data-trial-countdown>
    <span>{seconds ? 'Deneme süren' : 'Deneme sona erdi'}</span>
    <strong role="timer" aria-label="Deneme süren" aria-live="off">{formatTrialSeconds(seconds)}</strong>
    {!account && <Link href="/paketler" onClick={() => trackAnalytics('package_open')}>Paketleri gör<span aria-hidden="true"> →</span></Link>}
  </div>;
}
