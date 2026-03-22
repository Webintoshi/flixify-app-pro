export function canUseAppDirectPlaybackFallback(
  clientRuntime: "browser" | "app" | "native",
  sourceUrl: string | null | undefined
) {
  return clientRuntime !== "browser" && typeof sourceUrl === "string" && sourceUrl.trim().length > 0;
}
