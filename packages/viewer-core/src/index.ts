import { useEffect, useRef, useState } from "react";
import {
  livePlaybackEventInputSchema,
  vodPlaybackEventInputSchema,
  type CatalogGroup,
  type DeviceSessionRecord,
  type LiveChannel,
  type MovieRecord,
  type PaymentMethodOption,
  type PackageRecord,
  type SeriesRecord,
  type UserSummary
} from "@flixify/contracts";
import type { z } from "zod";
import {
  ApiError,
  FlixifyClient,
  type MeResponse,
  type ResolveLivePlaybackOptions,
  type ResolveVodPlaybackOptions
} from "@flixify/sdk";

export const viewerRoutes = [
  "/canli-tv",
  "/filmler",
  "/diziler",
  "/paketler",
  "/odemeler",
  "/ayarlar",
  "/iletisim"
] as const;

export const loginRoute = "/giris-yap" as const;
export const registerRoute = "/kayit-ol" as const;
export const legacyAuthRedirects = {
  "/register": registerRoute,
  "/giris": loginRoute
} as const;

export type ViewerRoute = (typeof viewerRoutes)[number];
export type ViewerViewState =
  | "unauthenticated"
  | "loading"
  | "authenticated-no-link"
  | "authenticated-no-package"
  | "authenticated-active"
  | "blocked";

export type ViewerSession = {
  accessToken: string;
  refreshToken: string;
  user: UserSummary;
};

export type ViewerStorageAdapter = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

export type ViewerCoreOptions = {
  baseUrl: string;
  storage: ViewerStorageAdapter;
  platform: string;
  defaultDeviceName: string;
  sessionStorageKey?: string;
};

export type CatalogState = {
  live: LiveChannel[];
  movies: MovieRecord[];
  series: SeriesRecord[];
  liveGroups: CatalogGroup[];
  movieGroups: CatalogGroup[];
  seriesGroups: CatalogGroup[];
  livePagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  moviePagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  seriesPagination: {
    page: number;
    pageSize: number;
    total: number;
  };
};

const emptyCatalogState: CatalogState = {
  live: [],
  movies: [],
  series: [],
  liveGroups: [],
  movieGroups: [],
  seriesGroups: [],
  livePagination: {
    page: 1,
    pageSize: 100,
    total: 0
  },
  moviePagination: {
    page: 1,
    pageSize: 18,
    total: 0
  },
  seriesPagination: {
    page: 1,
    pageSize: 18,
    total: 0
  }
};

export type ViewerPaymentRequest = {
  id: string;
  status: string;
  packageTitle: string;
  createdAt: string;
};

export type ViewerPaymentMethod = PaymentMethodOption;

const defaultViewerPaymentMethods: ViewerPaymentMethod[] = [
  {
    id: "bank-transfer-eft",
    label: "Banka Havale / EFT",
    enabled: true,
    details: null
  },
  {
    id: "crypto",
    label: "Kripto",
    enabled: true,
    details: null
  },
  {
    id: "bank-card",
    label: "Banka Karti",
    enabled: true,
    details: null
  }
];

export function createBrowserStorageAdapter(storage: Storage): ViewerStorageAdapter {
  return {
    getItem(key) {
      return storage.getItem(key);
    },
    setItem(key, value) {
      storage.setItem(key, value);
    },
    removeItem(key) {
      storage.removeItem(key);
    }
  };
}

export function createInMemoryStorageAdapter(initialValue: Record<string, string> = {}): ViewerStorageAdapter {
  const memory = new Map(Object.entries(initialValue));
  return {
    getItem(key) {
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
    },
    removeItem(key) {
      memory.delete(key);
    }
  };
}

export function deriveViewerViewState(user: UserSummary | null | undefined): ViewerViewState {
  if (!user) {
    return "unauthenticated";
  }

  if (user.status === "blocked") {
    return "blocked";
  }

  if (!user.hasAssignedLink) {
    return "authenticated-no-link";
  }

  if (!user.hasActiveSubscription) {
    return "authenticated-no-package";
  }

  return "authenticated-active";
}

function getCodeLabel(kryptoniteCode: string | null | undefined, codeSuffix: string | null | undefined) {
  if (kryptoniteCode) {
    return kryptoniteCode;
  }

  if (codeSuffix) {
    return `Kod hazir degil (${codeSuffix})`;
  }

  return "Kod hazir degil";
}

export function useViewerCore(options: ViewerCoreOptions) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<ViewerSession | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogState>(emptyCatalogState);
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionRecord[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<ViewerPaymentRequest[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ViewerPaymentMethod[]>([]);
  const [lastIssuedCode, setLastIssuedCode] = useState<string | null>(null);
  const catalogsRef = useRef<CatalogState>(emptyCatalogState);
  const sessionRef = useRef<ViewerSession | null>(null);
  const liveCatalogRequestIdRef = useRef(0);
  const movieCatalogRequestIdRef = useRef(0);
  const seriesCatalogRequestIdRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const sessionKey = options.sessionStorageKey ?? "flixify-viewer-session";

  const clientRef = useRef(
    new FlixifyClient({
      baseUrl: options.baseUrl,
      getAccessToken: () => sessionRef.current?.accessToken ?? null
    })
  );

  async function persistSession(nextSession: ViewerSession | null) {
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (!nextSession) {
      await Promise.resolve(options.storage.removeItem(sessionKey));
      return;
    }

    await Promise.resolve(options.storage.setItem(sessionKey, JSON.stringify(nextSession)));
  }

  async function loadPackages() {
    const response = await clientRef.current.packages();
    setPackages(response.items);
  }

  async function loadPaymentMethods() {
    try {
      const response = await clientRef.current.paymentMethodsPublic();
      const nextItems = response.items.length > 0 ? response.items : defaultViewerPaymentMethods;
      setPaymentMethods(nextItems);
    } catch {
      setPaymentMethods(defaultViewerPaymentMethods);
    }
  }

  function isUnauthorizedError(error: unknown) {
    return error instanceof ApiError && error.status === 401;
  }

  async function clearAuthenticatedState() {
    await persistSession(null);
    setMe(null);
    setDeviceSessions([]);
    setPaymentRequests([]);
    catalogsRef.current = emptyCatalogState;
    setCatalogs(emptyCatalogState);
    setLastIssuedCode(null);
  }

  async function refreshSessionOnly(storedSession: ViewerSession) {
    const refreshed = await clientRef.current.refresh(storedSession.refreshToken);
    const nextSession = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      user: refreshed.user
    };
    await persistSession(nextSession);
    setLastIssuedCode(null);
    setMe((current) => (current ? { ...current, user: refreshed.user } : current));
    return true;
  }

  async function ensureFreshSession() {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const currentSession = sessionRef.current;
    if (!currentSession) {
      return false;
    }

    refreshPromiseRef.current = (async () => {
      try {
        return await refreshSessionOnly(currentSession);
      } catch {
        await clearAuthenticatedState();
        await loadPackages().catch(() => undefined);
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }

  async function runAuthenticatedRequest<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (!isUnauthorizedError(error) || !sessionRef.current) {
        throw error;
      }

      const refreshed = await ensureFreshSession();
      if (!refreshed) {
        throw new Error("Oturum suresi doldu.");
      }

      return operation();
    }
  }

  async function loadDeviceSessions() {
    if (!sessionRef.current) {
      setDeviceSessions([]);
      return;
    }

    const response = await runAuthenticatedRequest(() => clientRef.current.myDeviceSessions());
    setDeviceSessions(response.items);
  }

  async function loadPaymentRequests() {
    if (!sessionRef.current) {
      setPaymentRequests([]);
      return;
    }

    const response = await runAuthenticatedRequest(() => clientRef.current.myPaymentRequests());
    setPaymentRequests(response.items);
  }

  function buildCatalogSuffix(
    page: number,
    pageSize: number,
    params?: { search?: string; group?: string }
  ) {
    const query = new URLSearchParams();
    query.set("page", String(Math.max(1, page)));
    query.set("pageSize", String(Math.max(1, pageSize)));
    if (params?.search) {
      query.set("search", params.search);
    }
    if (params?.group) {
      query.set("group", params.group);
    }
    return `?${query.toString()}`;
  }

  async function loadLiveCatalog(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    const requestId = liveCatalogRequestIdRef.current + 1;
    const accessToken = sessionRef.current.accessToken;
    liveCatalogRequestIdRef.current = requestId;

    const live = await runAuthenticatedRequest(() =>
      clientRef.current.liveCatalog(buildCatalogSuffix(1, 100, params))
    );

    if (liveCatalogRequestIdRef.current !== requestId || sessionRef.current?.accessToken !== accessToken) {
      return;
    }

    setCatalogs((current) => {
      const nextCatalogs: CatalogState = {
        ...current,
        live: live.items,
        liveGroups: live.groups,
        livePagination: {
          page: live.page,
          pageSize: live.pageSize,
          total: live.total
        }
      };
      catalogsRef.current = nextCatalogs;
      return nextCatalogs;
    });
  }

  async function loadMoreLive(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    const currentCatalogs = catalogsRef.current;
    const { page, pageSize, total } = currentCatalogs.livePagination;
    if (currentCatalogs.live.length >= total && total > 0) {
      return;
    }

    const requestId = liveCatalogRequestIdRef.current + 1;
    const accessToken = sessionRef.current.accessToken;
    liveCatalogRequestIdRef.current = requestId;

    const live = await runAuthenticatedRequest(() =>
      clientRef.current.liveCatalog(buildCatalogSuffix(page + 1, pageSize || 100, params))
    );

    if (liveCatalogRequestIdRef.current !== requestId || sessionRef.current?.accessToken !== accessToken) {
      return;
    }

    setCatalogs((current) => {
      const existingIds = new Set(current.live.map((item) => item.id));
      const mergedLive = [...current.live, ...live.items.filter((item) => !existingIds.has(item.id))];
      const nextCatalogs: CatalogState = {
        ...current,
        live: mergedLive,
        liveGroups: live.groups,
        livePagination: {
          page: live.page,
          pageSize: live.pageSize,
          total: live.total
        }
      };
      catalogsRef.current = nextCatalogs;
      return nextCatalogs;
    });
  }

  async function loadMoviesCatalog(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    const requestId = movieCatalogRequestIdRef.current + 1;
    const accessToken = sessionRef.current.accessToken;
    movieCatalogRequestIdRef.current = requestId;

    const movies = await runAuthenticatedRequest(() =>
      clientRef.current.movieCatalog(buildCatalogSuffix(1, 18, params))
    );

    if (movieCatalogRequestIdRef.current !== requestId || sessionRef.current?.accessToken !== accessToken) {
      return;
    }

    setCatalogs((current) => {
      const nextCatalogs: CatalogState = {
        ...current,
        movies: movies.items,
        movieGroups: movies.groups,
        moviePagination: {
          page: movies.page,
          pageSize: movies.pageSize,
          total: movies.total
        }
      };
      catalogsRef.current = nextCatalogs;
      return nextCatalogs;
    });
  }

  async function loadSeriesCatalog(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    const requestId = seriesCatalogRequestIdRef.current + 1;
    const accessToken = sessionRef.current.accessToken;
    seriesCatalogRequestIdRef.current = requestId;

    const series = await runAuthenticatedRequest(() =>
      clientRef.current.seriesCatalog(buildCatalogSuffix(1, 18, params))
    );

    if (seriesCatalogRequestIdRef.current !== requestId || sessionRef.current?.accessToken !== accessToken) {
      return;
    }

    setCatalogs((current) => {
      const nextCatalogs: CatalogState = {
        ...current,
        series: series.items,
        seriesGroups: series.groups,
        seriesPagination: {
          page: series.page,
          pageSize: series.pageSize,
          total: series.total
        }
      };
      catalogsRef.current = nextCatalogs;
      return nextCatalogs;
    });
  }

  async function loadCatalogs(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    await Promise.all([
      loadLiveCatalog(params),
      loadMoviesCatalog(params),
      loadSeriesCatalog(params)
    ]);
  }

  async function loadMoreMovies(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    const currentCatalogs = catalogsRef.current;
    const { page, pageSize, total } = currentCatalogs.moviePagination;
    if (currentCatalogs.movies.length >= total && total > 0) {
      return;
    }

    const requestId = movieCatalogRequestIdRef.current + 1;
    const accessToken = sessionRef.current.accessToken;
    movieCatalogRequestIdRef.current = requestId;

    const movies = await runAuthenticatedRequest(() =>
      clientRef.current.movieCatalog(buildCatalogSuffix(page + 1, pageSize || 18, params))
    );

    if (movieCatalogRequestIdRef.current !== requestId || sessionRef.current?.accessToken !== accessToken) {
      return;
    }

    setCatalogs((current) => {
      const existingIds = new Set(current.movies.map((item) => item.id));
      const mergedMovies = [...current.movies, ...movies.items.filter((item) => !existingIds.has(item.id))];
      const nextCatalogs: CatalogState = {
        ...current,
        movies: mergedMovies,
        movieGroups: movies.groups,
        moviePagination: {
          page: movies.page,
          pageSize: movies.pageSize,
          total: movies.total
        }
      };

      catalogsRef.current = nextCatalogs;
      return nextCatalogs;
    });
  }

  async function loadMoreSeries(params?: { search?: string; group?: string }) {
    if (!sessionRef.current) {
      return;
    }

    const currentCatalogs = catalogsRef.current;
    const { page, pageSize, total } = currentCatalogs.seriesPagination;
    if (currentCatalogs.series.length >= total && total > 0) {
      return;
    }

    const requestId = seriesCatalogRequestIdRef.current + 1;
    const accessToken = sessionRef.current.accessToken;
    seriesCatalogRequestIdRef.current = requestId;

    const series = await runAuthenticatedRequest(() =>
      clientRef.current.seriesCatalog(buildCatalogSuffix(page + 1, pageSize || 18, params))
    );

    if (seriesCatalogRequestIdRef.current !== requestId || sessionRef.current?.accessToken !== accessToken) {
      return;
    }

    setCatalogs((current) => {
      const existingIds = new Set(current.series.map((item) => item.id));
      const mergedSeries = [...current.series, ...series.items.filter((item) => !existingIds.has(item.id))];
      const nextCatalogs: CatalogState = {
        ...current,
        series: mergedSeries,
        seriesGroups: series.groups,
        seriesPagination: {
          page: series.page,
          pageSize: series.pageSize,
          total: series.total
        }
      };

      catalogsRef.current = nextCatalogs;
      return nextCatalogs;
    });
  }

  async function loadMeAndData(params?: { search?: string; group?: string }) {
    const response = await runAuthenticatedRequest(() => clientRef.current.me());
    setMe(response);

    await Promise.all([
      loadPackages(),
      loadPaymentMethods(),
      loadDeviceSessions(),
      loadPaymentRequests(),
      response.user.hasAssignedLink ? loadCatalogs(params) : Promise.resolve()
    ]);
  }

  async function refreshMe() {
    if (!sessionRef.current) {
      setMe(null);
      return null;
    }

    const response = await runAuthenticatedRequest(() => clientRef.current.me());
    setMe(response);
    return response;
  }

  async function attemptRefresh(storedSession: ViewerSession) {
    try {
      await refreshSessionOnly(storedSession);
      await loadMeAndData();
      return true;
    } catch {
      return false;
    }
  }

  async function bootstrap() {
    setLoading(true);
    setError(null);

    try {
      const raw = await Promise.resolve(options.storage.getItem(sessionKey));
      if (!raw) {
        await loadPackages();
        await loadPaymentMethods();
        setMe(null);
        setDeviceSessions([]);
        return;
      }

      const storedSession = JSON.parse(raw) as ViewerSession;
      await persistSession(storedSession);

      try {
        await loadMeAndData();
      } catch {
        const refreshed = await attemptRefresh(storedSession);
        if (!refreshed) {
          await persistSession(null);
          setMe(null);
          setDeviceSessions([]);
          setPaymentRequests([]);
          await Promise.all([loadPackages(), loadPaymentMethods()]);
        }
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Viewer bootstrap basarisiz");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  async function registerAnon(deviceName = options.defaultDeviceName) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await clientRef.current.registerAnon({
        deviceName,
        platform: options.platform
      });
      const nextSession = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        user: response.user
      };
      await persistSession(nextSession);
      setLastIssuedCode(response.kryptoniteCode);
      await loadMeAndData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kayit olusturulamadi");
    } finally {
      setBusy(false);
    }
  }

  async function issueAnonCode(deviceName = options.defaultDeviceName) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await clientRef.current.registerAnon({
        deviceName,
        platform: options.platform
      });
      setLastIssuedCode(response.kryptoniteCode);
      return response.kryptoniteCode;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kayit olusturulamadi");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loginByCode(code: string, deviceName = options.defaultDeviceName) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await clientRef.current.loginByCode({
        code: code.toUpperCase(),
        deviceName,
        platform: options.platform
      });
      const nextSession = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        user: response.user
      };
      await persistSession(nextSession);
      setLastIssuedCode(null);
      await loadMeAndData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Giris basarisiz");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await persistSession(null);
    setMe(null);
    setDeviceSessions([]);
    setPaymentRequests([]);
    catalogsRef.current = emptyCatalogState;
    setCatalogs(emptyCatalogState);
    setNotice(null);
    setError(null);
    setLastIssuedCode(null);
    await Promise.all([loadPackages(), loadPaymentMethods()]);
  }

  async function requestTrial(note?: string) {
    setBusy(true);
    setError(null);
    try {
      await runAuthenticatedRequest(() => clientRef.current.trialRequest({ note }));
      setNotice("Deneme talebiniz olusturuldu ve admin paneline iletildi.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Deneme talebi olusturulamadi");
    } finally {
      setBusy(false);
    }
  }

  async function requestPayment(packageSlug: string) {
    setBusy(true);
    setError(null);
    try {
      await runAuthenticatedRequest(() => clientRef.current.paymentRequest({ packageSlug }));
      setNotice("Odeme talebi olusturuldu. Lutfen WhatsApp veya Telegram ile ekibe ulasin.");
      await loadPaymentRequests();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Odeme talebi olusturulamadi");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDeviceSession(sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      await runAuthenticatedRequest(() => clientRef.current.revokeMyDeviceSession(sessionId));
      setNotice("Cihaz oturumu sonlandirildi.");
      await loadDeviceSessions();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Cihaz oturumu kapatilamadi");
    } finally {
      setBusy(false);
    }
  }

  async function resolveLivePlayback(channelId: string, options?: ResolveLivePlaybackOptions) {
    return runAuthenticatedRequest(() => clientRef.current.resolveLivePlayback(channelId, options));
  }

  async function resolveVodPlayback(kind: "movie" | "episode", itemId: string, options?: ResolveVodPlaybackOptions) {
    return runAuthenticatedRequest(() => clientRef.current.resolveVodPlayback(kind, itemId, options));
  }

  async function reportLivePlayback(
    channelId: string,
    event: "playing" | "stalled" | "recovered" | "failed",
    input?: Omit<z.input<typeof livePlaybackEventInputSchema>, "event">
  ) {
    return runAuthenticatedRequest(() =>
      clientRef.current.reportLivePlayback(channelId, {
        event,
        ...(input ?? {}),
        errorMessage: input?.errorMessage ?? null
      })
    );
  }

  async function reportVodPlayback(
    kind: "movie" | "episode",
    itemId: string,
    input: z.input<typeof vodPlaybackEventInputSchema>
  ) {
    return runAuthenticatedRequest(() =>
      clientRef.current.reportVodPlayback(kind, itemId, {
        ...input,
        errorMessage: input.errorMessage ?? null
      })
    );
  }

  return {
    loading,
    busy,
    error,
    notice,
    session,
    me,
    packages,
    catalogs,
    deviceSessions,
    paymentRequests,
    paymentMethods,
    lastIssuedCode,
    codeLabel: getCodeLabel(me?.user.kryptoniteCode, me?.user.codeSuffix),
    maskedCodeLabel: getCodeLabel(me?.user.kryptoniteCode, me?.user.codeSuffix),
    viewState: loading ? ("loading" as const) : deriveViewerViewState(me?.user),
    bootstrap,
    loadCatalogs,
    loadLiveCatalog,
    loadMoreLive,
    loadMoviesCatalog,
    loadSeriesCatalog,
    loadMoreMovies,
    loadMoreSeries,
    loadPackages,
    loadPaymentMethods,
    loadDeviceSessions,
    loadPaymentRequests,
    refreshMe,
    registerAnon,
    issueAnonCode,
    loginByCode,
    logout,
    requestTrial,
    requestPayment,
    revokeDeviceSession,
    resolveLivePlayback,
    resolveVodPlayback,
    reportLivePlayback,
    reportVodPlayback,
    clearNotice() {
      setNotice(null);
    },
    clearError() {
      setError(null);
    }
  };
}
