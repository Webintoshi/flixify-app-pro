type DeadlineTimer = ReturnType<typeof setTimeout> | number;

type DeadlineEnvironment = {
  now: () => number;
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  visibility: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  schedule: (callback: () => void, delay: number) => DeadlineTimer;
  clear: (timer: DeadlineTimer) => void;
};

/** An absolute access cutoff, independent of media progress or background timer delays. */
export function createDirectPlaybackDeadline(expiresAt: string | null | undefined, onExpire: () => void, environment?: DeadlineEnvironment) {
  let disposed = false;
  let expired = false;
  let timer: DeadlineTimer | undefined;
  const env: DeadlineEnvironment = environment ?? {
    now: Date.now,
    events: window,
    visibility: document,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    clear: timer => window.clearTimeout(timer)
  };
  const cutoff = expiresAt == null ? null : Date.parse(expiresAt);
  const dispose = () => {
    disposed = true;
    if (timer !== undefined) env.clear(timer);
    timer = undefined;
    env.events.removeEventListener("focus", check);
    env.events.removeEventListener("pageshow", check);
    env.visibility.removeEventListener("visibilitychange", check);
  };
  function check() {
    if (disposed || cutoff === null) return;
    if (timer !== undefined) env.clear(timer);
    timer = undefined;
    const remaining = cutoff - env.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expired = true;
      dispose();
      onExpire();
    } else timer = env.schedule(check, Math.min(remaining, 2_147_483_647));
  }
  if (cutoff !== null) {
    env.events.addEventListener("focus", check);
    env.events.addEventListener("pageshow", check);
    env.visibility.addEventListener("visibilitychange", check);
    check();
  }
  return { dispose, get expired() { return expired; } };
}
