/** Declared source transport wins; legacy unknown sources inspect only the final path extension. */
export function usesHlsPlayback(transport: string | undefined, url: string): boolean {
  if (transport && transport !== "unknown") return transport === "hls";
  try {
    return /\.m3u8$/i.test(new URL(url, "https://playback.invalid").pathname);
  } catch {
    return false;
  }
}
