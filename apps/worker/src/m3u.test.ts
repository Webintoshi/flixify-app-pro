import { describe, expect, it } from "vitest";
import { parseM3U } from "./m3u.js";

describe("parseM3U", () => {
  it("classifies live, movies and series entries", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="news" group-title="Canli TV",Haber 24
https://stream/live.m3u8
#EXTINF:-1 tvg-id="film" group-title="Filmler",Aksiyon Film
https://stream/movie/user/pass/movie.mp4
#EXTINF:-1 tvg-id="dizi" group-title="Diziler",Super Dizi S01E03
https://stream/series/user/pass/series.mp4`);

    expect(catalog.live).toHaveLength(1);
    expect(catalog.movies).toHaveLength(1);
    expect(catalog.series[0]?.seriesTitle).toBe("Super Dizi");
  });

  it("keeps a single Turkish-dubbed movie variant for duplicate films", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="Filmler",Inception (2010) Altyazi
https://stream/movie/user/pass/inception-sub.mp4
#EXTINF:-1 group-title="Filmler",Inception (2010) Turkce Dublaj
https://stream/movie/user/pass/inception-tr.mp4
#EXTINF:-1 group-title="Filmler",Inception 2010 1080p TR Dublaj
https://stream/movie/user/pass/inception-tr-1080.mp4
#EXTINF:-1 group-title="Filmler",Arrival (2016) Original
https://stream/movie/user/pass/arrival-original.mp4`);

    expect(catalog.movies).toHaveLength(1);
    expect(catalog.movies[0]?.title).toContain("Turkce Dublaj");
  });

  it("drops invalid stream urls and keeps only safe artwork urls", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="safe-live" tvg-logo="javascript:alert(1)" group-title="Canli TV",Haber 7
https://stream/live/user/pass/channel.ts
#EXTINF:-1 tvg-id="broken-live" tvg-logo="http://image.example.com/live.png" group-title="Canli TV",Kirik Kanal
not-a-valid-url
#EXTINF:-1 group-title="Filmler" tvg-logo="ftp://poster.example.com/a.jpg",Film A
https://stream/movie/user/pass/film-a.mp4`);

    expect(catalog.live).toHaveLength(1);
    expect(catalog.live[0]?.logoUrl).toBeNull();
    expect(catalog.movies).toHaveLength(1);
    expect(catalog.movies[0]?.logoUrl).toBeNull();
  });

  it("resolves relative artwork urls with configured artwork base", () => {
    const catalog = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-id="safe-live" tvg-logo="/images/live-logo.png" group-title="Canli TV",Haber 7
https://stream/live/user/pass/channel.ts
#EXTINF:-1 group-title="Filmler" tvg-logo="logos/movie-poster.jpg",Film A
https://stream/movie/user/pass/film-a.mp4`,
      {
        artworkBaseUrl: "https://cdn.example.com/base/"
      }
    );

    expect(catalog.live[0]?.logoUrl).toBe("https://cdn.example.com/images/live-logo.png");
    expect(catalog.movies[0]?.logoUrl).toBe("https://cdn.example.com/base/logos/movie-poster.jpg");
  });

  it("parses and orders series episodes deterministically", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="Diziler",Ornek Dizi 2x03
https://stream/series/user/pass/series-s2e3.mp4
#EXTINF:-1 group-title="Diziler",Ornek Dizi S01E09
https://stream/series/user/pass/series-s1e9.mp4
#EXTINF:-1 group-title="Diziler",Ornek Dizi S01E01
https://stream/series/user/pass/series-s1e1.mp4`);

    expect(catalog.series).toHaveLength(3);
    expect(catalog.series.map((item) => `${item.seasonNumber}-${item.episodeNumber}`)).toEqual([
      "1-1",
      "1-9",
      "2-3"
    ]);
    expect(catalog.series[0]?.seriesTitle).toBe("Ornek Dizi");
  });
});
