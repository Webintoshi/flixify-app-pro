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
const TR_UNIQUE_TITLE_PATTERNS: RegExp[] = [
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
  /(^|[^a-z0-9])kanal\s*24([^a-z0-9]|$)/,
  /(^|[^a-z0-9])ntv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])tv100([^a-z0-9]|$)/,
  /(^|[^a-z0-9])halk\s*tv([^a-z0-9]|$)/,
  /(^|[^a-z0-9])tele\s*1([^a-z0-9]|$)/,
  /(^|[^a-z0-9])haber\s*global([^a-z0-9]|$)/
];
const TR_CONTEXTUAL_BRAND_PATTERNS: RegExp[] = [
  /(^|[^a-z0-9])s\s*sport([^a-z0-9]|$)/,
  /(^|[^a-z0-9])spor\s*smart([^a-z0-9]|$)/,
  /(^|[^a-z0-9])bein\s*sports?([^a-z0-9]|$)/
];
const TR_UNIQUE_TVG_ID_PATTERNS: RegExp[] = [
  /(trt1|trt2|trthaber|trtspor|trtcocuk|atv|tv8|kanald|showtv|startv|beyaztv|ulketv|cnnturk|haberturk|ahaber|aspor|tgrt|teve2|tv100|halktv|tele1|haberglobal)/,
  /(beinsports[0-9]*tr|ssport.*tr|sporsmart.*tr)/,
  /(^|[^a-z0-9])tr([^a-z0-9]|$).*?(spor|haber|kanal|tv|ulusal)/,
  /(\.|_|-)(tr)(\.|_|-|$)/
];
const FOREIGN_SIGNAL_TOKENS = new Set([
  "us",
  "usa",
  "uk",
  "eng",
  "de",
  "ger",
  "germany",
  "deutsch",
  "fr",
  "fra",
  "france",
  "es",
  "esp",
  "spain",
  "it",
  "ita",
  "italy",
  "pt",
  "por",
  "portugal",
  "br",
  "bra",
  "brazil",
  "latin",
  "latam",
  "arab",
  "pl",
  "pol",
  "poland",
  "ru",
  "rus",
  "russia",
  "exyu",
  "balkan"
]);
const TR_CONTEXT_TOKENS = new Set(["tr", "turk", "turkce", "turkiye", "turkey", "turkish"]);
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

function hasContextualTrBrandSignal(titleText: string, tvgIdText: string, groupText: string) {
  return TR_CONTEXTUAL_BRAND_PATTERNS.some(
    (pattern) => pattern.test(titleText) || pattern.test(tvgIdText) || pattern.test(groupText)
  );
}

function hasUniqueTrSignal(
  groupTokens: Set<string>,
  titleText: string,
  titleTokens: Set<string>,
  tvgIdText: string,
  tvgIdTokens: Set<string>
) {
  if (hasStrongTrGroupSignal(groupTokens)) {
    return true;
  }

  for (const pattern of TR_UNIQUE_TITLE_PATTERNS) {
    if (pattern.test(titleText)) {
      return true;
    }
  }

  for (const pattern of TR_UNIQUE_TVG_ID_PATTERNS) {
    if (pattern.test(tvgIdText)) {
      return true;
    }
  }

  if (countTokenMatches(tvgIdTokens, TR_STRONG_GROUP_TOKENS) > 0) {
    return true;
  }

  return titleTokens.has("tr") && countTokenMatches(titleTokens, TR_TITLE_CONTEXT_TOKENS) > 0;
}

function hasTrContextSignal(groupTokens: Set<string>, titleTokens: Set<string>, tvgIdTokens: Set<string>) {
  return (
    countTokenMatches(groupTokens, TR_CONTEXT_TOKENS) > 0 ||
    countTokenMatches(titleTokens, TR_CONTEXT_TOKENS) > 0 ||
    countTokenMatches(tvgIdTokens, TR_CONTEXT_TOKENS) > 0
  );
}

function hasForeignSignal(groupTokens: Set<string>, titleTokens: Set<string>, tvgIdTokens: Set<string>) {
  return (
    countTokenMatches(groupTokens, FOREIGN_SIGNAL_TOKENS) > 0 ||
    countTokenMatches(titleTokens, FOREIGN_SIGNAL_TOKENS) > 0 ||
    countTokenMatches(tvgIdTokens, FOREIGN_SIGNAL_TOKENS) > 0
  );
}

function hasBalancedTrMediumSignals(
  groupTokens: Set<string>,
  titleTokens: Set<string>,
  tvgIdTokens: Set<string>,
  hasTrContext: boolean
) {
  const groupMediumMatches = countTokenMatches(groupTokens, TR_MEDIUM_TOKENS);
  const titleMediumMatches =
    countTokenMatches(titleTokens, TR_MEDIUM_TOKENS) + countTokenMatches(tvgIdTokens, TR_MEDIUM_TOKENS);
  return (
    hasTrContext &&
    groupMediumMatches > 0 &&
    titleMediumMatches > 0 &&
    groupMediumMatches + titleMediumMatches >= 2
  );
}

export function classifyLiveChannelCountry(input: {
  title: string;
  groupTitle: string | null;
  tvgId?: string | null;
}): LiveCountryClassification {
  const normalizedGroup = normalizeAsciiText(input.groupTitle);
  const groupTokens = tokenize(input.groupTitle);
  const normalizedTitle = normalizeAsciiText(input.title);
  const titleTokens = tokenize(input.title);
  const normalizedTvgId = normalizeAsciiText(input.tvgId);
  const tvgIdTokens = tokenize(input.tvgId);
  const hasUniqueStrongTrSignal = hasUniqueTrSignal(
    groupTokens,
    normalizedTitle,
    titleTokens,
    normalizedTvgId,
    tvgIdTokens
  );
  const hasTrContext = hasTrContextSignal(groupTokens, titleTokens, tvgIdTokens);
  const hasForeign = hasForeignSignal(groupTokens, titleTokens, tvgIdTokens);
  const hasContextualBrand = hasContextualTrBrandSignal(normalizedTitle, normalizedTvgId, normalizedGroup);
  const hasStrongTrSignal =
    hasUniqueStrongTrSignal || (hasContextualBrand && hasTrContext && !hasForeign);
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

  if (!hasForeign && hasBalancedTrMediumSignals(groupTokens, titleTokens, tvgIdTokens, hasTrContext)) {
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
