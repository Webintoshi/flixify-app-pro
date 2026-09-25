export type ChannelLike = {
  id?: string;
  title: string;
  groupTitle: string | null;
};

export type ChannelClassification = {
  countryId: string;
  categoryId: string;
};

export const COUNTRIES = [
  { id: "tr", label: "Türkiye", flag: "🇹🇷", patterns: [/(^|\W)TR(?=\W|$)/, /TURK(?:EY|IYE|ISH|CE)/] },
  { id: "de", label: "Almanya", flag: "🇩🇪", patterns: [/(^|\W)DE(?=\W|$)/, /GERMANY|DEUTSCH/] },
  { id: "fr", label: "Fransa", flag: "🇫🇷", patterns: [/(^|\W)FR(?=\W|$)/, /FRANCE|FRENCH/] },
  { id: "gb", label: "İngiltere", flag: "🇬🇧", patterns: [/(^|\W)UK(?=\W|$)/, /UNITED KINGDOM|ENGLAND|BRITISH/] },
  { id: "us", label: "ABD", flag: "🇺🇸", patterns: [/(^|\W)US(?:A)?(?=\W|$)/, /UNITED STATES/] },
  { id: "it", label: "İtalya", flag: "🇮🇹", patterns: [/(^|\W)IT(?=\W|$)/, /ITALY|ITALIA/] },
  { id: "es", label: "İspanya", flag: "🇪🇸", patterns: [/(^|\W)ES(?=\W|$)/, /SPAIN|ESPANA/] },
  { id: "pt", label: "Portekiz", flag: "🇵🇹", patterns: [/(^|\W)PT(?=\W|$)/, /PORTUGAL/] },
  { id: "bg", label: "Bulgaristan", flag: "🇧🇬", patterns: [/(^|\W)BG(?=\W|$)/, /BULGARIA/] },
  { id: "gr", label: "Yunanistan", flag: "🇬🇷", patterns: [/(^|\W)GR(?=\W|$)/, /GREECE|GREEK/] },
  { id: "se", label: "İsveç", flag: "🇸🇪", patterns: [/(^|\W)SE(?=\W|$)/, /SWEDEN|SWEDISH/] },
  { id: "dk", label: "Danimarka", flag: "🇩🇰", patterns: [/(^|\W)DK(?=\W|$)/, /DENMARK|DANISH/] },
  { id: "ru", label: "Rusya", flag: "🇷🇺", patterns: [/(^|\W)RU(?=\W|$)/, /RUSSIA|RUSSIAN/] },
  { id: "br", label: "Brezilya", flag: "🇧🇷", patterns: [/(^|\W)BR(?=\W|$)/, /BRAZIL/] },
  { id: "latam", label: "Latin Amerika", flag: "🌎", patterns: [/LATIN AMERICA|LATAM|(^|\W)COL(?=\W|$)/] },
  { id: "arabic", label: "Arapça", flag: "🌍", patterns: [/ARABIC|ARABIA|MIDDLE EAST/] },
  { id: "kurdish", label: "Kürtçe", flag: "🌄", patterns: [/KURDISH|(^|\W)KU(?=\W|$)/] },
  { id: "other", label: "Diğer", flag: "🌐", patterns: [] }
] as const;

export const CATEGORIES = [
  { id: "all", label: "Tümü", icon: "▦" },
  { id: "national", label: "Ulusal", icon: "◉" },
  { id: "news", label: "Haber", icon: "▤" },
  { id: "sports", label: "Spor", icon: "⚽" },
  { id: "kids", label: "Çocuk", icon: "★" },
  { id: "documentary", label: "Belgesel", icon: "◎" }
] as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function classifyCategory(searchable: string) {
  if (/BELGESEL|DOCUMENTA(?:RY|IRE)|NATURE|DISCOVERY|NAT GEO/.test(searchable)) return "documentary";
  if (/COCUK|KIDS?|CHILD|CARTOON|NICK(?:ELODEON)?|MINIKA/.test(searchable)) return "kids";
  if (/HABER|NEWS|CNN|BBC WORLD|BULTEN/.test(searchable)) return "news";
  if (/SPOR|SPORT|FUTBOL|FOOTBALL|BEIN|DAZN|NFL|NBA|LALIGA|LIGA DE CAMPEONES|EUROSPORT/.test(searchable)) return "sports";
  return "national";
}

export function classifyChannel(channel: Pick<ChannelLike, "title" | "groupTitle">): ChannelClassification {
  const normalizedGroup = normalize(channel.groupTitle ?? "");
  const normalizedTitle = normalize(channel.title);
  const searchable = `${normalizedGroup} ${normalizedTitle}`;
  const recognizedCountries = COUNTRIES.filter((item) => item.id !== "other");
  const countryFromGroup = recognizedCountries.find((item) => item.patterns.some((pattern) => pattern.test(normalizedGroup)));
  const countryFromTitle = recognizedCountries.find((item) => item.patterns.some((pattern) => pattern.test(normalizedTitle)));

  return {
    countryId: countryFromGroup?.id ?? countryFromTitle?.id ?? "other",
    categoryId: classifyCategory(searchable)
  };
}

export function mergeChannelPages<T extends { id: string }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export function buildCatalogPageNumbers(total: number, pageSize: number) {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || total <= pageSize || pageSize <= 0) return [];
  return Array.from({ length: Math.ceil(total / pageSize) - 1 }, (_, index) => index + 2);
}

export type CatalogSnapshot<T> = {
  items: T[];
  total: number | null;
  groups: Array<{ title: string; count: number }>;
};

type CatalogPage<T> = {
  items: T[];
  total?: number;
  groups?: Array<{ title: string; count: number }>;
};

export async function loadCatalogPages<T extends { id: string }>(input: {
  pageSize: number;
  fetchPage: (input: { page: number; signal?: AbortSignal }) => Promise<CatalogPage<T>>;
  onPage: (snapshot: CatalogSnapshot<T>, isFirstPage: boolean) => void;
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
}): Promise<CatalogSnapshot<T>> {
  const { pageSize, signal } = input;
  signal?.throwIfAborted();
  const firstPage = await input.fetchPage({ page: 1, signal });
  signal?.throwIfAborted();

  const items = [...(firstPage.items ?? [])];
  const seen = new Set(items.map((item) => item.id));
  let total = typeof firstPage.total === "number" ? firstPage.total : null;
  const groups = firstPage.groups ?? [];
  input.onPage({ items: [...items], total, groups }, true);
  input.onProgress?.(items.length, total);

  const append = (incoming: T[]) => {
    for (const item of incoming) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  };

  if (total !== null) {
    const remainingPages = buildCatalogPageNumbers(total, pageSize);
    for (let index = 0; index < remainingPages.length; index += 6) {
      signal?.throwIfAborted();
      const batch = remainingPages.slice(index, index + 6);
      const pages = await Promise.all(batch.map((page) => input.fetchPage({ page, signal })));
      signal?.throwIfAborted();
      for (const page of pages) append(page.items ?? []);
      input.onProgress?.(items.length, total);
    }
  } else {
    let page = 2;
    while (true) {
      signal?.throwIfAborted();
      const response = await input.fetchPage({ page, signal });
      signal?.throwIfAborted();
      const previousCount = items.length;
      append(response.items ?? []);
      if (typeof response.total === "number") total = response.total;
      input.onProgress?.(items.length, total);
      if (!response.items?.length || items.length === previousCount || response.items.length < pageSize || (total !== null && items.length >= total)) break;
      page += 1;
    }
  }

  const snapshot = { items, total, groups };
  if (items.length !== firstPage.items?.length) input.onPage(snapshot, false);
  return snapshot;
}

export function createCatalogMemoryCache<T>(options: {
  now?: () => number;
  freshForMs?: number;
  maxAgeMs?: number;
  maxEntries?: number;
} = {}) {
  const now = options.now ?? Date.now;
  const freshForMs = options.freshForMs ?? 10 * 60 * 1000;
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 1;
  const entries = new Map<string, { snapshot: T; savedAt: number }>();
  const keyFor = (account: string, scope: string) => `${account}\u0000${scope}`;

  return {
    get(account: string, scope: string) {
      const key = keyFor(account, scope);
      const entry = entries.get(key);
      if (!entry) return null;
      const age = now() - entry.savedAt;
      if (age > maxAgeMs) {
        entries.delete(key);
        return null;
      }
      return { snapshot: entry.snapshot, fresh: age <= freshForMs };
    },
    set(account: string, scope: string, snapshot: T) {
      const key = keyFor(account, scope);
      entries.delete(key);
      entries.set(key, { snapshot, savedAt: now() });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    clear() {
      entries.clear();
    }
  };
}

export async function loadCatalogWithCache<T extends { id: string }>(input: {
  cache: {
    get: (account: string, scope: string) => { snapshot: CatalogSnapshot<T>; fresh: boolean } | null;
    set: (account: string, scope: string, snapshot: CatalogSnapshot<T>) => void;
  };
  account: string;
  scope: string;
  pageSize: number;
  fetchPage: (input: { page: number; signal?: AbortSignal }) => Promise<CatalogPage<T>>;
  onPage: (snapshot: CatalogSnapshot<T>, isFirstPage: boolean) => void;
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
}): Promise<CatalogSnapshot<T>> {
  const cached = input.cache.get(input.account, input.scope);
  if (cached) {
    input.onPage(cached.snapshot, false);
    if (cached.fresh) return cached.snapshot;
  }

  let publishedFinal = false;
  const snapshot = await loadCatalogPages({
    pageSize: input.pageSize,
    fetchPage: input.fetchPage,
    signal: input.signal,
    onProgress: input.onProgress,
    onPage: (next, isFirstPage) => {
      if (cached && isFirstPage) return;
      if (!isFirstPage) publishedFinal = true;
      input.onPage(next, isFirstPage);
    }
  });
  input.cache.set(input.account, input.scope, snapshot);
  if (cached && !publishedFinal) input.onPage(snapshot, false);
  return snapshot;
}
