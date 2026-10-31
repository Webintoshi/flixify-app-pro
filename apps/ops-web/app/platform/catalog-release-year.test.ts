import { describe, expect, it } from "vitest";
import { catalogReleaseYear, homepageReleaseYear } from "./catalog-release-year";

describe("catalog release-year evidence", () => {
  it("uses an explicit terminal release marker, not a number in the title", () => {
    expect(homepageReleaseYear({ title: "2001: Bir Uzay Macerası (2026)" })).toBe(2026);
    expect(homepageReleaseYear({ title: "2026 Gün (2012)" })).toBe(2012);
    expect(homepageReleaseYear({ title: "Film [2026]  " })).toBe(2026);
    expect(homepageReleaseYear({ title: "Film (２０２６)" })).toBe(2026);
    for (const title of ["2026", "Film 2026", "Film (2026) Fragman", "Film (2025) (2026)", "Film (20260)"]) {
      expect(homepageReleaseYear({ title })).toBeNull();
    }
  });

  it("accepts bounded explicit metadata and gives it precedence over the title", () => {
    expect(catalogReleaseYear({ year: "2026" }, "Film")).toBe(2026);
    expect(catalogReleaseYear({ release_year: 2026 }, "Film")).toBe(2026);
    expect(catalogReleaseYear({ year: 2025 }, "Film (2026)")).toBe(2025);
    expect(homepageReleaseYear({ title: "Film (2026)", releaseYear: 2025 })).toBe(2025);
    expect(homepageReleaseYear({ title: "Film (2026)", releaseYear: null })).toBeNull();
    for (const releaseYear of [0, 1899, 2100, 2026.5, NaN, Infinity]) {
      expect(homepageReleaseYear({ title: "Film (2026)", releaseYear })).toBeNull();
    }
  });

  it("checks the calendar date instead of accepting rollover or loose date parsing", () => {
    for (const field of ["releaseDate", "release_date"] as const) {
      expect(catalogReleaseYear({ [field]: "2026-10-31" }, "Film")).toBe(2026);
      expect(catalogReleaseYear({ [field]: "2026-01-01T00:30:00+03:00" }, "Film")).toBe(2026);
      expect(catalogReleaseYear({ [field]: "2024-02-29T12:34:56.123Z" }, "Film")).toBe(2024);
      for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "2026-01-00", "2026-01-01T25:00:00Z", "2026-01-01junk", 2026]) {
        expect(catalogReleaseYear({ [field]: date }, "Film (2026)")).toBeNull();
      }
    }
  });

  it("rejects conflicting or malformed explicit evidence rather than falling back to 2026", () => {
    expect(catalogReleaseYear({ year: 2025, releaseDate: "2026-01-01" }, "Film (2026)")).toBeNull();
    expect(catalogReleaseYear({ year: 2026, release_date: "2026-01-01" }, "Film")).toBe(2026);
    for (const year of ["2026x", "2.026e3", {}, true, 2026.1, 0]) {
      expect(catalogReleaseYear({ year }, "Film (2026)")).toBeNull();
    }
  });

  it("ignores absent metadata and non-release dates without promoting unknown titles", () => {
    expect(catalogReleaseYear({ year: "", releaseDate: null }, "Film (2026)")).toBe(2026);
    expect(catalogReleaseYear({ added: "2026-01-01", last_modified: "2026-01-01", groupTitle: "2026 Filmleri" }, "Film (2016)")).toBe(2016);
    expect(catalogReleaseYear({ added: "2026-01-01" }, "Film")).toBeNull();
  });
});
