import { describe, expect, it } from "vitest";
import {
  classifyVodCatalogEntry,
  extractSeriesEpisodeMeta,
  isJunkVodCatalogTitle,
  isValidMovieCatalogEntry,
  isValidSeriesEpisodeCatalogEntry
} from "./vod-catalog";

describe("vod catalog helpers", () => {
  it("keeps live ts movie channels out of the movie catalog", () => {
    expect(
      classifyVodCatalogEntry({
        title: "TR • BEINMOVIES PREMIERE 1 FHD",
        groupTitle: "Sinema",
        source: "__IPTV_USERNAME__/__IPTV_PASSWORD__/418.ts"
      })
    ).toBe("live");

    expect(
      isValidMovieCatalogEntry({
        title: "TR • BEINMOVIES PREMIERE 1 FHD",
        groupTitle: "Sinema",
        source: "__IPTV_USERNAME__/__IPTV_PASSWORD__/418.ts"
      })
    ).toBe(false);
  });

  it("keeps no-prefix ts channels out of the series catalog", () => {
    expect(
      classifyVodCatalogEntry({
        title: "[FuboTV] ATRESERIES",
        groupTitle: "Spain",
        source: "__IPTV_USERNAME__/__IPTV_PASSWORD__/4204.ts"
      })
    ).toBe("live");

    expect(
      isValidSeriesEpisodeCatalogEntry({
        seriesTitle: "[FuboTV] ATRESERIES",
        title: "[FuboTV] ATRESERIES",
        groupTitle: "Spain",
        source: "__IPTV_USERNAME__/__IPTV_PASSWORD__/4204.ts"
      })
    ).toBe(false);
  });

  it("drops base64 and image-dump titles from every catalog", () => {
    const junkTitle =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxMTEhQRExQTFRUXGBgVFxUYGBgYGRgaHR4fHRgZGRse";

    expect(isJunkVodCatalogTitle(junkTitle)).toBe(true);
    expect(
      classifyVodCatalogEntry({
        title: junkTitle,
        groupTitle: "ITALY",
        source: "__IPTV_USERNAME__/__IPTV_PASSWORD__/4179.ts"
      })
    ).toBe("drop");
  });

  it("keeps explicit movie and series paths in VOD catalogs", () => {
    expect(
      classifyVodCatalogEntry({
        title: "Inception (2010) Turkce Dublaj",
        groupTitle: "Filmler",
        source: "movie/__IPTV_USERNAME__/__IPTV_PASSWORD__/inception.mkv"
      })
    ).toBe("movie");

    expect(
      classifyVodCatalogEntry({
        title: "Ornek Dizi S01E02",
        groupTitle: "Diziler",
        source: "series/__IPTV_USERNAME__/__IPTV_PASSWORD__/episode.mkv"
      })
    ).toBe("series");
  });

  it("extracts deterministic season and episode metadata", () => {
    expect(extractSeriesEpisodeMeta("Ornek Dizi Sezon 2 Bolum 7")).toEqual({
      seriesTitle: "Ornek Dizi",
      seasonNumber: 2,
      episodeNumber: 7
    });
  });
});
