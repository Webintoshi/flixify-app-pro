import { describe, expect, it } from "vitest";
import { resolveVodTranscodeDecision } from "./vod.js";

describe("resolveVodTranscodeDecision", () => {
  it("forces full transcode for MKV sources", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: true,
      preferTranscode: false
    });

    expect(decision.requiresFullTranscode).toBe(true);
    expect(decision.needsTranscode).toBe(true);
    expect(decision.allowCopyFallback).toBe(false);
    expect(decision.deliveryMode).toBe("hls_transcoded");
  });

  it("forces full transcode for AVI and unknown sources", () => {
    const aviDecision = resolveVodTranscodeDecision({
      transport: "avi",
      supportsByteRange: true,
      preferTranscode: false
    });
    const unknownDecision = resolveVodTranscodeDecision({
      transport: "unknown",
      supportsByteRange: false,
      preferTranscode: false
    });

    expect(aviDecision.requiresFullTranscode).toBe(true);
    expect(unknownDecision.requiresFullTranscode).toBe(true);
    expect(aviDecision.allowCopyFallback).toBe(false);
    expect(unknownDecision.allowCopyFallback).toBe(false);
  });

  it("forces compatibility transcode when preferTranscode is true", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: true
    });

    expect(decision.forceTranscodeProfile).toBe(true);
    expect(decision.requiresFullTranscode).toBe(true);
    expect(decision.needsTranscode).toBe(true);
    expect(decision.allowCopyFallback).toBe(false);
  });

  it("keeps direct file proxy for mp4 with byte-range support", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: false
    });

    expect(decision.needsTranscode).toBe(false);
    expect(decision.useFileProxy).toBe(true);
    expect(decision.deliveryMode).toBe("file_proxy");
  });

  it("uses hls_transcoded profile for mp4 without byte-range and allows copy fallback", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: false,
      preferTranscode: false
    });

    expect(decision.needsTranscode).toBe(true);
    expect(decision.requiresFullTranscode).toBe(false);
    expect(decision.allowCopyFallback).toBe(true);
    expect(decision.deliveryMode).toBe("hls_transcoded");
  });
});
