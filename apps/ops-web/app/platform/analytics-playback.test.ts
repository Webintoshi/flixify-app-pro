import { describe, expect, it } from "vitest";
import { createPlaybackMeasurement } from "./analytics-playback";

function fixture() {
  let now = 100;
  const events: { name: string; params: Record<string, unknown> }[] = [];
  const measurement = createPlaybackMeasurement({ now: () => now, emit: (name, params) => events.push({ name, params }), content: { content_type: "movie", content_id: "fixture:1" } });
  return { measurement, events, time: (value: number) => { now = value; } };
}
describe("playback measurement counts confirmed media without changing playback", () => {
  it("does not count requested/metadata/failed startup as video start or completion", () => {
    const f = fixture(); f.time(5000); f.measurement.failed("network"); f.measurement.firstFrame("requestVideoFrameCallback"); f.measurement.ended(); f.measurement.close();
    expect(f.events.map(event => event.name)).toEqual(["playback_request", "playback_error", "playback_end"]);
    expect(f.events.at(-1)?.params.watch_ms).toBe(0);
  });
  it("records one actual first frame and preserves its measurement method", () => {
    const f = fixture(); f.time(1550); f.measurement.firstFrame("requestVideoFrameCallback"); f.time(1600); f.measurement.firstFrame("playing-fallback");
    expect(f.events.filter(event => event.name === "video_start")).toEqual([{ name: "video_start", params: { content_type: "movie", content_id: "fixture:1", startup_ms: 1450, timing_method: "requestVideoFrameCallback" } }]);
  });
  it("deduplicates waiting/stalled and excludes paused/buffered time from watch duration", () => {
    const f = fixture(); f.time(200); f.measurement.firstFrame("playing-fallback"); f.time(1200); f.measurement.waiting(); f.measurement.waiting();
    f.time(2200); f.measurement.playing(); f.time(3200); f.measurement.paused(); f.time(10000); f.measurement.close();
    expect(f.events.filter(event => event.name === "playback_buffer")).toHaveLength(1);
    expect(f.events.find(event => event.name === "playback_buffer")?.params.buffer_ms).toBe(1000);
    expect(f.events.at(-1)?.params).toMatchObject({ watch_ms: 2000, buffer_count: 1, reason: "closed" });
  });
  it("limits progress milestones and never treats a close or pause as a completed movie", () => {
    const f = fixture(); f.measurement.firstFrame("loadeddata-fallback");
    for (let index = 0; index < 1000; index++) f.measurement.progress(80, 100);
    f.measurement.paused(); f.measurement.close(); f.measurement.ended();
    expect(f.events.filter(event => event.name === "video_progress").map(event => event.params.progress_percent)).toEqual([25, 50, 75]);
    expect(f.events.some(event => event.name === "video_complete")).toBe(false);
    expect(f.events.filter(event => event.name === "playback_end")).toHaveLength(1);
  });
  it("requires a genuine ended event and ignores all later callbacks after disposal", () => {
    const f = fixture(); f.measurement.firstFrame("playing-fallback"); f.time(2000); f.measurement.ended(); const count = f.events.length;
    f.measurement.playing(); f.measurement.waiting(); f.measurement.failed("media"); f.measurement.ended(); f.measurement.close();
    expect(f.events).toHaveLength(count);
    expect(f.events.filter(event => event.name === "video_complete")).toHaveLength(1);
    expect(f.events.at(-1)?.params.reason).toBe("ended");
  });
  it("does not issue a second request when the selection already measured it", () => {
    const events: string[] = [];
    const m = createPlaybackMeasurement({ now: () => 500, startAt: 100, requestAlreadyEmitted: true, content: {}, emit: name => { events.push(name); } });
    m.firstFrame("playing-fallback"); expect(events).toEqual(["video_start"]);
  });
  it("does not count a user pause as buffering time", () => {
    const f = fixture(); f.time(200); f.measurement.firstFrame("playing-fallback"); f.time(1200); f.measurement.waiting();
    f.time(1500); f.measurement.paused(); f.time(300000); f.measurement.playing(); f.time(301000); f.measurement.close();
    expect(f.events.find(event => event.name === "playback_buffer")?.params.buffer_ms).toBe(300);
    expect(f.events.at(-1)?.params.watch_ms).toBe(2000);
  });
  it("never flushes an old playback attempt after consent is withdrawn and granted again", () => {
    let generation = 0;
    const events: string[] = [];
    const m = createPlaybackMeasurement({ now: () => 1000, content: {}, emit: name => { events.push(name); }, isCurrent: () => generation === 0 });
    m.firstFrame("playing-fallback"); generation = 1; m.waiting(); generation = 2;
    m.playing(); m.progress(80, 100); m.ended(); m.close();
    expect(events).toEqual(["playback_request", "video_start"]);
  });
  it("never lets a broken analytics sink interrupt the player callbacks", () => {
    expect(() => {
      const m = createPlaybackMeasurement({ now: () => 1000, content: {}, emit: () => { throw new Error("sink offline"); } });
      m.firstFrame("playing-fallback"); m.waiting(); m.playing(); m.progress(80, 100); m.ended(); m.close();
    }).not.toThrow();
  });
});
