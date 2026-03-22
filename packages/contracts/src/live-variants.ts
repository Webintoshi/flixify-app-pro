const LIVE_VARIANT_PREFIX_PATTERN = /^[a-z]{2,3}\s*[•|:\-]+\s*/i;
const LIVE_VARIANT_QUALITY_PATTERNS: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 300, pattern: /\b(?:fhd|full\s*hd|1080p)\b/i },
  { rank: 200, pattern: /\b(?:hd|720p)\b/i },
  { rank: 150, pattern: /\braw\b/i },
  { rank: 100, pattern: /\bsd\b/i },
  { rank: 50, pattern: /\b(?:4k|uhd|2160p|hevc|h\.?265|x265)\b/i }
];

function normalizeAsciiText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function getLiveVariantQualityRank(title: string | null | undefined) {
  const normalizedTitle = normalizeAsciiText(title);
  if (!normalizedTitle) {
    return null;
  }

  for (const candidate of LIVE_VARIANT_QUALITY_PATTERNS) {
    if (candidate.pattern.test(normalizedTitle)) {
      return candidate.rank;
    }
  }

  return null;
}

export function getLiveVariantGroupKey(title: string | null | undefined) {
  const normalizedTitle = normalizeAsciiText(title);
  if (!normalizedTitle) {
    return null;
  }

  const strippedTitle = normalizedTitle
    .replace(LIVE_VARIANT_PREFIX_PATTERN, "")
    .replace(/\b(?:4k|uhd|2160p|fhd|full\s*hd|1080p|hd|720p|sd|raw|hevc|h\.?265|x265)\b/g, " ")
    .replace(/[()[\]{}|/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return strippedTitle.length > 0 ? strippedTitle : null;
}

export function buildLiveVariantMetadata(title: string | null | undefined) {
  return {
    variantGroupKey: getLiveVariantGroupKey(title),
    qualityRank: getLiveVariantQualityRank(title)
  };
}
