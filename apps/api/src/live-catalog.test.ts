import { describe, expect, it } from "vitest";
import {
  buildLiveCatalogOrderByClause,
  isTurkiyeLiveGroupFilter
} from "./repository.js";
import { matchesCatalogGroupFilter } from "./demo-store.js";

describe("live catalog turkiye filter", () => {
  it("detects turkiye group case-insensitively", () => {
    expect(isTurkiyeLiveGroupFilter("turkiye")).toBe(true);
    expect(isTurkiyeLiveGroupFilter("TURKIYE")).toBe(true);
    expect(isTurkiyeLiveGroupFilter(" turkiye ")).toBe(true);
    expect(isTurkiyeLiveGroupFilter("TR:SPOR")).toBe(false);
    expect(isTurkiyeLiveGroupFilter(undefined)).toBe(false);
  });

  it("uses provider order only for turkiye mode", () => {
    const turkiyeOrder = buildLiveCatalogOrderByClause(true);
    const defaultOrder = buildLiveCatalogOrderByClause(false);

    expect(turkiyeOrder).toContain("c.order_index asc");
    expect(turkiyeOrder).not.toContain("health_status");
    expect(defaultOrder).toContain("health_status");
    expect(defaultOrder).toContain("c.order_index asc");
    expect(defaultOrder).toContain("c.title asc");
  });

  it("matches only TR: prefixed groups for turkiye filter in demo mode", () => {
    expect(matchesCatalogGroupFilter("TR:SPOR", "turkiye")).toBe(true);
    expect(matchesCatalogGroupFilter("tr:haber", "turkiye")).toBe(true);
    expect(matchesCatalogGroupFilter("TR SPOR", "turkiye")).toBe(false);
    expect(matchesCatalogGroupFilter("SPORT", "turkiye")).toBe(false);
  });

  it("keeps exact group matching for non-turkiye filters", () => {
    expect(matchesCatalogGroupFilter("TR:SPOR", "tr:spor")).toBe(true);
    expect(matchesCatalogGroupFilter("TR:SPOR", "tr:haber")).toBe(false);
    expect(matchesCatalogGroupFilter(null, "diger")).toBe(true);
  });
});
