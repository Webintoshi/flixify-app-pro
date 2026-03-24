// ============================================
// 🎬 FLIXIFY PRO - Video Player Utilities
// ============================================

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Detect if device is mobile/touch
 */
export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/**
 * Detect if browser supports HLS natively
 */
export function supportsHLS(): boolean {
  const video = document.createElement("video");
  const hlsGlobal = (window as { Hls?: { isSupported?: () => boolean } }).Hls;
  return (
    video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    (typeof hlsGlobal !== "undefined" && typeof hlsGlobal?.isSupported === "function")
  );
}

/**
 * Detect if browser supports Picture-in-Picture
 */
export function supportsPIP(): boolean {
  const video = document.createElement("video");
  return "pictureInPictureEnabled" in document || "requestPictureInPicture" in video;
}

/**
 * Get quality label from height
 */
export function getQualityLabel(height: number): string {
  const labels: Record<number, string> = {
    4320: "8K",
    2160: "4K",
    1440: "2K",
    1080: "1080p",
    720: "720p",
    480: "480p",
    360: "360p",
    240: "240p",
    144: "144p",
  };

  // Find closest quality
  const heights = Object.keys(labels).map(Number).sort((a, b) => b - a);
  for (const h of heights) {
    if (height >= h) return labels[h];
  }

  return `${height}p`;
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function (this: unknown, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
