import { describe, expect, it } from "vitest";
import { createFfmpegArgs, resolveVodTranscodeDecision, selectVodAudioTrackId } from "./vod.js";

describe("resolveVodTranscodeDecision", () => {
  it("keeps browser runtime on transcode-first mode for mp4 sources", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "browser"
    });

    expect(decision.needsTranscode).toBe(true);
    expect(decision.requiresFfmpeg).toBe(true);
    expect(decision.deliveryMode).toBe("hls_transcoded");
    expect(decision.useFileProxy).toBe(false);
  });

  it("forces transcode for hls sources unless debug passthrough is enabled", () => {
    const normalDecision = resolveVodTranscodeDecision({
      transport: "hls",
      supportsByteRange: true,
      preferTranscode: false
    });
    const debugDecision = resolveVodTranscodeDecision({
      transport: "hls",
      supportsByteRange: true,
      preferTranscode: false,
      debugPassthrough: true
    });

    expect(normalDecision.deliveryMode).toBe("hls_transcoded");
    expect(normalDecision.needsTranscode).toBe(true);
    expect(debugDecision.deliveryMode).toBe("hls_proxy");
    expect(debugDecision.needsTranscode).toBe(false);
  });

  it("uses fast-start proxy modes for app runtime unless transcode is explicitly requested", () => {
    const appFileProxyDecision = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app"
    });
    const appHlsDecision = resolveVodTranscodeDecision({
      transport: "hls",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app"
    });
    const appForcedTranscode = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: true,
      preferTranscode: true,
      clientRuntime: "app"
    });

    expect(appFileProxyDecision.deliveryMode).toBe("file_proxy");
    expect(appFileProxyDecision.needsTranscode).toBe(false);
    expect(appHlsDecision.deliveryMode).toBe("hls_proxy");
    expect(appHlsDecision.needsTranscode).toBe(false);
    expect(appForcedTranscode.deliveryMode).toBe("hls_transcoded");
    expect(appForcedTranscode.needsTranscode).toBe(true);
  });
});

describe("selectVodAudioTrackId", () => {
  it("prefers requested track when present", () => {
    const tracks = [
      { id: "a1", sourceStreamIndex: 0, language: "en", title: null, channels: 2, sourceDefault: false },
      { id: "a2", sourceStreamIndex: 1, language: "tr", title: null, channels: 2, sourceDefault: false }
    ];

    const selected = selectVodAudioTrackId(tracks, "a1");
    expect(selected.selectedTrackId).toBe("a1");
    expect(selected.defaultTrackId).toBe("a1");
  });

  it("uses TR as deterministic default, then source default, then index 0", () => {
    const trTracks = [
      { id: "a1", sourceStreamIndex: 0, language: "en", title: null, channels: 2, sourceDefault: true },
      { id: "a2", sourceStreamIndex: 1, language: "tr", title: null, channels: 2, sourceDefault: false }
    ];
    const trSelected = selectVodAudioTrackId(trTracks);
    expect(trSelected.selectedTrackId).toBe("a2");

    const defaultTracks = [
      { id: "a1", sourceStreamIndex: 0, language: "en", title: null, channels: 2, sourceDefault: false },
      { id: "a2", sourceStreamIndex: 1, language: "de", title: null, channels: 2, sourceDefault: true }
    ];
    const defaultSelected = selectVodAudioTrackId(defaultTracks);
    expect(defaultSelected.selectedTrackId).toBe("a2");

    const firstTracks = [
      { id: "a1", sourceStreamIndex: 0, language: "en", title: null, channels: 2, sourceDefault: false },
      { id: "a2", sourceStreamIndex: 1, language: "de", title: null, channels: 2, sourceDefault: false }
    ];
    const firstSelected = selectVodAudioTrackId(firstTracks);
    expect(firstSelected.selectedTrackId).toBe("a1");
  });

  it("keeps selection empty when ffprobe cannot detect any audio track", () => {
    const selected = selectVodAudioTrackId([]);
    expect(selected.selectedTrackId).toBeNull();
    expect(selected.defaultTrackId).toBeNull();
  });
});

describe("createFfmpegArgs", () => {
  it("maps all audio tracks and applies normalization/disposition metadata", () => {
    const args = createFfmpegArgs({
      sourceUrl: "https://example.com/source.mkv",
      outputDir: "/tmp/vod-session",
      sourceAudioTracks: [
        {
          id: "a2",
          sourceStreamIndex: 2,
          language: "tr",
          title: "Turkce",
          channels: 2,
          sourceDefault: false
        },
        {
          id: "a5",
          sourceStreamIndex: 5,
          language: "en",
          title: "English",
          channels: 2,
          sourceDefault: true
        }
      ],
      selectedAudioTrackId: "a2",
      injectSilentAudioTrack: false
    });

    expect(args).toContain("0:a?");
    expect(args).toContain("aresample=async=1:min_hard_comp=0.100:first_pts=0,dynaudnorm=f=200:g=15");
    expect(args).toContain("-disposition:a:0");
    expect(args).toContain("-disposition:a:1");
    const defaultIndex = args.indexOf("-disposition:a:0");
    expect(args[defaultIndex + 1]).toBe("default");
  });

  it("injects silent track when source has no audio", () => {
    const args = createFfmpegArgs({
      sourceUrl: "https://example.com/source.mp4",
      outputDir: "/tmp/vod-session",
      sourceAudioTracks: [],
      selectedAudioTrackId: "fallback-silence-0",
      injectSilentAudioTrack: true
    });

    expect(args).toContain("anullsrc=r=48000:cl=stereo");
    expect(args).toContain("1:a:0");
  });
});
