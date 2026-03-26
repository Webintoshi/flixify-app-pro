import { describe, expect, it } from "vitest";
import { createFfmpegArgs, parseVodMediaProfile, resolveVodTranscodeDecision, selectVodAudioTrackId } from "./vod.js";

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

  it("keeps native HLS on direct mode", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "hls",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app",
      platform: "windows-native-qt"
    });

    expect(decision.deliveryMode).toBe("hls_proxy");
    expect(decision.needsTranscode).toBe(false);
  });

  it("keeps Windows H.264/AAC MP4 on direct mode", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app",
      platform: "windows-desktop",
      mediaProfile: {
        containerTransport: "mp4",
        primaryVideoCodec: "h264",
        audioCodecs: ["aac"],
        audioTracks: []
      }
    });

    expect(decision.deliveryMode).toBe("file_proxy");
    expect(decision.needsTranscode).toBe(false);
  });

  it("keeps native desktop playback on direct mode for libVLC-capable containers and codecs", () => {
    const mkvDecision = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "native",
      platform: "windows-native-qt",
      mediaProfile: {
        containerTransport: "mkv",
        primaryVideoCodec: "h264",
        audioCodecs: ["aac"],
        audioTracks: []
      }
    });
    const hevcDecision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "native",
      platform: "windows-native-qt",
      mediaProfile: {
        containerTransport: "mp4",
        primaryVideoCodec: "hevc",
        audioCodecs: ["eac3"],
        audioTracks: []
      }
    });

    expect(mkvDecision.deliveryMode).toBe("file_proxy");
    expect(mkvDecision.needsTranscode).toBe(false);
    expect(hevcDecision.deliveryMode).toBe("file_proxy");
    expect(hevcDecision.needsTranscode).toBe(false);
  });

  it("keeps native desktop playback on file proxy even when byte-range is unavailable", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: false,
      preferTranscode: false,
      clientRuntime: "native",
      platform: "windows-native-qt",
      mediaProfile: {
        containerTransport: "mkv",
        primaryVideoCodec: "h264",
        audioCodecs: ["aac"],
        audioTracks: []
      }
    });

    expect(decision.deliveryMode).toBe("file_proxy");
    expect(decision.needsTranscode).toBe(false);
    expect(decision.requiresFfmpeg).toBe(false);
  });

  it("transcodes unsupported desktop containers and codecs for non-native app runtimes", () => {
    const mkvDecision = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app",
      platform: "windows-desktop",
      mediaProfile: {
        containerTransport: "mkv",
        primaryVideoCodec: "h264",
        audioCodecs: ["aac"],
        audioTracks: []
      }
    });
    const hevcDecision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app",
      platform: "windows-desktop",
      mediaProfile: {
        containerTransport: "mp4",
        primaryVideoCodec: "hevc",
        audioCodecs: ["aac"],
        audioTracks: []
      }
    });

    expect(mkvDecision.deliveryMode).toBe("hls_transcoded");
    expect(mkvDecision.needsTranscode).toBe(true);
    expect(hevcDecision.deliveryMode).toBe("hls_transcoded");
    expect(hevcDecision.needsTranscode).toBe(true);
  });

  it("forces transcode when native desktop playback needs an explicit audio track selection", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mkv",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "native",
      platform: "windows-native-qt",
      selectedAudioTrackId: "a2",
      mediaProfile: {
        containerTransport: "mkv",
        primaryVideoCodec: "h264",
        audioCodecs: ["aac", "aac"],
        audioTracks: [
          { id: "a1", sourceStreamIndex: 1, language: "en", title: "English", channels: 2, sourceDefault: true },
          { id: "a2", sourceStreamIndex: 2, language: "tr", title: "Turkce", channels: 2, sourceDefault: false }
        ]
      }
    });

    expect(decision.deliveryMode).toBe("hls_transcoded");
    expect(decision.needsTranscode).toBe(true);
  });

  it("uses conservative transcode mode for unknown installed platforms", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "avi",
      supportsByteRange: true,
      preferTranscode: false,
      clientRuntime: "app",
      platform: "android-tv-app",
      mediaProfile: {
        containerTransport: "avi",
        primaryVideoCodec: "mpeg4",
        audioCodecs: ["mp3"],
        audioTracks: []
      }
    });

    expect(decision.deliveryMode).toBe("hls_transcoded");
    expect(decision.needsTranscode).toBe(true);
  });

  it("respects preferTranscode even for direct-safe app sources", () => {
    const decision = resolveVodTranscodeDecision({
      transport: "mp4",
      supportsByteRange: true,
      preferTranscode: true,
      clientRuntime: "app",
      platform: "windows-desktop",
      mediaProfile: {
        containerTransport: "mp4",
        primaryVideoCodec: "h264",
        audioCodecs: ["mp3"],
        audioTracks: []
      }
    });

    expect(decision.deliveryMode).toBe("hls_transcoded");
    expect(decision.needsTranscode).toBe(true);
  });
});

describe("parseVodMediaProfile", () => {
  it("maps ffprobe container and codec metadata to a compatibility profile", () => {
    const profile = parseVodMediaProfile(
      {
        format: {
          format_name: "mov,mp4,m4a,3gp,3g2,mj2"
        },
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: "h264"
          },
          {
            index: 1,
            codec_type: "audio",
            codec_name: "aac",
            channels: 2,
            disposition: { default: 1 },
            tags: {
              language: "tr",
              title: "Turkce"
            }
          }
        ]
      },
      "unknown"
    );

    expect(profile).not.toBeNull();
    expect(profile?.containerTransport).toBe("mp4");
    expect(profile?.primaryVideoCodec).toBe("h264");
    expect(profile?.audioCodecs).toEqual(["aac"]);
    expect(profile?.audioTracks[0]).toMatchObject({
      id: "a1",
      language: "tr",
      title: "Turkce",
      sourceDefault: true
    });
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
