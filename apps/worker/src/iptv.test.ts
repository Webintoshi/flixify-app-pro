import { describe, expect, it, vi } from "vitest";
import {
  buildPlaylistUrl,
  buildStreamUrl,
  extractStreamPath,
  getSharedPlaylistConfig,
  parsePlaylistUrl,
  redactCredentials,
  type PlaylistConfig
} from "./iptv.js";
import { isValidM3UContent } from "./m3u.js";
import { processJob } from "./sync-job.js";

describe("Worker IPTV helpers (FLY-INGEST-01)", () => {
  // Scenario 10: extractStreamPath uyumluluğu
  it("Scenario 10: extractStreamPath successfully templates credentials from stream URLs in get.php catalogs", () => {
    // Shared config from a get.php catalog source
    const config: PlaylistConfig = {
      baseUrl: "http://example.com:8080",
      playlistPath: "get.php",
      playlistSuffix: "type=m3u_plus&output=ts",
      username: "synthetic_user",
      password: "synthetic_pass"
    };

    // Standard Xtream live stream URL found inside M3U playlist
    const streamUrl = "http://example.com:8080/live/synthetic_user/synthetic_pass/123.ts";

    const extracted = extractStreamPath(streamUrl, config);
    expect(extracted).toBe("live/__IPTV_USERNAME__/__IPTV_PASSWORD__/123.ts");

    // Verify buildStreamUrl replaces placeholders with end-user credentials
    const targetUserStream = buildStreamUrl(
      config.baseUrl,
      "end_user_1",
      "user_pass_secret",
      extracted
    );
    expect(targetUserStream).toBe("http://example.com:8080/live/end_user_1/user_pass_secret/123.ts");
  });

  // Scenario 10 with prefix
  it("Scenario 10 (prefixed): extractStreamPath preserves prefix structure", () => {
    const config: PlaylistConfig = {
      baseUrl: "http://example.com:8080/custom/prefix",
      playlistPath: "get.php",
      playlistSuffix: "type=m3u_plus&output=ts",
      username: "synthetic_user",
      password: "synthetic_pass"
    };

    const streamUrl = "http://example.com:8080/custom/prefix/live/synthetic_user/synthetic_pass/456.ts";
    const extracted = extractStreamPath(streamUrl, config);
    expect(extracted).toBe("live/__IPTV_USERNAME__/__IPTV_PASSWORD__/456.ts");

    const targetUserStream = buildStreamUrl(
      config.baseUrl,
      "end_user_2",
      "pass_2",
      extracted
    );
    expect(targetUserStream).toBe(
      "http://example.com:8080/custom/prefix/live/end_user_2/pass_2/456.ts"
    );
  });

  // Scenario 11: Worker buildPlaylistUrl with get.php config
  it("Scenario 11: Worker buildPlaylistUrl generates valid get.php catalog URL", () => {
    const config: PlaylistConfig = {
      baseUrl: "http://example.com:8080",
      playlistPath: "get.php",
      playlistSuffix: "type=m3u_plus&output=ts",
      username: "synthetic_user",
      password: "synthetic_pass"
    };

    const url = buildPlaylistUrl(config);
    expect(url).toBe(
      "http://example.com:8080/get.php?username=synthetic_user&password=synthetic_pass&type=m3u_plus&output=ts"
    );
  });

  it("Worker buildPlaylistUrl maintains path-based playlist URL support", () => {
    const config: PlaylistConfig = {
      baseUrl: "http://example.com:8080",
      playlistPath: "playlist",
      playlistSuffix: "m3u_plus",
      username: "user",
      password: "pass"
    };

    const url = buildPlaylistUrl(config);
    expect(url).toBe("http://example.com:8080/playlist/user/pass/m3u_plus");
  });

  // Scenario 11 (getSharedPlaylistConfig mapping)
  it("Scenario 11: getSharedPlaylistConfig maps database row correctly for get.php", () => {
    const dbRow = {
      shared_source_base_url: "http://example.com:8080",
      shared_source_playlist_path: "get.php",
      shared_source_playlist_suffix: "type=m3u_plus&output=ts",
      shared_source_reference_username: "user",
      shared_source_reference_password: "pass"
    };

    const config = getSharedPlaylistConfig(dbRow);
    expect(config).toEqual({
      baseUrl: "http://example.com:8080",
      playlistPath: "get.php",
      playlistSuffix: "type=m3u_plus&output=ts",
      username: "user",
      password: "pass"
    });

    const url = buildPlaylistUrl(config!);
    expect(url).toBe("http://example.com:8080/get.php?username=user&password=pass&type=m3u_plus&output=ts");
  });

  it("Scenario 11: getSharedPlaylistConfig returns null if any required column is missing", () => {
    expect(getSharedPlaylistConfig(null)).toBeNull();
    expect(
      getSharedPlaylistConfig({
        shared_source_base_url: "http://example.com:8080",
        shared_source_playlist_path: "get.php",
        shared_source_playlist_suffix: "type=m3u_plus",
        shared_source_reference_username: "user",
        shared_source_reference_password: null
      })
    ).toBeNull();
  });

  // Criterion 6: Kaynak yapılandırmasının kaydetme/okuma turu (mock DB alan eşlemesi)
  it("Criterion 6: preserves format across simulated repository save/read round-trip", () => {
    // Note: Database column mapping is simulated in-memory; no real PostgreSQL connection used.
    const syntheticUrl =
      "http://example.com:8080/prefix/get.php?username=ref_user&password=ref_pass&type=m3u_plus&output=ts&custom=param";

    // 1. Production parser
    const parsed = parsePlaylistUrl(syntheticUrl);

    // 2. Production repository column mapping (as in apps/api/src/repository.ts)
    const simulatedDbRow = {
      shared_source_base_url: parsed.baseUrl,
      shared_source_playlist_path: parsed.playlistPath,
      shared_source_playlist_suffix: parsed.playlistSuffix,
      shared_source_reference_username: parsed.username,
      shared_source_reference_password: parsed.password
    };

    // 3. Production worker reader
    const workerConfig = getSharedPlaylistConfig(simulatedDbRow);
    expect(workerConfig).not.toBeNull();

    // 4. Catalog URL rebuilt by worker
    const workerCatalogUrl = buildPlaylistUrl(workerConfig!);
    expect(workerCatalogUrl).toBe(
      "http://example.com:8080/prefix/get.php?username=ref_user&password=ref_pass&type=m3u_plus&output=ts&custom=param"
    );

    // 5. Personal user URL rebuilt for end user (as in repository.ts getCurrentSourceUrl)
    const endUserPlaylistUrl = buildPlaylistUrl({
      ...workerConfig!,
      username: "personal_end_user",
      password: "personal_end_password"
    });
    expect(endUserPlaylistUrl).toBe(
      "http://example.com:8080/prefix/get.php?username=personal_end_user&password=personal_end_password&type=m3u_plus&output=ts&custom=param"
    );
  });

  // Criterion 7: Worker get.php için doğru HTTP isteğini üretiyor (gerçek processJob ile yakalama)
  it("Criterion 7: Worker processJob generates correct HTTP request URL for get.php catalog", async () => {
    const mockDbRow = {
      shared_source_base_url: "http://example.com:8080",
      shared_source_playlist_path: "get.php",
      shared_source_playlist_suffix: "type=m3u_plus&output=ts",
      shared_source_reference_username: "synthetic_user",
      shared_source_reference_password: "synthetic_pass",
      shared_source_snapshot_version: 1
    };

    let requestedUrl: string | null = null;
    const mockFetch = vi.fn(async (url: any) => {
      requestedUrl = String(url);
      return {
        ok: true,
        text: async () =>
          "#EXTM3U\n#EXTINF:-1,Sample\nhttp://example.com:8080/live/synthetic_user/synthetic_pass/1.ts"
      };
    });

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("select") && sql.includes("app_settings")) {
          return { rows: [mockDbRow] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async () => ({ rows: [] }))
    };

    await processJob({ id: "job-c7" }, { pool: mockPool as any, fetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl).toBe(
      "http://example.com:8080/get.php?username=synthetic_user&password=synthetic_pass&type=m3u_plus&output=ts"
    );
  });

  // Criterion 8: Sentetik /live/, /movie/ ve /series/ yayın adreslerinde extractStreamPath/buildStreamUrl davranışı
  it("Criterion 8: extractStreamPath and buildStreamUrl work identically for /live/, /movie/, and /series/ streams", () => {
    const config: PlaylistConfig = {
      baseUrl: "http://example.com:8080",
      playlistPath: "get.php",
      playlistSuffix: "type=m3u_plus&output=ts",
      username: "ref_user",
      password: "ref_pass"
    };

    // 1. Live stream
    const liveStreamUrl = "http://example.com:8080/live/ref_user/ref_pass/101.ts";
    const livePath = extractStreamPath(liveStreamUrl, config);
    expect(livePath).toBe("live/__IPTV_USERNAME__/__IPTV_PASSWORD__/101.ts");
    const liveUserUrl = buildStreamUrl(config.baseUrl, "user_1", "pass_1", livePath);
    expect(liveUserUrl).toBe("http://example.com:8080/live/user_1/pass_1/101.ts");

    // 2. Movie stream
    const movieStreamUrl = "http://example.com:8080/movie/ref_user/ref_pass/202.mp4";
    const moviePath = extractStreamPath(movieStreamUrl, config);
    expect(moviePath).toBe("movie/__IPTV_USERNAME__/__IPTV_PASSWORD__/202.mp4");
    const movieUserUrl = buildStreamUrl(config.baseUrl, "user_1", "pass_1", moviePath);
    expect(movieUserUrl).toBe("http://example.com:8080/movie/user_1/pass_1/202.mp4");

    // 3. Series stream
    const seriesStreamUrl = "http://example.com:8080/series/ref_user/ref_pass/303.mkv";
    const seriesPath = extractStreamPath(seriesStreamUrl, config);
    expect(seriesPath).toBe("series/__IPTV_USERNAME__/__IPTV_PASSWORD__/303.mkv");
    const seriesUserUrl = buildStreamUrl(config.baseUrl, "user_1", "pass_1", seriesPath);
    expect(seriesUserUrl).toBe("http://example.com:8080/series/user_1/pass_1/303.mkv");
  });

  // Criterion 9: İki farklı sentetik kullanıcı farklı yayın adresleri alıyor; referans hesaba dönmüyor
  it("Criterion 9: isolates stream URLs between different users and never falls back to reference credentials", () => {
    const baseUrl = "http://example.com:8080";
    const templatedStream = "live/__IPTV_USERNAME__/__IPTV_PASSWORD__/channel_50.ts";

    const userAUrl = buildStreamUrl(baseUrl, "synthetic_user_a", "pass_a", templatedStream);
    const userBUrl = buildStreamUrl(baseUrl, "synthetic_user_b", "pass_b", templatedStream);

    expect(userAUrl).toBe("http://example.com:8080/live/synthetic_user_a/pass_a/channel_50.ts");
    expect(userBUrl).toBe("http://example.com:8080/live/synthetic_user_b/pass_b/channel_50.ts");
    expect(userAUrl).not.toBe(userBUrl);

    // Verify neither user receives reference credentials
    expect(userAUrl).not.toContain("ref_user");
    expect(userAUrl).not.toContain("ref_pass");
    expect(userBUrl).not.toContain("ref_user");
    expect(userBUrl).not.toContain("ref_pass");
  });

  // Criterion 10: Kaynak hostu veya referans kimlik bilgileri eşleşmediğinde mevcut ret davranışı
  it("Criterion 10: rejects streams with mismatched host or credentials", () => {
    const config: PlaylistConfig = {
      baseUrl: "http://example.com:8080",
      playlistPath: "get.php",
      playlistSuffix: "type=m3u_plus",
      username: "valid_ref_user",
      password: "valid_ref_pass"
    };

    // Host mismatch
    expect(() =>
      extractStreamPath("http://evil-domain.com:8080/live/valid_ref_user/valid_ref_pass/1.ts", config)
    ).toThrow("Stream host ortak kaynak hostu ile uyusmuyor.");

    // Credential mismatch
    expect(() =>
      extractStreamPath("http://example.com:8080/live/wrong_user/wrong_pass/1.ts", config)
    ).toThrow("Stream URL referans credential ile uyusmuyor.");
  });

  // Criterion 11: Gerçek processJob HTTP 200 dönen HTML hata sayfasını reddeder, snapshot artmaz, cleanup çalışmaz
  it("Criterion 11: real processJob rejects HTTP 200 HTML response, marks job failed without snapshot advance or cleanup, and succeeds with valid M3U", async () => {
    const mockDbRow = {
      shared_source_base_url: "http://example.com:8080",
      shared_source_playlist_path: "get.php",
      shared_source_playlist_suffix: "type=m3u_plus&output=ts",
      shared_source_reference_username: "synthetic_user",
      shared_source_reference_password: "synthetic_pass",
      shared_source_snapshot_version: 5
    };

    // Subtest 1: HTTP 200 with HTML error response
    const htmlResponse = "<!DOCTYPE html><html><body>Error 401: Unauthorized</body></html>";
    const executedPoolQueries: Array<{ sql: string; params?: any[] }> = [];
    const executedClientQueries: Array<{ sql: string; params?: any[] }> = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        executedClientQueries.push({ sql, params });
        if (typeof sql === "string" && sql.includes("select") && sql.includes("app_settings")) {
          return { rows: [mockDbRow] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async (sql: string, params?: any[]) => {
        executedPoolQueries.push({ sql, params });
        return { rows: [] };
      })
    };

    const htmlFetch = vi.fn(async () => ({
      ok: true,
      text: async () => htmlResponse
    }));

    await processJob({ id: "job-html-fail" }, { pool: mockPool as any, fetch: htmlFetch as any });

    // Assert: job was marked failed
    const jobFailQuery = executedPoolQueries.find(
      (q) => q.sql.includes("update public.shared_m3u_sync_jobs") && q.sql.includes("set status = 'failed'")
    );
    expect(jobFailQuery).toBeDefined();
    expect(jobFailQuery?.params?.[1]).toContain("Gecerli M3U formati bulunamadi");

    // Assert: app_settings error was recorded
    const settingsErrorQuery = executedPoolQueries.find(
      (q) => q.sql.includes("update public.app_settings") && q.sql.includes("shared_source_last_error = $1")
    );
    expect(settingsErrorQuery).toBeDefined();

    // Assert: snapshot was NOT incremented (no update setting status = 'ready' or incremented snapshot)
    const successQuery = executedClientQueries.find(
      (q) => q.sql.includes("update public.app_settings") && q.sql.includes("shared_source_status = 'ready'")
    );
    expect(successQuery).toBeUndefined();

    // Assert: cleanup was NOT executed
    const cleanupQuery = executedClientQueries.find(
      (q) => q.sql.includes("delete from public.shared_live_channels")
    );
    expect(cleanupQuery).toBeUndefined();

    // Subtest 2: Success path with valid M3U
    const validM3U =
      "#EXTM3U\n#EXTINF:-1 tvg-id=\"live1\",Canli 1\nhttp://example.com:8080/live/synthetic_user/synthetic_pass/100.ts";
    const validClientQueries: Array<{ sql: string; params?: any[] }> = [];
    const validPoolQueries: Array<{ sql: string; params?: any[] }> = [];

    const validMockClient = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        validClientQueries.push({ sql, params });
        if (typeof sql === "string" && sql.includes("select") && sql.includes("app_settings")) {
          return { rows: [mockDbRow] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };

    const validMockPool = {
      connect: vi.fn(async () => validMockClient),
      query: vi.fn(async (sql: string, params?: any[]) => {
        validPoolQueries.push({ sql, params });
        return { rows: [] };
      })
    };

    const validFetch = vi.fn(async () => ({
      ok: true,
      text: async () => validM3U
    }));

    await processJob({ id: "job-valid-success" }, { pool: validMockPool as any, fetch: validFetch as any });

    // Assert: snapshot incremented from 5 to 6 and status set to 'ready'
    const validSettingsSuccess = validClientQueries.find(
      (q) => q.sql.includes("update public.app_settings") && q.sql.includes("shared_source_status = 'ready'")
    );
    expect(validSettingsSuccess).toBeDefined();
    expect(validSettingsSuccess?.params?.[0]).toBe(6); // 5 + 1

    // Assert: job marked succeeded with snapshot_version = 6
    const validJobSuccess = validClientQueries.find(
      (q) => q.sql.includes("update public.shared_m3u_sync_jobs") && q.sql.includes("set status = 'succeeded'")
    );
    expect(validJobSuccess).toBeDefined();
    expect(validJobSuccess?.params?.[1]).toBe(6);

    // Assert: cleanup was executed for old snapshots
    const validCleanup = validClientQueries.find(
      (q) => q.sql.includes("delete from public.shared_live_channels")
    );
    expect(validCleanup).toBeDefined();
    expect(validCleanup?.params?.[0]).toBe(5); // floorVersion = 6 - 1 = 5
  });

  // Criterion 12: Gerçek hata/log yolunda (processJob) kimlik bilgileri maskelenir
  it("Criterion 12: processJob redacts sensitive credentials from network failure messages in DB error columns", async () => {
    const mockDbRow = {
      shared_source_base_url: "http://example.com:8080",
      shared_source_playlist_path: "get.php",
      shared_source_playlist_suffix: "type=m3u_plus&output=ts",
      shared_source_reference_username: "synthetic_user",
      shared_source_reference_password: "synthetic_pass",
      shared_source_snapshot_version: 1
    };

    const poolQueries: Array<{ sql: string; params?: any[] }> = [];
    const clientQueries: Array<{ sql: string; params?: any[] }> = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        clientQueries.push({ sql, params });
        if (typeof sql === "string" && sql.includes("select") && sql.includes("app_settings")) {
          return { rows: [mockDbRow] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async (sql: string, params?: any[]) => {
        poolQueries.push({ sql, params });
        return { rows: [] };
      })
    };

    // Network error containing raw credentials and tokens
    const failingFetch = vi.fn().mockRejectedValue(
      new Error(
        "Fetch failed for http://example.com:8080/get.php?username=synthetic_user&password=synthetic_pass token=super_secret_token"
      )
    );

    await processJob({ id: "job-leak-check" }, { pool: mockPool as any, fetch: failingFetch as any });

    // Check query params in markJobFailed and app_settings update
    expect(poolQueries.length).toBeGreaterThan(0);
    for (const q of poolQueries) {
      for (const param of q.params ?? []) {
        if (typeof param === "string") {
          expect(param).not.toContain("synthetic_user");
          expect(param).not.toContain("synthetic_pass");
          expect(param).not.toContain("super_secret_token");
          if (param.includes("username=")) {
            expect(param).toContain("username=***");
          }
          if (param.includes("password=")) {
            expect(param).toContain("password=***");
          }
          if (param.includes("token=")) {
            expect(param).toContain("token=***");
          }
        }
      }
    }

    // Also check errorClient queries
    for (const q of clientQueries) {
      for (const param of q.params ?? []) {
        if (typeof param === "string") {
          expect(param).not.toContain("synthetic_user");
          expect(param).not.toContain("synthetic_pass");
          expect(param).not.toContain("super_secret_token");
        }
      }
    }

    // Direct helper unit check
    const log1 =
      "Error: http://example.com:8080/get.php?username=synthetic_user&password=synthetic_pass token=secret_token";
    const clean1 = redactCredentials(log1);
    expect(clean1).not.toContain("synthetic_user");
    expect(clean1).not.toContain("synthetic_pass");
    expect(clean1).not.toContain("secret_token");
    expect(clean1).toContain("username=***");
    expect(clean1).toContain("password=***");
    expect(clean1).toContain("token=***");
  });
});


