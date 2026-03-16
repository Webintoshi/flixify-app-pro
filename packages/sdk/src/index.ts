import {
  deviceSessionsResponseSchema,
  authResponseSchema,
  livePlaybackEventInputSchema,
  livePlaybackResponseSchema,
  loginByCodeInputSchema,
  liveCatalogResponseSchema,
  meResponseSchema,
  movieCatalogResponseSchema,
  packagesResponseSchema,
  paymentRequestInputSchema,
  refreshInputSchema,
  registerAnonInputSchema,
  seriesCatalogResponseSchema,
  trialRequestInputSchema,
  vodPlaybackResponseSchema
} from "@flixify/contracts";
import type { z } from "zod";

export type AuthResponse = z.infer<typeof authResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type LiveCatalogResponse = z.infer<typeof liveCatalogResponseSchema>;
export type LivePlaybackResponse = z.infer<typeof livePlaybackResponseSchema>;
export type VodPlaybackResponse = z.infer<typeof vodPlaybackResponseSchema>;
export type MovieCatalogResponse = z.infer<typeof movieCatalogResponseSchema>;
export type SeriesCatalogResponse = z.infer<typeof seriesCatalogResponseSchema>;
export type PackagesResponse = z.infer<typeof packagesResponseSchema>;
export type DeviceSessionsResponse = z.infer<typeof deviceSessionsResponseSchema>;

type ClientOptions = {
  baseUrl: string;
  getAccessToken?: () => string | null;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type ResolveLivePlaybackOptions = {
  forceRelayRestart?: boolean;
  debugFileProxy?: boolean;
  preferRelay?: boolean;
};

export type ResolveVodPlaybackOptions = {
  debugVod?: boolean;
  preferTranscode?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class FlixifyClient {
  constructor(private readonly options: ClientOptions) {}

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const accessToken = this.options.getAccessToken?.();
    const headers: Record<string, string> = {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers ?? {})
    };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(errorText || `Request failed with ${response.status}`, response.status, errorText);
    }

    return (await response.json()) as T;
  }

  registerAnon(input: z.input<typeof registerAnonInputSchema>) {
    const payload = registerAnonInputSchema.parse(input);
    return this.request<AuthResponse>("/auth/register-anon", {
      method: "POST",
      body: payload
    });
  }

  loginByCode(input: z.input<typeof loginByCodeInputSchema>) {
    const payload = loginByCodeInputSchema.parse(input);
    return this.request<AuthResponse>("/auth/login-by-code", {
      method: "POST",
      body: payload
    });
  }

  refresh(refreshToken: string) {
    const payload = refreshInputSchema.parse({ refreshToken });
    return this.request<AuthResponse>("/auth/refresh", {
      method: "POST",
      body: payload
    });
  }

  me() {
    return this.request<MeResponse>("/me");
  }

  packages() {
    return this.request<PackagesResponse>("/admin/packages/public");
  }

  liveCatalog(query = "") {
    return this.request<LiveCatalogResponse>(`/me/catalog/live${query}`);
  }

  resolveLivePlayback(channelId: string, options: ResolveLivePlaybackOptions = {}) {
    const query = new URLSearchParams();
    if (options.forceRelayRestart) {
      query.set("forceRelayRestart", "true");
    }
    if (options.debugFileProxy) {
      query.set("debugFileProxy", "true");
    }
    if (typeof options.preferRelay === "boolean") {
      query.set("preferRelay", options.preferRelay ? "true" : "false");
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<LivePlaybackResponse>(`/me/live/${channelId}/playback${suffix}`);
  }

  resolveVodPlayback(kind: "movie" | "episode", itemId: string, options: ResolveVodPlaybackOptions = {}) {
    const query = new URLSearchParams();
    if (options.debugVod) {
      query.set("debugVod", "true");
    }
    if (options.preferTranscode) {
      query.set("preferTranscode", "true");
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<VodPlaybackResponse>(`/me/vod/${kind}/${itemId}/playback${suffix}`);
  }

  reportLivePlayback(
    channelId: string,
    input: z.input<typeof livePlaybackEventInputSchema>
  ) {
    const payload = livePlaybackEventInputSchema.parse(input);
    return this.request<{ ok: true }>(`/me/live/${channelId}/health`, {
      method: "POST",
      body: payload
    });
  }

  movieCatalog(query = "") {
    return this.request<MovieCatalogResponse>(`/me/catalog/movies${query}`);
  }

  seriesCatalog(query = "") {
    return this.request<SeriesCatalogResponse>(`/me/catalog/series${query}`);
  }

  paymentRequest(input: z.input<typeof paymentRequestInputSchema>) {
    const payload = paymentRequestInputSchema.parse(input);
    return this.request<{ ok: true }>("/me/payment-requests", {
      method: "POST",
      body: payload
    });
  }

  myPaymentRequests() {
    return this.request<{ items: Array<{ id: string; status: string; packageTitle: string; createdAt: string }> }>("/me/payment-requests");
  }

  trialRequest(input: z.input<typeof trialRequestInputSchema>) {
    const payload = trialRequestInputSchema.parse(input);
    return this.request<{ ok: true }>("/me/trial-request", {
      method: "POST",
      body: payload
    });
  }

  myDeviceSessions() {
    return this.request<DeviceSessionsResponse>("/me/device-sessions");
  }

  revokeMyDeviceSession(sessionId: string) {
    return this.request<{ ok: true }>(`/me/device-sessions/${sessionId}/revoke`, {
      method: "POST"
    });
  }
}
