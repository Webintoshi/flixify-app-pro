import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("website security headers", () => {
  it("protects every page from referrer leakage and framing", async () => {
    const routes = await nextConfig.headers?.();
    const allPages = routes?.find((route) => route.source === "/:path*");
    const headers = Object.fromEntries((allPages?.headers ?? []).map(({ key, value }) => [key, value]));

    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });
});
