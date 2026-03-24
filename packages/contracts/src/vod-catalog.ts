const MOVIE_SIGNAL_PATTERNS = [
  /\bfilm(?:ler)?\b/,
  /\bmovie(?:s)?\b/,
  /\bsinema\b/,
  /\bcinema\b/,
  /\bvod\b/
];

const SERIES_EPISODE_PATTERNS = [
  /^(.*?)(?:\s+|[._-]+)?s(?:eason)?\s*(\d{1,2})(?:\s+|[._-]+)?e(?:pisode)?\s*(\d{1,3}).*$/i,
  /^(.*?)(?:\s+|[._-]+)?(\d{1,2})\s*x\s*(\d{1,3}).*$/i,
  /^(.*?)(?:\s+|[._-]+)?season\s*(\d{1,2})(?:\s+|[._-]+)?(?:episode|ep)\s*(\d{1,3}).*$/i,
  /^(.*?)(?:\s+|[._-]+)?sezon\s*(\d{1,2})(?:\s+|[._-]+)?(?:bolum|b[o\u00f6]l[u\u00fc]m|episode|ep)\s*(\d{1,3}).*$/i
];

const BASE64_IMAGE_PREFIXES = ["data:image/", "/9j/", "ivborw0kggo", "r0lgod"];

export type VodCatalogEntryInput = {
  title: string | null | undefined;
  groupTitle?: string | null | undefined;
  source: string | null | undefined;
};

export type SeriesEpisodeMeta = {
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
};

export type VodCatalogClassification = "drop" | "live" | "movie" | "series";

type VodSourceAnalysis = {
  hasMoviePath: boolean;
  hasSeriesPath: boolean;
  hasTsExtension: boolean;
  hasHlsExtension: boolean;
  hasVodFileExtension: boolean;
};

export function normalizeVodCatalogLabel(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVodCatalogSignal(value: string | null | undefined) {
  return normalizeVodCatalogLabel(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0130I\u0131]/g, "i")
    .replace(/[._|/\\+-]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function analyzeVodSource(source: string | null | undefined): VodSourceAnalysis {
  const sanitized =
    normalizeVodCatalogLabel(source)
      .replace(/\\/g, "/")
      .split(/[?#]/, 1)[0]
      ?.toLowerCase() ?? "";

  return {
    hasMoviePath: /(?:^|\/)movie(?:\/|$)/i.test(sanitized),
    hasSeriesPath: /(?:^|\/)series(?:\/|$)/i.test(sanitized),
    hasTsExtension: /\.ts$/i.test(sanitized),
    hasHlsExtension: /\.m3u8$/i.test(sanitized),
    hasVodFileExtension: /\.(mp4|mkv|avi)$/i.test(sanitized)
  };
}

export function isJunkVodCatalogTitle(value: string | null | undefined) {
  const normalizedLabel = normalizeVodCatalogLabel(value);
  if (!normalizedLabel) {
    return true;
  }

  const compact = normalizedLabel.replace(/\s+/g, "");
  const lowerCompact = compact.toLowerCase();
  if (BASE64_IMAGE_PREFIXES.some((prefix) => lowerCompact.startsWith(prefix))) {
    return true;
  }

  const base64LikeRatio =
    compact.length === 0
      ? 0
      : compact.replace(/[^A-Za-z0-9+/=]/g, "").length / compact.length;

  return compact.length >= 160 && base64LikeRatio >= 0.9;
}

export function hasMovieCatalogSignal(title: string | null | undefined, groupTitle?: string | null | undefined) {
  const signal = normalizeVodCatalogSignal(`${title ?? ""} ${groupTitle ?? ""}`);
  return MOVIE_SIGNAL_PATTERNS.some((pattern) => pattern.test(signal));
}

export function hasStrongSeriesEpisodeSignal(
  title: string | null | undefined,
  groupTitle?: string | null | undefined
) {
  const signal = normalizeVodCatalogSignal(`${title ?? ""} ${groupTitle ?? ""}`);
  return SERIES_EPISODE_PATTERNS.some((pattern) => pattern.test(signal));
}

export function extractSeriesEpisodeMeta(title: string): SeriesEpisodeMeta {
  const normalizedTitle = normalizeVodCatalogLabel(title) || "Untitled";

  for (const pattern of SERIES_EPISODE_PATTERNS) {
    const match = normalizedTitle.match(pattern);
    if (!match) {
      continue;
    }

    const seriesTitle =
      normalizeVodCatalogLabel((match[1] ?? "").replace(/[-_.\s]+$/g, "")) || normalizedTitle;
    const seasonNumber = Number(match[2]);
    const episodeNumber = Number(match[3]);
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
      continue;
    }

    return {
      seriesTitle,
      seasonNumber: Math.max(1, seasonNumber),
      episodeNumber: Math.max(1, episodeNumber)
    };
  }

  return {
    seriesTitle: normalizedTitle,
    seasonNumber: 1,
    episodeNumber: 1
  };
}

export function classifyVodCatalogEntry(input: VodCatalogEntryInput): VodCatalogClassification {
  if (isJunkVodCatalogTitle(input.title)) {
    return "drop";
  }

  const source = analyzeVodSource(input.source);
  if (source.hasSeriesPath) {
    return "series";
  }

  if (source.hasMoviePath) {
    return "movie";
  }

  if (source.hasTsExtension || source.hasHlsExtension) {
    return "live";
  }

  if (source.hasVodFileExtension && hasStrongSeriesEpisodeSignal(input.title, input.groupTitle)) {
    return "series";
  }

  if (source.hasVodFileExtension && hasMovieCatalogSignal(input.title, input.groupTitle)) {
    return "movie";
  }

  return "live";
}

export function isValidMovieCatalogEntry(input: VodCatalogEntryInput) {
  return classifyVodCatalogEntry(input) === "movie";
}

export function isValidSeriesEpisodeCatalogEntry(
  input: VodCatalogEntryInput & { seriesTitle?: string | null | undefined }
) {
  if (input.seriesTitle && isJunkVodCatalogTitle(input.seriesTitle)) {
    return false;
  }

  return classifyVodCatalogEntry(input) === "series";
}
