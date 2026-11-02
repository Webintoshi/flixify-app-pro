type Emitter = (name: string, params: Record<string, unknown>) => void;
type TimingMethod = "requestVideoFrameCallback" | "loadeddata-fallback" | "playing-fallback";

export function createPlaybackMeasurement({ emit, content, now, startAt = now(), requestAlreadyEmitted = false, isCurrent = () => true }: { emit: Emitter; content: Record<string, unknown>; now: () => number; startAt?: number; requestAlreadyEmitted?: boolean; isCurrent?: () => boolean }) {
  let started = false;
  let closed = false;
  let failed = false;
  let playingAt: number | null = null;
  let bufferingAt: number | null = null;
  let watch = 0;
  let buffers = 0;
  let bufferEvents = 0;
  const milestones = new Set<number>();
  const send = (name: string, params: Record<string, unknown> = {}) => { try { if (isCurrent()) emit(name, { ...content, ...params }); } catch {} };
  const stopWatch = () => { if (playingAt !== null) watch += Math.max(0, now() - playingAt); playingAt = null; };
  const flushBuffer = () => {
    if (bufferingAt === null) return;
    const duration = Math.max(0, now() - bufferingAt); bufferingAt = null;
    if (duration < 100) return;
    buffers++;
    if (bufferEvents++ < 30) send("playback_buffer", { buffer_ms: Math.min(duration, 3_600_000), buffer_count: buffers });
  };
  const close = (reason = "closed") => {
    if (closed) return;
    stopWatch(); flushBuffer(); closed = true;
    send("playback_end", { watch_ms: Math.min(watch, 86_400_000), buffer_count: buffers, reason });
  };
  if (!requestAlreadyEmitted) send("playback_request");
  return {
    firstFrame(method: TimingMethod) {
      if (closed || failed || started) return;
      started = true; playingAt = now();
      send("video_start", { startup_ms: Math.max(0, Math.min(300_000, now() - startAt)), timing_method: method });
    },
    playing() { if (closed || failed || !started) return; flushBuffer(); playingAt ??= now(); },
    paused() { if (!closed) { stopWatch(); flushBuffer(); } },
    waiting() { if (closed || failed || !started) return; stopWatch(); bufferingAt ??= now(); },
    progress(time: number, duration: number) {
      if (closed || failed || !started || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time)) return;
      for (const percent of [25, 50, 75]) if (time / duration * 100 >= percent && !milestones.has(percent)) { milestones.add(percent); send("video_progress", { progress_percent: percent }); }
    },
    failed(reason: string) { if (closed || failed) return; failed = true; stopWatch(); flushBuffer(); send("playback_error", { reason }); },
    ended() { if (closed || failed || !started) return; send("video_complete"); close("ended"); },
    close
  };
}

export function observeMediaAnalytics(media: HTMLVideoElement, options: Parameters<typeof createPlaybackMeasurement>[0]) {
  const measurement = createPlaybackMeasurement(options);
  let disposed = false;
  let frame: number | null = null;
  let usesFrame = false;
  const frameReady = () => { frame = null; if (!disposed) { measurement.firstFrame("requestVideoFrameCallback"); if (media.paused) measurement.paused(); } };
  if (typeof media.requestVideoFrameCallback === "function") {
    try { frame = media.requestVideoFrameCallback(frameReady); usesFrame = true; } catch {}
  }
  const playing = () => { if (!usesFrame) measurement.firstFrame("playing-fallback"); measurement.playing(); };
  const loaded = () => { if (!usesFrame && !media.paused) measurement.firstFrame("loadeddata-fallback"); };
  const progress = () => measurement.progress(media.currentTime, media.duration);
  const pause = () => measurement.paused();
  const waiting = () => measurement.waiting();
  const ended = () => measurement.ended();
  const events: [string, EventListener][] = [["playing", playing], ["loadeddata", loaded], ["timeupdate", progress], ["pause", pause], ["waiting", waiting], ["stalled", waiting], ["ended", ended]];
  for (const [event, listener] of events) media.addEventListener(event, listener);
  return {
    failed: measurement.failed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (frame !== null) media.cancelVideoFrameCallback?.(frame);
      for (const [event, listener] of events) media.removeEventListener(event, listener);
      measurement.close();
    }
  };
}
