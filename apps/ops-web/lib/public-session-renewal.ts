import { publicSessionRefreshDelay, refreshPublicSession } from "./api";

export function startPublicSessionRenewal() {
  let disposed = false, running = false, retryAt = 0;
  let timer: number | undefined;
  const clear = () => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => { clear(); timer = window.setTimeout(() => void check(), Math.max(1000, Math.min(delay, 3_600_000))); };
  async function check() {
    if (disposed || running) return;
    clear();
    const delay = publicSessionRefreshDelay();
    if (delay === null) return;
    if (delay > 0) { retryAt = 0; schedule(delay); return; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { schedule(30_000); return; }
    if (Date.now() < retryAt) { schedule(retryAt - Date.now()); return; }
    running = true;
    try { await refreshPublicSession(); }
    finally {
      running = false;
      if (!disposed) {
        const next = publicSessionRefreshDelay();
        if (next !== null) { retryAt = next > 0 ? 0 : Date.now() + 30_000; schedule(next > 0 ? next : 30_000); }
      }
    }
  }
  const wake = () => { void check(); };
  const online = () => { retryAt = 0; void check(); };
  const visible = () => { if (document.visibilityState === "visible") void check(); };
  const storage = (event: StorageEvent) => { if (event.key === "flixify-public-session" || event.key === null) void check(); };
  window.addEventListener("focus", wake); window.addEventListener("pageshow", wake); window.addEventListener("online", online);
  window.addEventListener("flixify-session", wake); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visible);
  void check();
  return () => {
    disposed = true; clear();
    window.removeEventListener("focus", wake); window.removeEventListener("pageshow", wake); window.removeEventListener("online", online);
    window.removeEventListener("flixify-session", wake); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visible);
  };
}
