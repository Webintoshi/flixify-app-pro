import {
  appUpdateCheckResponseSchema,
  deviceSessionsResponseSchema,
  authResponseSchema,
  livePlaybackEventInputSchema,
  livePlaybackResponseSchema,
  loginByCodeInputSchema,
  liveCatalogResponseSchema,
  meResponseSchema,
  movieCatalogResponseSchema,
  paymentMethodsResponseSchema,
  packagesResponseSchema,
  paymentRequestInputSchema,
  refreshInputSchema,
  registerAnonInputSchema,
  seriesCatalogResponseSchema,
  trialRequestInputSchema,
  vodPlaybackEventInputSchema,
  vodPlaybackResponseSchema
} from "@flixify/contracts";
import type { z } from "zod";

export type AuthResponse = z.infer<typeof authResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type LiveCatalogResponse = z.infer<typeof liveCatalogResponseSchema>;
export type LivePlaybackResponse = z.infer<typeof livePlaybackResponseSchema>;
export type VodPlaybackResponse = z.infer<typeof vodPlaybackResponseSchema>;
export type AppUpdateCheckResponse = z.infer<typeof appUpdateCheckResponseSchema>;
export type MovieCatalogResponse = z.infer<typeof movieCatalogResponseSchema>;
export type SeriesCatalogResponse = z.infer<typeof seriesCatalogResponseSchema>;
export type PackagesResponse = z.infer<typeof packagesResponseSchema>;
export type PaymentMethodsResponse = z.infer<typeof paymentMethodsResponseSchema>;
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
  preferTranscode?: boolean;
  clientRuntime?: "browser" | "app";
};

export type ResolveVodPlaybackOptions = {
  debugVod?: boolean;
  preferTranscode?: boolean;
  audioTrackId?: string;
  clientRuntime?: "browser" | "app";
};

export type AppUpdateCheckOptions = {
  platform?: string;
  appVersion?: string;
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

  private resolveApiErrorMessage(errorText: string, status: number) {
    const trimmed = errorText.trim();
    if (!trimmed) {
      return `Request failed with ${status}`;
    }

    try {
      const parsed = JSON.parse(trimmed) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
        return parsed.message.trim();
      }
    } catch {
      // Body may not be JSON.
    }

    return trimmed;
  }

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
      throw new ApiError(this.resolveApiErrorMessage(errorText, response.status), response.status, errorText);
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

  paymentMethodsPublic() {
    return this.request<PaymentMethodsResponse>("/payment-methods/public");
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
    if (typeof options.preferTranscode === "boolean") {
      query.set("preferTranscode", options.preferTranscode ? "true" : "false");
    }
    if (options.clientRuntime) {
      query.set("clientRuntime", options.clientRuntime);
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
    if (options.audioTrackId) {
      query.set("audioTrackId", options.audioTrackId);
    }
    if (options.clientRuntime) {
      query.set("clientRuntime", options.clientRuntime);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<VodPlaybackResponse>(`/me/vod/${kind}/${itemId}/playback${suffix}`);
  }

  checkAppUpdate(options: AppUpdateCheckOptions = {}) {
    const query = new URLSearchParams();
    if (options.platform && options.platform.trim().length > 0) {
      query.set("platform", options.platform.trim());
    }
    if (options.appVersion && options.appVersion.trim().length > 0) {
      query.set("appVersion", options.appVersion.trim());
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<AppUpdateCheckResponse>(`/me/app-update/check${suffix}`);
  }

  reportVodPlayback(
    kind: "movie" | "episode",
    itemId: string,
    input: z.input<typeof vodPlaybackEventInputSchema>
  ) {
    const payload = vodPlaybackEventInputSchema.parse(input);
    return this.request<{ ok: true }>(`/me/vod/${kind}/${itemId}/health`, {
      method: "POST",
      body: payload
    });
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
