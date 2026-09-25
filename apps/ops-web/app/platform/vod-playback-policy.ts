export function shouldAdoptCompatibilityPlayback(
  currentDeliveryMode: string | undefined,
  compatibilityDeliveryMode: string | undefined
): boolean {
  return currentDeliveryMode === "direct_provider" && compatibilityDeliveryMode === "hls_transcoded";
}
