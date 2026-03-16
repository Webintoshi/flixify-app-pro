const MOVIE_YEAR_PATTERN = /\b(19\d{2}|20\d{2}|21\d{2})\b/;
const TURKISH_DUBBED_PATTERNS = [
  /\bturkce dublaj\b/,
  /\btr dublaj\b/,
  /\bturk dublaj\b/,
  /\bdublaj\b/,
  /\bturkce ses\b/,
  /\bturkish dubbed\b/,
  /\btr audio\b/,
  /\bdual audio tr\b/
];
const NON_TURKISH_PATTERNS = [
  /\baltyazi\b/,
  /\balt yazi\b/,
  /\bsub(?:bed)?\b/,
  /\borijinal\b/,
  /\boriginal\b/,
  /\benglish\b/,
  /\bingilizce\b/,
  /\beng audio\b/,
  /\brussian\b/,
  /\brusca\b/,
  /\bgerman\b/,
  /\balmanca\b/,
  /\bfrench\b/,
  /\bfransizca\b/,
  /\blatino\b/,
  /\bespanol\b/
];
const MOVIE_NOISE_PATTERNS = [
  /\b2160p\b/g,
  /\b1080p\b/g,
  /\b720p\b/g,
  /\b480p\b/g,
  /\b4k\b/g,
  /\buhd\b/g,
  /\bfhd\b/g,
  /\bhd\b/g,
  /\bsd\b/g,
  /\bweb[-\s]?dl\b/g,
  /\bwebrip\b/g,
  /\bbluray\b/g,
  /\bbrrip\b/g,
  /\bdvdrip\b/g,
  /\bhdrip\b/g,
  /\bremux\b/g,
  /\bx264\b/g,
  /\bx265\b/g,
  /\bh264\b/g,
  /\bh265\b/g,
  /\bhevc\b/g,
  /\baac\b/g,
  /\bdts\b/g,
  /\bac3\b/g,
  /\batmos\b/g,
  /\b10bit\b/g,
  /\b8bit\b/g,
  /\bimax\b/g,
  /\bproper\b/g,
  /\bextended\b/g,
  /\bunrated\b/g,
  /\bremastered\b/g,
  /\byify\b/g,
  /\bnf\b/g,
  /\bamzn\b/g,
  /\bdual\b/g,
  /\bmulti(?:\s+sub)?\b/g,
  /\btr\b/g,
  /\bturkce\b/g,
  /\bturkish\b/g,
  /\bdublaj\b/g,
  /\baltyazi\b/g,
  /\bsub(?:bed)?\b/g
];

export type MovieLanguageBucket = "turkish-dubbed" | "unknown" | "non-turkish";

export type MovieCatalogIdentity = {
  canonicalKey: string;
  canonicalTitle: string;
  year: string | null;
};

function normalizeMovieText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/['’`"]/g, "")
    .replace(/[._|/\\+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMovieYear(value: string) {
  return normalizeMovieText(value).match(MOVIE_YEAR_PATTERN)?.[1] ?? null;
}

function stripMovieNoise(value: string) {
  let normalized = normalizeMovieText(value)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(MOVIE_YEAR_PATTERN, " ");

  for (const pattern of MOVIE_NOISE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }

  normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

export function getMovieLanguageBucket(title: string, groupTitle?: string | null): MovieLanguageBucket {
  const signal = normalizeMovieText(`${title} ${groupTitle ?? ""}`);

  if (TURKISH_DUBBED_PATTERNS.some((pattern) => pattern.test(signal))) {
    return "turkish-dubbed";
  }

  if (NON_TURKISH_PATTERNS.some((pattern) => pattern.test(signal))) {
    return "non-turkish";
  }

  return "unknown";
}

export function createMovieCatalogIdentity(title: string): MovieCatalogIdentity {
  const year = extractMovieYear(title);
  const canonicalTitle = stripMovieNoise(title) || normalizeMovieText(title) || "isimsiz-film";

  return {
    canonicalKey: `${canonicalTitle}::${year ?? ""}`,
    canonicalTitle,
    year
  };
}

export function dedupeMovieCatalogEntries<T>(
  items: T[],
  options: {
    getTitle: (item: T) => string;
    getGroupTitle: (item: T) => string | null | undefined;
    getArtworkUrl?: (item: T) => string | null | undefined;
  }
): T[] {
  const prepared = items.map((item, index) => {
    const title = options.getTitle(item);
    const groupTitle = options.getGroupTitle(item) ?? null;
    const identity = createMovieCatalogIdentity(title);
    const language = getMovieLanguageBucket(title, groupTitle);
    const artworkUrl = options.getArtworkUrl?.(item) ?? null;
    const signal = normalizeMovieText(`${title} ${groupTitle ?? ""}`);
    const explicitDub = TURKISH_DUBBED_PATTERNS.some((pattern) => pattern.test(signal));
    const explicitForeign = NON_TURKISH_PATTERNS.some((pattern) => pattern.test(signal));
    const noisePenalty = Math.max(normalizeMovieText(title).split(" ").length - identity.canonicalTitle.split(" ").length, 0);
    const languageScore =
      language === "turkish-dubbed" ? 1000 : language === "unknown" ? 240 : -1000;
    const score =
      languageScore +
      (explicitDub ? 160 : 0) +
      (explicitForeign ? -220 : 0) +
      (artworkUrl ? 40 : 0) +
      Math.max(0, 80 - noisePenalty * 8) -
      index;

    return {
      item,
      index,
      title,
      groupTitle,
      identity,
      language,
      score
    };
  });

  const groups = new Map<string, typeof prepared>();
  const baseYearBuckets = new Map<string, Set<string>>();

  for (const entry of prepared) {
    const bucket = groups.get(entry.identity.canonicalKey) ?? [];
    bucket.push(entry);
    groups.set(entry.identity.canonicalKey, bucket);

    const yearBuckets = baseYearBuckets.get(entry.identity.canonicalTitle) ?? new Set<string>();
    if (entry.identity.year) {
      yearBuckets.add(entry.identity.canonicalKey);
    }
    baseYearBuckets.set(entry.identity.canonicalTitle, yearBuckets);
  }

  for (const [baseTitle, yearKeys] of baseYearBuckets.entries()) {
    const yearlessKey = `${baseTitle}::`;
    const yearlessEntries = groups.get(yearlessKey);
    if (!yearlessEntries || yearKeys.size !== 1) {
      continue;
    }

    const targetKey = [...yearKeys][0];
    if (!targetKey) {
      continue;
    }

    const targetEntries = groups.get(targetKey) ?? [];
    groups.set(targetKey, [...targetEntries, ...yearlessEntries]);
    groups.delete(yearlessKey);
  }

  const selected = [...groups.values()]
    .map((entries) =>
      entries
        .slice()
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]
    )
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.language !== "non-turkish")
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);

  return selected;
}
