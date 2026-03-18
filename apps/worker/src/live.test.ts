import { describe, expect, it } from "vitest";
import { classifyLiveProbeHealth, detectLiveTransport } from "./live.js";

describe("detectLiveTransport", () => {
  it("detects HLS using extension and content type", () => {
    expect(detectLiveTransport("https://example.com/live/master.m3u8")).toBe("hls");
    expect(detectLiveTransport("https://example.com/live/stream", "application/vnd.apple.mpegurl")).toBe("hls");
  });

  it("detects TS and MP4 transports", () => {
    expect(detectLiveTransport("https://example.com/live/channel.ts")).toBe("ts");
    expect(detectLiveTransport("https://example.com/live/channel", "video/mp4")).toBe("mp4");
  });
});

describe("classifyLiveProbeHealth", () => {
  it("returns healthy for successful probes", () => {
    expect(classifyLiveProbeHealth({ ok: true, failureCategory: null })).toBe("healthy");
  });

  it("marks hard failures and silent streams as broken", () => {
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "hard-http" })).toBe("broken");
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "audio-missing" })).toBe("broken");
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "empty-stream" })).toBe("broken");
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "transport-unknown" })).toBe("broken");
  });

  it("keeps transient failures as degraded", () => {
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "probe-timeout" })).toBe("degraded");
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "upstream-http" })).toBe("degraded");
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "network" })).toBe("degraded");
    expect(classifyLiveProbeHealth({ ok: false, failureCategory: "unknown" })).toBe("degraded");
  });
});
