import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as repository from "./repository.js";
import { buildServer } from "./server.js";

describe("POST /auth/register-anon", () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("blocks creating a second active account for the same installation", async () => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue({
      id: "existing-user",
      status: "active",
      deleted_at: null
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register-anon",
      payload: {
        deviceName: "Flixify Native Qt",
        platform: "windows-native-qt",
        installationId: "install-1234567890abcd"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message:
        "Bu cihazda zaten bir hesabınız bulunmaktadır. Yeni hesap oluşturmak için mevcut hesabın sistemden silinmesi gerekir."
    });
  });
});
