export type PlaylistConfig = {
  baseUrl: string;
  playlistPath: string;
  playlistSuffix: string;
  username: string;
  password: string;
};

const USERNAME_PLACEHOLDER = "__IPTV_USERNAME__";
const PASSWORD_PLACEHOLDER = "__IPTV_PASSWORD__";

function normalizePathSegment(segment: string) {
  return segment.replace(/^\/+|\/+$/g, "");
}

export function isGetPhp(playlistPath: string) {
  const normalized = normalizePathSegment(playlistPath).toLowerCase();
  return normalized === "get.php" || normalized.endsWith("/get.php");
}

export function parsePlaylistUrl(rawUrl: string): PlaylistConfig {
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const getPhpIndex = segments.findIndex((segment) => segment.toLowerCase() === "get.php");

  if (getPhpIndex !== -1) {
    const rawUsernames = url.searchParams.getAll("username");
    const rawPasswords = url.searchParams.getAll("password");

    if (rawUsernames.length === 0 || rawPasswords.length === 0) {
      throw new Error("Playlist URL icinden kullanici ve sifre ayrisamadi.");
    }

    for (const u of rawUsernames) {
      if (!u || u.trim().length === 0) {
        throw new Error("Playlist URL icinden kullanici ve sifre ayrisamadi.");
      }
    }

    for (const p of rawPasswords) {
      if (!p || p.trim().length === 0) {
        throw new Error("Playlist URL icinden kullanici ve sifre ayrisamadi.");
      }
    }

    const uniqueUsernames = new Set(rawUsernames);
    const uniquePasswords = new Set(rawPasswords);

    if (uniqueUsernames.size > 1 || uniquePasswords.size > 1) {
      throw new Error("Playlist URL icinde celiskili kimlik parametreleri bulundu.");
    }

    const username = rawUsernames[0] ?? "";
    const password = rawPasswords[0] ?? "";

    const basePathSegments = segments.slice(0, getPhpIndex);
    const basePath = basePathSegments.length > 0 ? `/${basePathSegments.join("/")}` : "";

    const suffixParams = new URLSearchParams();
    const type = url.searchParams.get("type")?.trim() || "m3u_plus";
    suffixParams.set("type", type);

    if (url.searchParams.has("output")) {
      const output = url.searchParams.get("output")?.trim();
      if (output) {
        suffixParams.set("output", output);
      }
    }

    for (const [key, value] of url.searchParams.entries()) {
      if (
        key !== "username" &&
        key !== "password" &&
        key !== "type" &&
        key !== "output"
      ) {
        suffixParams.set(key, value);
      }
    }

    return {
      baseUrl: `${url.origin}${basePath}`,
      playlistPath: "get.php",
      playlistSuffix: suffixParams.toString(),
      username,
      password
    };
  }

  const playlistIndex = segments.findIndex((segment) => segment === "playlist");

  if (playlistIndex === -1 || segments.length < playlistIndex + 4) {
    throw new Error("Playlist URL formati gecersiz.");
  }

  const playlistPathSegments = segments.slice(0, playlistIndex + 1);
  const username = decodeURIComponent(segments[playlistIndex + 1] ?? "");
  const password = decodeURIComponent(segments[playlistIndex + 2] ?? "");
  const playlistSuffix = decodeURIComponent(segments.slice(playlistIndex + 3).join("/"));

  if (!username || !password || !playlistSuffix || username.trim().length === 0 || password.trim().length === 0) {
    throw new Error("Playlist URL icinden kullanici ve sifre ayrisamadi.");
  }

  const basePathSegments = playlistPathSegments.slice(0, -1);
  const basePath = basePathSegments.length > 0 ? `/${basePathSegments.join("/")}` : "";

  return {
    baseUrl: `${url.origin}${basePath}`,
    playlistPath: playlistPathSegments.at(-1) ?? "playlist",
    playlistSuffix,
    username,
    password
  };
}

export function buildPlaylistUrl(config: PlaylistConfig) {
  const base = config.baseUrl.replace(/\/+$/, "");
  const playlistPath = normalizePathSegment(config.playlistPath);

  if (isGetPhp(playlistPath)) {
    const params = new URLSearchParams();
    params.set("username", config.username);
    params.set("password", config.password);

    const suffixParams = new URLSearchParams(config.playlistSuffix.replace(/^\?+/, ""));
    const type = suffixParams.get("type") || "m3u_plus";
    params.set("type", type);

    if (suffixParams.has("output")) {
      const output = suffixParams.get("output");
      if (output) {
        params.set("output", output);
      }
    }

    for (const [key, value] of suffixParams.entries()) {
      if (
        key !== "username" &&
        key !== "password" &&
        key !== "type" &&
        key !== "output"
      ) {
        params.set(key, value);
      }
    }

    return `${base}/${playlistPath}?${params.toString()}`;
  }

  const suffix = config.playlistSuffix
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${base}/${playlistPath}/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${suffix}`;
}

export function extractStreamPath(
  streamUrl: string,
  config: PlaylistConfig
) {
  const url = new URL(streamUrl);
  const base = new URL(config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);

  if (url.origin !== base.origin) {
    throw new Error("Stream host ortak kaynak hostu ile uyusmuyor.");
  }

  const baseSegments = base.pathname.split("/").filter(Boolean);
  const streamSegments = url.pathname.split("/").filter(Boolean);

  for (let index = 0; index < baseSegments.length; index += 1) {
    if (streamSegments[index] !== baseSegments[index]) {
      throw new Error("Stream path ortak kaynak taban yolu ile uyusmuyor.");
    }
  }

  const relativeSegments = streamSegments.slice(baseSegments.length);
  if (relativeSegments.length < 3) {
    throw new Error("Stream URL credential segmentleri okunamadi.");
  }

  const credentialIndex = relativeSegments.findIndex((segment, index) => {
    if (index >= relativeSegments.length - 1) {
      return false;
    }

    return (
      decodeURIComponent(segment) === config.username &&
      decodeURIComponent(relativeSegments[index + 1] ?? "") === config.password
    );
  });

  if (credentialIndex === -1) {
    throw new Error("Stream URL referans credential ile uyusmuyor.");
  }

  const templatedSegments = [...relativeSegments];
  templatedSegments[credentialIndex] = USERNAME_PLACEHOLDER;
  templatedSegments[credentialIndex + 1] = PASSWORD_PLACEHOLDER;

  const hasContentAfterCredentials = templatedSegments.slice(credentialIndex + 2).length > 0;
  if (!hasContentAfterCredentials) {
    throw new Error("Stream URL icerik yolu bos.");
  }

  const path = templatedSegments.join("/");
  return `${path}${url.search}`;
}

export function buildStreamUrl(
  baseUrl: string,
  username: string,
  password: string,
  streamPath: string
) {
  const base = baseUrl.replace(/\/+$/, "");
  const normalizedPath = streamPath.replace(/^\/+/, "");
  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);

  const templatedPath = normalizedPath
    .replaceAll(USERNAME_PLACEHOLDER, encodedUsername)
    .replaceAll(PASSWORD_PLACEHOLDER, encodedPassword);

  if (templatedPath !== normalizedPath) {
    return `${base}/${templatedPath}`;
  }

  return `${base}/${encodedUsername}/${encodedPassword}/${normalizedPath}`;
}

export type SharedSourceRowLike = {
  shared_source_base_url: string | null;
  shared_source_playlist_path: string | null;
  shared_source_playlist_suffix: string | null;
  shared_source_reference_username: string | null;
  shared_source_reference_password: string | null;
};

export function getSharedPlaylistConfig(row: SharedSourceRowLike | null): PlaylistConfig | null {
  if (
    !row?.shared_source_base_url ||
    !row.shared_source_playlist_path ||
    !row.shared_source_playlist_suffix ||
    !row.shared_source_reference_username ||
    !row.shared_source_reference_password
  ) {
    return null;
  }

  return {
    baseUrl: row.shared_source_base_url,
    playlistPath: row.shared_source_playlist_path,
    playlistSuffix: row.shared_source_playlist_suffix,
    username: row.shared_source_reference_username,
    password: row.shared_source_reference_password
  };
}

export function redactCredentials(input: string): string {
  if (!input) {
    return "";
  }

  return input
    .replace(/(?:[?&]|\b)(password|username|token)=[^& \t\r\n]+/gi, (match, key) =>
      match.startsWith("?") || match.startsWith("&") ? `${match[0]}${key}=***` : `${key}=***`
    )
    .replace(/(password["']?\s*:\s*["'])[^"']+(["'])/gi, "$1***$2")
    .replace(/(username["']?\s*:\s*["'])[^"']+(["'])/gi, "$1***$2")
    .replace(/(token["']?\s*:\s*["'])[^"']+(["'])/gi, "$1***$2")
    .replace(/(\/(?:playlist|live|movie|series)\/)[^/]+\/[^/]+(\/?[^ \t\r\n]*)/gi, "$1***/***$2");
}

