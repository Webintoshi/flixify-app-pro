import { describe, expect, it } from "vitest";
import {
  buildLiveCatalogOrderByClause,
  buildLiveCountryFilterWhereClause,
  isTurkiyeLiveGroupFilter,
  resolveLiveCountryFilter
} from "./repository.js";
import { matchesCatalogGroupFilter } from "./demo-store.js";

describe("live catalog turkiye filter", () => {
  it("detects country filters and keeps turkiye backward compatibility", () => {
    expect(isTurkiyeLiveGroupFilter("turkiye")).toBe(true);
    expect(isTurkiyeLiveGroupFilter("TURKIYE")).toBe(true);
    expect(isTurkiyeLiveGroupFilter("country:tr")).toBe(true);
    expect(isTurkiyeLiveGroupFilter(" ulke:tr ")).toBe(true);
    expect(isTurkiyeLiveGroupFilter("TR:SPOR")).toBe(false);
    expect(isTurkiyeLiveGroupFilter(undefined)).toBe(false);
    expect(resolveLiveCountryFilter("country:us")).toBe("US");
    expect(resolveLiveCountryFilter("ulke:de")).toBe("DE");
    expect(resolveLiveCountryFilter("TR:SPOR")).toBeNull();
  });

  it("uses provider order only for country-wide mode", () => {
    const turkiyeOrder = buildLiveCatalogOrderByClause(true);
    const defaultOrder = buildLiveCatalogOrderByClause(false);

    expect(turkiyeOrder).toContain("4k");
    expect(turkiyeOrder).toContain("c.order_index asc");
    expect(turkiyeOrder).not.toContain("health_status");
    expect(defaultOrder).toContain("4k");
    expect(defaultOrder).toContain("health_status");
    expect(defaultOrder).toContain("c.order_index asc");
    expect(defaultOrder).toContain("c.title asc");
  });

  it("builds country filter sql with country_code and prefix fallback", () => {
    const clause = buildLiveCountryFilterWhereClause();
    expect(clause).toContain("c.country_code = $3");
    expect(clause).toContain("c.country_code is null");
    expect(clause).toContain("like $4");
  });

  it("matches only TR: prefixed groups for turkiye filter in demo mode", () => {
    expect(matchesCatalogGroupFilter("TR:SPOR", "turkiye")).toBe(true);
    expect(matchesCatalogGroupFilter("TR:SPOR", "country:tr")).toBe(true);
    expect(matchesCatalogGroupFilter("TR:SPOR", "ulke:tr")).toBe(true);
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
