import { describe, expect, it } from "vitest";
import {
  API_CORS_CONFIG,
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_MAX_AGE_SECONDS
} from "./cors-config.js";

describe("api cors config", () => {
  it("allows admin write methods in preflight", () => {
    expect(CORS_ALLOWED_METHODS).toEqual([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ]);
    expect(API_CORS_CONFIG.methods).toEqual(CORS_ALLOWED_METHODS);
  });

  it("allows required request headers", () => {
    expect(CORS_ALLOWED_HEADERS).toEqual([
      "authorization",
      "content-type"
    ]);
    expect(API_CORS_CONFIG.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
  });

  it("keeps open cors origin reflection and stable preflight behavior", () => {
    expect(API_CORS_CONFIG.origin).toBe(true);
    expect(API_CORS_CONFIG.optionsSuccessStatus).toBe(204);
    expect(API_CORS_CONFIG.maxAge).toBe(CORS_MAX_AGE_SECONDS);
    expect(API_CORS_CONFIG.preflightContinue).toBe(false);
  });
});
