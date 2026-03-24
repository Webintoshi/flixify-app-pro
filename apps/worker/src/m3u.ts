import {
  classifyVodCatalogEntry,
  dedupeMovieCatalogEntries,
  extractSeriesEpisodeMeta,
  normalizeVodCatalogLabel
} from "@flixify/contracts";

export type ParsedM3UEntry = {
  title: string;
  streamUrl: string;
  groupTitle: string | null;
  logoUrl: string | null;
  tvgId: string | null;
};

export type ParsedCatalog = {
  live: ParsedM3UEntry[];
  movies: ParsedM3UEntry[];
  series: Array<
    ParsedM3UEntry & {
      seriesTitle: string;
      seasonNumber: number;
      episodeNumber: number;
    }
  >;
};

export type ParseM3UOptions = {
  artworkBaseUrl?: string | null;
};

const LEGACY_ARTWORK_HOSTS = new Set([
  "45.87.29.12",
  "epg.ottoprime.net",
  "home-playtv.com:25461",
  "kongking.shop",
  "latinoamericatv.vip:8080",
  "logo.uixtreamreseller.com:8080",
  "sltv-logo.cms-s.com",
  "udashboard.shop",
  "udashboard.shop:8080",
  "udashboard.vip",
  "udashboard.win",
  "xtitan.xyz:2082"
]);

const LEGACY_ARTWORK_PATH_PREFIXES = [
  "/images/",
  "/logo/",
  "/LOGO/",
  "/picon/",
  "/public/dist/img/uploads/logos/"
];

function parseAttributes(rawAttributes: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,]+)/g;

  for (const match of rawAttributes.matchAll(pattern)) {
    const key = match[1]?.trim().toLowerCase();
    const rawValue = match[2]?.trim();
    if (!key || !rawValue) {
      continue;
    }

    const unquoted =
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    attributes[key] = unquoted.trim();
  }

  return attributes;
}

function normalizeTitle(title: string) {
  return normalizeVodCatalogLabel(title);
}

function normalizeTvgId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function sanitizeStreamUrl(value: string) {
  const candidate = value.trim();
  if (!candidate || candidate.startsWith("#")) {
    return null;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function sanitizeArtworkUrl(
  value: string | null | undefined,
  options: ParseM3UOptions = {}
) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  const parseHttpUrl = (input: string, baseUrl?: string) => {
    try {
      const parsed = baseUrl ? new URL(input, baseUrl) : new URL(input);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      const normalizedArtworkBaseUrl = options.artworkBaseUrl?.trim();
      if (
        normalizedArtworkBaseUrl &&
        LEGACY_ARTWORK_HOSTS.has(parsed.host.toLowerCase()) &&
        LEGACY_ARTWORK_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
      ) {
        const artworkBase = new URL(normalizedArtworkBaseUrl);
        parsed.protocol = artworkBase.protocol;
        parsed.host = artworkBase.host;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  };

  if (candidate.startsWith("//")) {
    return parseHttpUrl(candidate, "https://flixify.invalid");
  }

  const hasExplicitScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate);
  if (hasExplicitScheme) {
    return parseHttpUrl(candidate);
  }

  const looksLikeHostname = /^[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/i.test(candidate);
  if (looksLikeHostname) {
    const inferredHttpsUrl = parseHttpUrl(`https://${candidate}`);
    if (inferredHttpsUrl) {
      return inferredHttpsUrl;
    }
  }

  const normalizedArtworkBaseUrl = options.artworkBaseUrl?.trim();
  if (normalizedArtworkBaseUrl) {
    return parseHttpUrl(candidate, normalizedArtworkBaseUrl);
  }

  return null;
}

export function parseM3U(content: string, options: ParseM3UOptions = {}): ParsedCatalog {
  const lines = content.split(/\r?\n/);
  const rawCatalog: ParsedCatalog = {
    live: [],
    movies: [],
    series: []
  };

  let currentMeta: ParsedM3UEntry | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("#EXTINF")) {
      const [metaPart, titlePart = "Untitled"] = trimmed.split(",", 2);
      const attributes = parseAttributes(metaPart);
      currentMeta = {
        title: normalizeTitle(titlePart),
        streamUrl: "",
        groupTitle: attributes["group-title"] ?? null,
        logoUrl: attributes["tvg-logo"] ?? null,
        tvgId: attributes["tvg-id"] ?? null
      };
      continue;
    }

    if (trimmed.startsWith("#")) {
      continue;
    }

    if (currentMeta) {
      const streamUrl = sanitizeStreamUrl(trimmed);
      if (!streamUrl) {
        currentMeta = null;
        continue;
      }

      const entry = {
        ...currentMeta,
        streamUrl
      };
      const classification = classifyVodCatalogEntry({
        title: entry.title,
        groupTitle: entry.groupTitle,
        source: entry.streamUrl
      });
      if (classification === "series") {
        const meta = extractSeriesEpisodeMeta(entry.title);
        rawCatalog.series.push({
          ...entry,
          ...meta
        });
      } else if (classification === "movie") {
        rawCatalog.movies.push(entry);
      } else if (classification === "live") {
        rawCatalog.live.push(entry);
      }
      currentMeta = null;
    }
  }

  const orderedSeries = rawCatalog.series
    .slice()
    .sort((left, right) => {
      const titleCompare = left.seriesTitle.localeCompare(right.seriesTitle, "tr", { sensitivity: "base" });
      if (titleCompare !== 0) {
        return titleCompare;
      }
      if (left.seasonNumber !== right.seasonNumber) {
        return left.seasonNumber - right.seasonNumber;
      }
      if (left.episodeNumber !== right.episodeNumber) {
        return left.episodeNumber - right.episodeNumber;
      }
      return left.title.localeCompare(right.title, "tr", { sensitivity: "base" });
    });

  return {
    live: rawCatalog.live.map((item) => ({
      ...item,
      title: normalizeTitle(item.title),
      groupTitle: normalizeTitle(item.groupTitle ?? "") || null,
      logoUrl: sanitizeArtworkUrl(item.logoUrl, options),
      tvgId: normalizeTvgId(item.tvgId)
    })),
    movies: dedupeMovieCatalogEntries(
      rawCatalog.movies.map((item) => ({
        ...item,
        title: normalizeTitle(item.title),
        groupTitle: normalizeTitle(item.groupTitle ?? "") || null,
        logoUrl: sanitizeArtworkUrl(item.logoUrl, options),
        tvgId: normalizeTvgId(item.tvgId)
      })),
      {
        getTitle: (item) => item.title,
        getGroupTitle: (item) => item.groupTitle,
        getArtworkUrl: (item) => item.logoUrl
      }
    ),
    series: orderedSeries.map((item) => ({
      ...item,
      title: normalizeTitle(item.title),
      seriesTitle: normalizeTitle(item.seriesTitle) || normalizeTitle(item.title),
      groupTitle: normalizeTitle(item.groupTitle ?? "") || null,
      logoUrl: sanitizeArtworkUrl(item.logoUrl, options),
      tvgId: normalizeTvgId(item.tvgId)
    }))
  };
}
