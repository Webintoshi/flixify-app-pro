import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({ env: { APP_JWT_SECRET: "package-fixture-signing-secret-not-for-live-use" } }));

import { activateDemoSubscription, getDemoAdminUserDetail, listDemoPackages } from "./demo-store.js";

const expected = [
  ["1-ay", "1 Ay · Tek Kullanıcı", "1m", 1, "250 ₺"],
  ["6-ay", "6 Ay · Tek Kullanıcı", "6m", 6, "699 ₺"],
  ["12-ay", "12 Ay · Tek Kullanıcı", "12m", 12, "999 ₺"],
  ["1-ay-2-kullanici", "1 Ay · Çift Kullanıcı", "1m", 1, "399 ₺"],
  ["6-ay-2-kullanici", "6 Ay · Çift Kullanıcı", "6m", 6, "999 ₺"],
  ["12-ay-2-kullanici", "12 Ay · Çift Kullanıcı", "12m", 12, "1.399 ₺"]
] as const;

afterEach(() => vi.useRealTimers());

describe("single and dual user sales catalog", () => {
  it("offers precisely six paid variants with the requested prices and durations", () => {
    const active = listDemoPackages().filter((item) => item.isActive);
    expect(active).toHaveLength(6);
    for (const [slug, title, duration, durationMonths, priceLabel] of expected) {
      expect(active.find((item) => item.slug === slug)).toMatchObject({ slug, title, duration, durationMonths, priceLabel });
    }
  });

  it("retains the old three month package as inactive for historical references", () => {
    expect(listDemoPackages().find((item) => item.slug === "3-ay")).toMatchObject({ duration: "3m", durationMonths: 3, isActive: false });
  });

  it.each([["1-ay-2-kullanici", 30], ["6-ay-2-kullanici", 180], ["12-ay-2-kullanici", 365]] as const)(
    "uses the full purchased period for demo variant %s",
    (slug, days) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
      const userId = "87731928-75dc-4ff1-b8be-ef08cca5c10b";
      activateDemoSubscription(userId, slug);
      const active = getDemoAdminUserDetail(userId)?.summary.activePackage;
      expect(active?.title).toContain("Çift Kullanıcı");
      expect(active?.remainingDays).toBe(days);
      expect(Date.parse(active?.endsAt ?? "") - Date.now()).toBe(days * 86400000);
    }
  );

  it("rejects the retired sales plan for new demo activation", () => {
    expect(() => activateDemoSubscription("87731928-75dc-4ff1-b8be-ef08cca5c10b", "3-ay")).toThrow();
  });
});
