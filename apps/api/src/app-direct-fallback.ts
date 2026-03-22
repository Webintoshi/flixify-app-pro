export function canUseAppDirectPlaybackFallback(
  clientRuntime: "browser" | "app",
  sourceUrl: string | null | undefined
) {
  return clientRuntime === "app" && typeof sourceUrl === "string" && sourceUrl.trim().length > 0;
}
