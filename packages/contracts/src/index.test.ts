import { describe, expect, it } from "vitest";
import { loginByCodeInputSchema, paginationQuerySchema } from "./schemas";

describe("contracts", () => {
  it("accepts valid kryptonite code payloads", () => {
    const payload = loginByCodeInputSchema.parse({
      code: "ABCD1234EFGH5678",
      deviceName: "Apple TV",
      platform: "tvos"
    });

    expect(payload.code).toBe("ABCD1234EFGH5678");
  });

  it("rejects malformed codes", () => {
    expect(() =>
      loginByCodeInputSchema.parse({
        code: "short"
      })
    ).toThrow();
  });

  it("accepts viewer catalog page sizes up to 300", () => {
    const payload = paginationQuerySchema.parse({
      page: "1",
      pageSize: "300"
    });

    expect(payload.pageSize).toBe(300);
  });
});
