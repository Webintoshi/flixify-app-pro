export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`
    : `${minutes}:${remainingSeconds}`;
}

export function playableDuration(seconds: number): number | null {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function clampSeekTime(target: number, duration: number): number {
  if (!Number.isFinite(target)) return 0;
  return Math.min(Math.max(target, 0), playableDuration(duration) ?? 0);
}

export function shouldHidePlayerChrome(kind: "live" | "vod", idleMs: number, focused: boolean): boolean {
  return kind === "live" && !focused && idleMs >= 2500;
}
