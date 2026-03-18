export type LiveCountryConfidence = "high" | "medium" | "unknown";
export type LiveCountryMatchReason =
  | "prefix"
  | "tr_strong_group"
  | "tr_balanced_multi_signal"
  | "none";

export type LiveCountryClassification = {
  countryCode: string | null;
  confidence: LiveCountryConfidence;
  reason: LiveCountryMatchReason;
};

const COUNTRY_PREFIX_PATTERN = /^\s*([A-Za-z]{2,3})\s*[:\-]/;
const TR_STRONG_GROUP_TOKENS = new Set([
  "turkiye",
  "turkey",
  "tr",
  "turk",
  "turkce",
  "turkish"
]);
const TR_MEDIUM_TOKENS = new Set(["turk", "turkce", "dublaj", "ulusal", "turkish"]);
const TR_TITLE_CONTEXT_TOKENS = new Set(["spor", "haber", "kanal", "tv", "ulusal"]);
const TR_STRONG_TITLE_PATTERNS: RegExp[] = [
  /(^|[^a-z0-9])(trt|atv|tv8|cnnturk|haberturk|aspor|ahaber|tgrt|teve2)([^a-z0-9]|$)/,
  /(^|[^a-z0-9])cnn\s*turk([^a-z0-9]|$)/,
  /(^|[^a-z0-9])a\s*spor([^a-z0-9]|$)/,
  /(^|[^a-z0-9])a\s*haber([^a-z0-9]|$)/,
  /(^|[^a-z0-9])kanal\s*d([^a-z0-9]|$)/,
  /(^|[^a-z0-9])kanal\s*7([^a-z0-9]|$)/,
  /(^|[^a-z0-9])show\s*tv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])star\s*tv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])beyaz\s*tv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])ulke\s*tv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])kanal\s*24([^a-z0-9]|$)/
];
const COUNTRY_CODE_ALIASES = new Map<string, string>([
  ["TUR", "TR"],
  ["TRK", "TR"]
]);

function normalizeAsciiText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string | null | undefined) {
  const normalized = normalizeAsciiText(value);
  const tokens = normalized.split(/[^a-z0-9]+/g).filter(Boolean);
  return new Set(tokens);
}

function parseCountryCodeFromGroupPrefix(groupTitle: string | null | undefined) {
  const match = (groupTitle ?? "").match(COUNTRY_PREFIX_PATTERN);
  const rawCode = match?.[1]?.toUpperCase();
  if (!rawCode) {
    return null;
  }
  if (rawCode.length < 2 || rawCode.length > 3) {
    return null;
  }
  return COUNTRY_CODE_ALIASES.get(rawCode) ?? rawCode;
}

function countTokenMatches(tokens: Set<string>, lookup: Set<string>) {
  let matches = 0;
  for (const token of tokens) {
    if (lookup.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

function hasStrongTrGroupSignal(groupTokens: Set<string>) {
  return countTokenMatches(groupTokens, TR_STRONG_GROUP_TOKENS) > 0;
}

function hasStrongTrTitleSignal(titleText: string, titleTokens: Set<string>) {
  for (const pattern of TR_STRONG_TITLE_PATTERNS) {
    if (pattern.test(titleText)) {
      return true;
    }
  }

  return titleTokens.has("tr") && countTokenMatches(titleTokens, TR_TITLE_CONTEXT_TOKENS) > 0;
}

function hasBalancedTrMediumSignals(groupTokens: Set<string>, titleTokens: Set<string>) {
  const groupMediumMatches = countTokenMatches(groupTokens, TR_MEDIUM_TOKENS);
  const titleMediumMatches = countTokenMatches(titleTokens, TR_MEDIUM_TOKENS);
  return (
    groupMediumMatches > 0 &&
    titleMediumMatches > 0 &&
    groupMediumMatches + titleMediumMatches >= 2
  );
}

export function classifyLiveChannelCountry(input: {
  title: string;
  groupTitle: string | null;
}): LiveCountryClassification {
  const groupTokens = tokenize(input.groupTitle);
  const normalizedTitle = normalizeAsciiText(input.title);
  const titleTokens = tokenize(input.title);
  const hasStrongTrSignal =
    hasStrongTrGroupSignal(groupTokens) || hasStrongTrTitleSignal(normalizedTitle, titleTokens);
  const prefixedCountryCode = parseCountryCodeFromGroupPrefix(input.groupTitle);

  // Prefix is generally reliable, but we prioritize explicit Turkish brand/title signals
  // so Turkish channels nested under non-TR provider buckets still land in TR.
  if (prefixedCountryCode && prefixedCountryCode !== "TR" && hasStrongTrSignal) {
    return {
      countryCode: "TR",
      confidence: "high",
      reason: "tr_strong_group"
    };
  }

  if (prefixedCountryCode) {
    return {
      countryCode: prefixedCountryCode,
      confidence: "high",
      reason: "prefix"
    };
  }

  if (hasStrongTrSignal) {
    return {
      countryCode: "TR",
      confidence: "high",
      reason: "tr_strong_group"
    };
  }

  if (hasBalancedTrMediumSignals(groupTokens, titleTokens)) {
    return {
      countryCode: "TR",
      confidence: "medium",
      reason: "tr_balanced_multi_signal"
    };
  }

  return {
    countryCode: null,
    confidence: "unknown",
    reason: "none"
  };
}
