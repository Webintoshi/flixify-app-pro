import { describe, expect, it, vi } from "vitest";
import {
  buildPlaylistUrl,
  buildStreamUrl,
  getSharedPlaylistConfig,
  parsePlaylistUrl,
  redactCredentials,
  streamUrlMatchesCredentials
} from "./iptv.js";
import { pool } from "./db.js";
import { updateAppSettings } from "./repository.js";

describe("IPTV playlist and stream helpers (FLY-INGEST-01)", () => {
  // Scenario 1: Standart path biçimi
  it("Scenario 1: parses and rebuilds standard path-based playlist URL", () => {
    const input = "http://example.com:8080/playlist/user/pass/m3u_plus";
    const parsed = parsePlaylistUrl(input);

    expect(parsed).toEqual({
      baseUrl: "http://example.com:8080",
      playlistPath: "playlist",
      playlistSuffix: "m3u_plus",
      username: "user",
      password: "pass"
    });

    const rebuilt = buildPlaylistUrl(parsed);
    expect(rebuilt).toBe(input);
  });

  // Scenario 2: Prefixli path biçimi
  it("Scenario 2: parses and rebuilds prefixed path-based playlist URL", () => {
    const input = "http://example.com:8080/custom/path/playlist/user/pass/m3u_plus";
    const parsed = parsePlaylistUrl(input);

    expect(parsed).toEqual({
      baseUrl: "http://example.com:8080/custom/path",
      playlistPath: "playlist",
      playlistSuffix: "m3u_plus",
      username: "user",
      password: "pass"
    });

    const rebuilt = buildPlaylistUrl(parsed);
    expect(rebuilt).toBe(input);
  });

  // Scenario 3: Standart get.php biçimi
  it("Scenario 3: parses and rebuilds standard get.php playlist URL", () => {
    const input = "http://example.com:8080/get.php?username=user&password=pass&type=m3u_plus&output=ts";
    const parsed = parsePlaylistUrl(input);

    expect(parsed.baseUrl).toBe("http://example.com:8080");
    expect(parsed.playlistPath).toBe("get.php");
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");

    const rebuilt = buildPlaylistUrl(parsed);
    expect(rebuilt).toBe(input);
  });

  // Scenario 4: Farklı parametre sıralı get.php
  it("Scenario 4: parses get.php with reordered query parameters and rebuilds correctly", () => {
    const input = "http://example.com:8080/get.php?output=ts&type=m3u_plus&password=pass&username=user";
    const parsed = parsePlaylistUrl(input);

    expect(parsed.baseUrl).toBe("http://example.com:8080");
    expect(parsed.playlistPath).toBe("get.php");
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");

    const rebuilt = buildPlaylistUrl(parsed);
    const rebuiltUrl = new URL(rebuilt);
    expect(rebuiltUrl.origin).toBe("http://example.com:8080");
    expect(rebuiltUrl.pathname).toBe("/get.php");
    expect(rebuiltUrl.searchParams.get("username")).toBe("user");
    expect(rebuiltUrl.searchParams.get("password")).toBe("pass");
    expect(rebuiltUrl.searchParams.get("type")).toBe("m3u_plus");
    expect(rebuiltUrl.searchParams.get("output")).toBe("ts");
  });

  // Scenario 5: Prefixli get.php biçimi
  it("Scenario 5: parses and rebuilds prefixed get.php playlist URL", () => {
    const input = "http://example.com:8080/custom/path/get.php?username=user&password=pass&type=m3u_plus";
    const parsed = parsePlaylistUrl(input);

    expect(parsed.baseUrl).toBe("http://example.com:8080/custom/path");
    expect(parsed.playlistPath).toBe("get.php");
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");

    const rebuilt = buildPlaylistUrl(parsed);
    expect(rebuilt).toBe(input);
  });

  // Scenario 6: Ek parametreli get.php
  it("Scenario 6: preserves extra custom query parameters in get.php", () => {
    const input = "http://example.com:8080/get.php?username=user&password=pass&type=m3u_plus&output=ts&custom=value";
    const parsed = parsePlaylistUrl(input);

    expect(parsed.baseUrl).toBe("http://example.com:8080");
    expect(parsed.playlistPath).toBe("get.php");
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");

    const rebuilt = buildPlaylistUrl(parsed);
    const rebuiltUrl = new URL(rebuilt);
    expect(rebuiltUrl.searchParams.get("custom")).toBe("value");
    expect(rebuilt).toBe(input);
  });

  // Scenario 7: Kullanıcı credential değiştirme (buildPlaylistUrl ile farklı kullanıcı - get.php)
  it("Scenario 7: updates user credentials in get.php source while preserving other parameters", () => {
    const input = "http://example.com:8080/get.php?username=user&password=pass&type=m3u_plus&output=ts";
    const parsed = parsePlaylistUrl(input);

    const userPlaylist = buildPlaylistUrl({
      ...parsed,
      username: "newUser",
      password: "newPassword"
    });

    expect(userPlaylist).toBe(
      "http://example.com:8080/get.php?username=newUser&password=newPassword&type=m3u_plus&output=ts"
    );
  });

  // Scenario 8: Path kaynağı + yeni kullanıcı/şifre
  it("Scenario 8: updates user credentials in path-based source", () => {
    const input = "http://example.com:8080/playlist/user/pass/m3u_plus";
    const parsed = parsePlaylistUrl(input);

    const userPlaylist = buildPlaylistUrl({
      ...parsed,
      username: "newUser",
      password: "newPassword"
    });

    expect(userPlaylist).toBe("http://example.com:8080/playlist/newUser/newPassword/m3u_plus");
  });

  // Scenario 9: Geçersiz URL'ler
  it("Scenario 9: throws on invalid URLs (missing password, missing username, invalid format)", () => {
    // Password-less get.php
    expect(() => parsePlaylistUrl("http://example.com:8080/get.php?username=user")).toThrow(
      "Playlist URL icinden kullanici ve sifre ayrisamadi."
    );

    // Username-less get.php
    expect(() => parsePlaylistUrl("http://example.com:8080/get.php?password=pass")).toThrow(
      "Playlist URL icinden kullanici ve sifre ayrisamadi."
    );

    // Neither playlist nor get.php
    expect(() => parsePlaylistUrl("http://example.com:8080/invalid/path/catalog.m3u")).toThrow(
      "Playlist URL formati gecersiz."
    );
  });

  // Criterion 4: URL-encoded özel karakterler (+, &, =, %, /, space)
  it("Criterion 4: preserves URL-encoded special characters without double-encoding or decode loss", () => {
    // Synthetic credentials containing +, &, =, %, / and spaces
    const specialUser = "user+1&2=3%4/5 space";
    const specialPass = "pass+1&2=3%4/5 space";

    // 1. In get.php query format
    const getPhpUrl = `http://example.com:8080/get.php?username=${encodeURIComponent(
      specialUser
    )}&password=${encodeURIComponent(specialPass)}&type=m3u_plus&output=ts`;

    const parsedGetPhp = parsePlaylistUrl(getPhpUrl);
    expect(parsedGetPhp.username).toBe(specialUser);
    expect(parsedGetPhp.password).toBe(specialPass);

    const rebuiltGetPhp = buildPlaylistUrl(parsedGetPhp);
    const reparsedUrl = new URL(rebuiltGetPhp);
    expect(reparsedUrl.searchParams.get("username")).toBe(specialUser);
    expect(reparsedUrl.searchParams.get("password")).toBe(specialPass);

    // 2. In path format
    const pathUrl = `http://example.com:8080/playlist/${encodeURIComponent(
      specialUser
    )}/${encodeURIComponent(specialPass)}/m3u_plus`;

    const parsedPath = parsePlaylistUrl(pathUrl);
    expect(parsedPath.username).toBe(specialUser);
    expect(parsedPath.password).toBe(specialPass);

    const rebuiltPath = buildPlaylistUrl(parsedPath);
    expect(rebuiltPath).toBe(pathUrl);
  });

  // Criterion 5: Eksik, boş veya çelişkili username/password reddediliyor
  it("Criterion 5: rejects missing, empty, or conflicting username/password parameters", () => {
    // Missing username
    expect(() => parsePlaylistUrl("http://example.com:8080/get.php?password=pass")).toThrow(
      "Playlist URL icinden kullanici ve sifre ayrisamadi."
    );

    // Missing password
    expect(() => parsePlaylistUrl("http://example.com:8080/get.php?username=user")).toThrow(
      "Playlist URL icinden kullanici ve sifre ayrisamadi."
    );

    // Empty username
    expect(() => parsePlaylistUrl("http://example.com:8080/get.php?username=&password=pass")).toThrow(
      "Playlist URL icinden kullanici ve sifre ayrisamadi."
    );

    // Whitespace username
    expect(() => parsePlaylistUrl("http://example.com:8080/get.php?username=%20%20&password=pass")).toThrow(
      "Playlist URL icinden kullanici ve sifre ayrisamadi."
    );

    // Conflicting multiple usernames
    expect(() =>
      parsePlaylistUrl("http://example.com:8080/get.php?username=user1&username=user2&password=pass")
    ).toThrow("Playlist URL icinde celiskili kimlik parametreleri bulundu.");

    // Conflicting multiple passwords
    expect(() =>
      parsePlaylistUrl("http://example.com:8080/get.php?username=user&password=pass1&password=pass2")
    ).toThrow("Playlist URL icinde celiskili kimlik parametreleri bulundu.");

    // Case B: Conflicting credentials where one has leading/trailing space
    expect(() =>
      parsePlaylistUrl(
        "http://example.com:8080/get.php?username=user&password=synthetic_pass&password=%20synthetic_pass%20"
      )
    ).toThrow("Playlist URL icinde celiskili kimlik parametreleri bulundu.");
  });

  // Bug 1 Case A: Preserves valid leading/trailing whitespace in credentials
  it("Bug 1 Case A: preserves valid leading and trailing whitespace in non-empty credentials", () => {
    const parsed = parsePlaylistUrl(
      "http://example.com:8080/get.php?username=%20synthetic_user%20&password=%20synthetic_pass%20"
    );
    expect(parsed.username).toBe(" synthetic_user ");
    expect(parsed.password).toBe(" synthetic_pass ");
  });

  // Criterion 5: Builder tarafında suffix içindeki kimlik parametreleri config credentials'ı ezmemeli
  it("Criterion 5 (builder guard): playlistSuffix cannot override config.username or config.password", () => {
    const config = {
      baseUrl: "http://example.com:8080",
      playlistPath: "get.php",
      playlistSuffix: "username=malicious_user&password=malicious_pass&type=m3u_plus&output=ts",
      username: "legitimate_user",
      password: "legitimate_password"
    };

    const built = buildPlaylistUrl(config);
    const parsed = new URL(built);

    expect(parsed.searchParams.get("username")).toBe("legitimate_user");
    expect(parsed.searchParams.get("password")).toBe("legitimate_password");
    expect(parsed.searchParams.getAll("username")).toHaveLength(1);
    expect(parsed.searchParams.getAll("password")).toHaveLength(1);
  });

  // Criterion 12: Hata ve log çıktılarında kimlik bilgisi sızmaması
  it("Criterion 12: redacts credentials from URLs and log messages", () => {
    const rawError =
      "Error: Request failed for http://example.com:8080/get.php?username=synthetic_user&password=synthetic_pass&type=m3u_plus token=synthetic_secret_token";
    const redacted = redactCredentials(rawError);

    expect(redacted).not.toContain("synthetic_user");
    expect(redacted).not.toContain("synthetic_pass");
    expect(redacted).not.toContain("synthetic_secret_token");
    expect(redacted).toContain("username=***");
    expect(redacted).toContain("password=***");
    expect(redacted).toContain("token=***");

    const pathError = "Error on /playlist/synthetic_user/synthetic_pass/m3u_plus";
    const redactedPath = redactCredentials(pathError);
    expect(redactedPath).not.toContain("synthetic_user");
    expect(redactedPath).not.toContain("synthetic_pass");
    expect(redactedPath).toContain("/playlist/***/***");
  });

  // Stream URL credential matching
  it("matches stream credentials properly", () => {
    expect(
      streamUrlMatchesCredentials(
        "http://example.com:8080/live/alice/secret/123.ts",
        "http://example.com:8080",
        "alice",
        "secret"
      )
    ).toBe(true);

    expect(
      streamUrlMatchesCredentials(
        "http://example.com:8080/live/alice/secret/123.ts",
        "http://example.com:8080",
        "bob",
        "secret"
      )
    ).toBe(false);
  });

  // Criterion 6: Kaynak yapılandırmasının kaydetme/okuma turu (gerçek updateAppSettings fonksiyonu ile)
  it("Criterion 6: preserves format across real repository save (updateAppSettings) and config reconstruction", async () => {
    const syntheticUrl =
      "http://example.com:8080/prefix/get.php?username=ref_user&password=ref_pass&type=m3u_plus&output=ts&custom=param";

    let capturedInsertParams: any[] = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (typeof sql === "string" && sql.includes("insert into public.app_settings")) {
          capturedInsertParams = params ?? [];
          return { rows: [] };
        }
        if (typeof sql === "string" && sql.includes("shared_m3u_sync_jobs")) {
          return { rows: [{ id: "job-sync-1" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };

    const spy = vi.spyOn(pool, "connect").mockResolvedValue(mockClient as any);

    try {
      await updateAppSettings(
        {
          supportWhatsappUrl: "https://wa.me/900000000000",
          supportTelegramUrl: "https://t.me/yourchannel",
          salesPortalUrl: null,
          heroTitle: "Flixify Hero",
          heroSubtitle: "Flixify Subtitle",
          sharedPlaylistUrl: syntheticUrl
        },
        "admin-user-id"
      );

      expect(mockClient.query).toHaveBeenCalled();
      expect(capturedInsertParams.length).toBeGreaterThan(0);

      // Captured SQL parameters:
      // $6: baseUrl, $7: playlistPath, $8: playlistSuffix, $9: username, $10: password
      const simulatedDbRow = {
        shared_source_base_url: capturedInsertParams[5],
        shared_source_playlist_path: capturedInsertParams[6],
        shared_source_playlist_suffix: capturedInsertParams[7],
        shared_source_reference_username: capturedInsertParams[8],
        shared_source_reference_password: capturedInsertParams[9]
      };

      const workerConfig = getSharedPlaylistConfig(simulatedDbRow);
      expect(workerConfig).not.toBeNull();

      const workerCatalogUrl = buildPlaylistUrl(workerConfig!);
      expect(workerCatalogUrl).toBe(syntheticUrl);

      const endUserPlaylistUrl = buildPlaylistUrl({
        ...workerConfig!,
        username: "personal_end_user",
        password: "personal_end_password"
      });
      expect(endUserPlaylistUrl).toBe(
        "http://example.com:8080/prefix/get.php?username=personal_end_user&password=personal_end_password&type=m3u_plus&output=ts&custom=param"
      );
    } finally {
      spy.mockRestore();
    }
  });
});

