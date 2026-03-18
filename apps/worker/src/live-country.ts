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
const TR_STRONG_GROUP_TOKENS = new Set(["turkiye", "turkey", "tr"]);
const TR_MEDIUM_TOKENS = new Set(["turk", "turkce", "dublaj", "ulusal", "turkish"]);

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
  return rawCode;
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
  const prefixedCountryCode = parseCountryCodeFromGroupPrefix(input.groupTitle);
  if (prefixedCountryCode) {
    return {
      countryCode: prefixedCountryCode,
      confidence: "high",
      reason: "prefix"
    };
  }

  const groupTokens = tokenize(input.groupTitle);
  const titleTokens = tokenize(input.title);

  if (hasStrongTrGroupSignal(groupTokens)) {
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
