/** One detail view's record of direct streams that failed to start. */
export function createDirectPlaybackAttempt() {
  const failedDirect = new Set<string>();
  let pending: { key: string; controller: AbortController } | null = null;

  const cancel = () => {
    pending?.controller.abort();
    pending = null;
  };

  return {
    initialQuery: (key: string) => failedDirect.has(key) ? "direct=0" : "vodDirect=1",
    beginFallback: (key: string) => {
      cancel();
      failedDirect.add(key);
      const controller = new AbortController();
      pending = { key, controller };
      return controller;
    },
    canAdopt: (controller: AbortController) => pending?.controller === controller && !controller.signal.aborted,
    finish: (controller: AbortController) => { if (pending?.controller === controller) pending = null; },
    cancel
  };
}
