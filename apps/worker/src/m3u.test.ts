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

  it("rewrites legacy provider artwork hosts to the current artwork base host", () => {
    const catalog = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-logo="http://udashboard.win/logo/tr/Sinema_TV_Yerli.png" group-title="Canli TV",Sinema TV
https://stream/live/user/pass/channel.ts`,
      {
        artworkBaseUrl: "http://sifiriptvdns.com"
      }
    );

    expect(catalog.live[0]?.logoUrl).toBe("http://sifiriptvdns.com/logo/tr/Sinema_TV_Yerli.png");
  });

  it("rewrites mirrored picon artwork paths to the current artwork base host", () => {
    const catalog = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-logo="http://udashboard.shop/picon/elitsinema1001.png" group-title="Canli TV",Elite Sinema
https://stream/live/user/pass/channel.ts`,
      {
        artworkBaseUrl: "http://sifiriptvdns.com"
      }
    );

    expect(catalog.live[0]?.logoUrl).toBe("http://sifiriptvdns.com/picon/elitsinema1001.png");
  });

  it("keeps non-provider artwork hosts untouched", () => {
    const catalog = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-logo="http://de1.plist.link/plepg/img/channels/1.png?cache=1" group-title="Canli TV",Test Kanal
https://stream/live/user/pass/channel.ts`,
      {
        artworkBaseUrl: "http://sifiriptvdns.com"
      }
    );

    expect(catalog.live[0]?.logoUrl).toBe("http://de1.plist.link/plepg/img/channels/1.png?cache=1");
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

  it("keeps no-prefix ts movie channels out of the movie catalog", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="Sinema",TR • BEINMOVIES PREMIERE 1 FHD
https://stream/user/pass/418.ts
#EXTINF:-1 group-title="Filmler",Inception (2010) Turkce Dublaj
https://stream/movie/user/pass/inception.mkv`);

    expect(catalog.live).toHaveLength(1);
    expect(catalog.movies).toHaveLength(1);
    expect(catalog.live[0]?.title).toContain("BEINMOVIES");
    expect(catalog.movies[0]?.title).toContain("Inception");
  });

  it("keeps non-episodic ts channels out of the series catalog", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="Spain",[FuboTV] ATRESERIES
https://stream/user/pass/4204.ts
#EXTINF:-1 group-title="Diziler",Ornek Dizi S01E01
https://stream/series/user/pass/ornek-s1e1.mkv`);

    expect(catalog.live).toHaveLength(1);
    expect(catalog.series).toHaveLength(1);
    expect(catalog.series[0]?.seriesTitle).toBe("Ornek Dizi");
  });

  it("drops encoded image dumps entirely", () => {
    const catalog = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="ITALY",/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxMTEhQRExQTFRUXGBgVFxUYGBgYGRgaHR4fHRgZGRse
https://stream/user/pass/4179.ts`);

    expect(catalog.live).toHaveLength(0);
    expect(catalog.movies).toHaveLength(0);
    expect(catalog.series).toHaveLength(0);
  });
});
