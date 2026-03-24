import { describe, expect, it } from "vitest";
import { filterStoredMovieCatalogRows, filterStoredSeriesCatalogRows } from "./vod-catalog-filter.js";

describe("vod catalog repository filters", () => {
  it("keeps dirty movie snapshot rows off the first page", () => {
    const rows = [
      {
        id: "movie-live",
        title: "TR • BEINMOVIES PREMIERE 1 FHD",
        poster_url: null,
        group_title: "Sinema",
        stream_path: "__IPTV_USERNAME__/__IPTV_PASSWORD__/418.ts",
        order_index: 0
      },
      {
        id: "movie-valid",
        title: "Inception (2010) Turkce Dublaj",
        poster_url: "https://cdn.example.com/inception.jpg",
        group_title: "Filmler",
        stream_path: "movie/__IPTV_USERNAME__/__IPTV_PASSWORD__/inception.mkv",
        order_index: 1
      }
    ];

    expect(filterStoredMovieCatalogRows(rows).map((row) => row.id)).toEqual(["movie-valid"]);
  });

  it("drops invalid series rows and keeps only valid episodes", () => {
    const junkTitle =
      "iVBORw0KGgoAAAANSUhEUgAAAOEAAADhCAMAAAAJbSJIAAAA81BMVEX///8BAQHkAFICp6AAAAD76e";
    const result = filterStoredSeriesCatalogRows(
      [
        {
          id: "series-live",
          title: "[FuboTV] ATRESERIES",
          poster_url: null,
          group_title: "Spain"
        },
        {
          id: "series-junk",
          title: junkTitle,
          poster_url: null,
          group_title: "ITALY"
        },
        {
          id: "series-valid",
          title: "Ornek Dizi",
          poster_url: "https://cdn.example.com/ornek.jpg",
          group_title: "Diziler"
        }
      ],
      [
        {
          id: "episode-live",
          series_id: "series-live",
          title: "[FuboTV] ATRESERIES",
          season_number: 1,
          episode_number: 1,
          stream_path: "__IPTV_USERNAME__/__IPTV_PASSWORD__/4204.ts"
        },
        {
          id: "episode-junk",
          series_id: "series-junk",
          title: junkTitle,
          season_number: 1,
          episode_number: 1,
          stream_path: "__IPTV_USERNAME__/__IPTV_PASSWORD__/4179.ts"
        },
        {
          id: "episode-valid",
          series_id: "series-valid",
          title: "Ornek Dizi S01E01",
          season_number: 1,
          episode_number: 1,
          stream_path: "series/__IPTV_USERNAME__/__IPTV_PASSWORD__/ornek-s1e1.mkv"
        }
      ]
    );

    expect(result.seriesRows.map((row) => row.id)).toEqual(["series-valid"]);
    expect(result.episodesBySeriesId.get("series-valid")?.map((row) => row.id)).toEqual(["episode-valid"]);
    expect(result.episodesBySeriesId.get("series-live")).toBeUndefined();
  });
});
