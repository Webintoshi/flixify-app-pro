/** Declared source transport wins; legacy unknown sources inspect only the final path extension. */
export function usesHlsPlayback(transport: string | undefined, url: string): boolean {
  if (transport && transport !== "unknown") return transport === "hls";
  try {
    return /\.m3u8$/i.test(new URL(url, "https://playback.invalid").pathname);
  } catch {
    return false;
  }
}

/** File containers use the browser media engine; only TS needs MPEG-TS transmuxing. */
export function selectLivePlaybackEngine(transport: string | undefined, url: string): "hls" | "mpegts" | "native" {
  if (usesHlsPlayback(transport, url)) return "hls";
  if (transport === "mp4" || transport === "mkv") return "native";
  return "mpegts";
}
