import { describe, expect, it } from "vitest";
import { isSafeLocalHlsUri, resolveHttpHlsUri, rewriteHlsManifest } from "./hls-manifest.js";

describe("HLS manifest URI rewriting", () => {
  it("rejects a malformed unquoted URI instead of leaving an extra media target", () => {
    const manifest = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=https://provider.test/key,extra\n";
    expect(rewriteHlsManifest(manifest, (uri) => `https://flixify.test/asset?u=${encodeURIComponent(uri)}`)).toBeNull();
  });

  it("rejects variable substitution and content steering that cannot be safely rewritten", () => {
    const resolver = (uri: string) => `https://flixify.test/asset?u=${encodeURIComponent(uri)}`;
    expect(rewriteHlsManifest('#EXTM3U\n#EXT-X-DEFINE:NAME="base",VALUE="https://provider.test"\n{$base}/segment.ts\n', resolver)).toBeNull();
    expect(rewriteHlsManifest('#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI="https://provider.test/steer.json"\n', resolver)).toBeNull();
  });

  it("accepts only web upstream URIs and single local relay filenames", () => {
    expect(resolveHttpHlsUri("../audio/track.m3u8", "https://provider.test/live/master.m3u8"))
      .toBe("https://provider.test/audio/track.m3u8");
    expect(resolveHttpHlsUri("data:text/plain,key", "https://provider.test/live/master.m3u8")).toBeNull();
    expect(isSafeLocalHlsUri("segment-00001.ts")).toBe(true);
    expect(isSafeLocalHlsUri("../secret.key")).toBe(false);
    expect(isSafeLocalHlsUri("https://provider.test/key")).toBe(false);
  });
});
