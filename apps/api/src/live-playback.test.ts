import { describe, expect, it } from "vitest";
import { getContentLengthFromContentRange, parseManifestState } from "./live-playback.js";

describe("live-playback helpers", () => {
  it("parses media sequence and segment count from manifest", () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:6.0,
segment-00042.ts
#EXTINF:6.0,
segment-00043.ts
`;

    expect(parseManifestState(manifest)).toEqual({
      mediaSequence: 42,
      segmentCount: 2
    });
  });

  it("derives content length from content-range", () => {
    expect(getContentLengthFromContentRange("bytes 0-65535/200000")).toBe("65536");
    expect(getContentLengthFromContentRange("bytes 500-999/1000")).toBe("500");
  });

  it("returns null for malformed content-range", () => {
    expect(getContentLengthFromContentRange(null)).toBeNull();
    expect(getContentLengthFromContentRange("items 0-10/20")).toBeNull();
    expect(getContentLengthFromContentRange("bytes 10-5/20")).toBeNull();
  });
});
