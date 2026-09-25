/** Watches a browser-direct stream until it can play, then gives buffering more time. */
export function classifyVodPlayRejection(cause: unknown, transport: string): "gesture" | "ignore" | "retry" | "fail" {
  if (cause instanceof DOMException && cause.name === "NotAllowedError") return "gesture";
  if (cause instanceof DOMException && cause.name === "AbortError") return "ignore";
  if (transport === "hls") return "retry";
  return "fail";
}

export function createDirectPlaybackWatchdog(onFallback: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loadStartedAt: number | undefined;
  let hasMediaProgress = false;
  let hasPlayed = false;
  let needsUserGesture = false;
  let failed = false;
  let disposed = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const fail = () => {
    if (failed || disposed) return;
    failed = true;
    clear();
    onFallback();
  };
  const arm = (delayMs: number) => {
    clear();
    timer = setTimeout(fail, Math.max(0, delayMs));
  };
  const loading = () => {
    if (failed || disposed || hasPlayed || needsUserGesture || loadStartedAt !== undefined) return;
    loadStartedAt = Date.now();
    arm(8_000);
  };
  const waiting = () => {
    if (failed || disposed || needsUserGesture || timer !== undefined) return;
    if (loadStartedAt === undefined) loading();
    else arm(12_000);
  };

  return {
    loading,
    progress: () => {
      if (failed || disposed || hasPlayed || needsUserGesture || hasMediaProgress || timer === undefined || loadStartedAt === undefined) return;
      hasMediaProgress = true;
      arm(12_000 - (Date.now() - loadStartedAt));
    },
    playable: clear,
    awaitingGesture: () => { needsUserGesture = true; clear(); },
    gestureAttempt: () => {
      if (!needsUserGesture || failed || disposed) return;
      needsUserGesture = false;
      hasMediaProgress = false;
      loadStartedAt = Date.now();
      arm(8_000);
    },
    playing: () => { needsUserGesture = false; hasPlayed = true; clear(); },
    waiting,
    error: fail,
    dispose: () => { disposed = true; clear(); }
  };
}
