import { dedupeMovieCatalogEntries } from "@flixify/contracts";

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
  return title
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyEntry(entry: ParsedM3UEntry) {
  const signal = normalizeTitle(`${entry.title} ${entry.groupTitle ?? ""}`)
    .toLowerCase()
    .replace(/[._|/\\+-]+/g, " ");

  const hasSeriesSignal =
    /\bs\d{1,2}\s*e\d{1,3}\b/.test(signal) ||
    /\b\d{1,2}\s*x\s*\d{1,3}\b/.test(signal) ||
    signal.includes("season") ||
    signal.includes("episode") ||
    signal.includes("sezon") ||
    signal.includes("bolum") ||
    signal.includes("dizi") ||
    signal.includes("series");

  const hasMovieSignal =
    signal.includes("film") ||
    signal.includes("movie") ||
    signal.includes("sinema") ||
    signal.includes("vod");

  try {
    const segments = new URL(entry.streamUrl).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    const hasMoviePath = segments.includes("movie");
    const hasSeriesPath = segments.includes("series");

    if (hasSeriesPath) {
      return "series" as const;
    }

    if (hasMoviePath) {
      return "movie" as const;
    }

    if (hasSeriesSignal) {
      return "series" as const;
    }

    if (hasMovieSignal) {
      return "movie" as const;
    }

    return "live" as const;
  } catch {
    // URL parse edilemezse metin tabanli fallback ile devam et.
  }

  if (hasSeriesSignal) {
    return "series" as const;
  }

  if (hasMovieSignal) {
    return "movie" as const;
  }

  return "live" as const;
}

function extractSeriesMeta(title: string) {
  const patterns: RegExp[] = [
    /^(.*?)(?:\s+|[._-]+)?s(?:eason)?\s*(\d{1,2})(?:\s+|[._-]+)?e(?:pisode)?\s*(\d{1,3}).*$/i,
    /^(.*?)(?:\s+|[._-]+)?(\d{1,2})\s*x\s*(\d{1,3}).*$/i,
    /^(.*?)(?:\s+|[._-]+)?sezon\s*(\d{1,2})(?:\s+|[._-]+)?(?:bolum|episode|ep)\s*(\d{1,3}).*$/i
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (!match) {
      continue;
    }

    const seriesTitle = normalizeTitle((match[1] ?? "").replace(/[-_]+$/g, "")) || normalizeTitle(title);
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
    seriesTitle: normalizeTitle(title),
    seasonNumber: 1,
    episodeNumber: 1
  };
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

function sanitizeArtworkUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseM3U(content: string): ParsedCatalog {
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
      const classification = classifyEntry(entry);
      if (classification === "series") {
        const meta = extractSeriesMeta(entry.title);
        rawCatalog.series.push({
          ...entry,
          ...meta
        });
      } else if (classification === "movie") {
        rawCatalog.movies.push(entry);
      } else {
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
      logoUrl: sanitizeArtworkUrl(item.logoUrl),
      tvgId: normalizeTvgId(item.tvgId)
    })),
    movies: dedupeMovieCatalogEntries(
      rawCatalog.movies.map((item) => ({
        ...item,
        title: normalizeTitle(item.title),
        groupTitle: normalizeTitle(item.groupTitle ?? "") || null,
        logoUrl: sanitizeArtworkUrl(item.logoUrl),
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
      logoUrl: sanitizeArtworkUrl(item.logoUrl),
      tvgId: normalizeTvgId(item.tvgId)
    }))
  };
}
