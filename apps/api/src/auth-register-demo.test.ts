import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("dotenv", () => ({ config: () => ({}) }));
vi.hoisted(() => Object.assign(process.env, { APP_DEMO_MODE: "true", PHONE_AUTH_ENABLED: "false" }));
import * as demo from "./demo-store.js";
import * as repository from "./repository.js";
import { buildServer } from "./server.js";

describe("retired registration in demo mode", () => {
  const app = buildServer();
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());
  it("cannot create an unverified account through the old demo shortcut", async () => {
    const create = vi.spyOn(demo, "registerDemoUser");
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue(null);
    try {
      const result = await app.inject({ method: "POST", url: "/auth/register-anon", payload: { installationId: "fixture-demo-installation" } });
      expect(result.statusCode).toBe(410);
      expect(result.json()).toEqual({ reason: "phone_verification_required", message: "Yeni hesap oluşturmak için WhatsApp doğrulamasını kullanın." });
      expect(create).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
