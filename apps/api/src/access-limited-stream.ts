import type { Readable } from "node:stream";

const MAX_TIMEOUT_MS = 2_147_483_647;

export function accessExpired(accessUntilMs: number | null) {
  return accessUntilMs !== null && accessUntilMs <= Date.now();
}

export function limitStreamToAccess(stream: Readable, accessUntilMs: number | null): Readable {
  if (accessUntilMs === null) return stream;

  let timeout: NodeJS.Timeout | null = null;
  stream.once("close", () => {
    if (timeout) clearTimeout(timeout);
  });

  const schedule = () => {
    if (stream.destroyed) return;
    const remainingMs = accessUntilMs - Date.now();
    if (remainingMs <= 0) {
      stream.destroy();
      return;
    }
    timeout = setTimeout(schedule, Math.min(remainingMs, MAX_TIMEOUT_MS));
    timeout.unref();
  };
  schedule();
  return stream;
}
