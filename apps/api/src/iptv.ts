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

export function parsePlaylistUrl(rawUrl: string): PlaylistConfig {
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const playlistIndex = segments.findIndex((segment) => segment === "playlist");

  if (playlistIndex === -1 || segments.length < playlistIndex + 4) {
    throw new Error("Playlist URL formati gecersiz.");
  }

  const playlistPathSegments = segments.slice(0, playlistIndex + 1);
  const username = decodeURIComponent(segments[playlistIndex + 1] ?? "");
  const password = decodeURIComponent(segments[playlistIndex + 2] ?? "");
  const playlistSuffix = decodeURIComponent(segments.slice(playlistIndex + 3).join("/"));

  if (!username || !password || !playlistSuffix) {
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
  const suffix = config.playlistSuffix
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${base}/${playlistPath}/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${suffix}`;
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

  if (
    templatedPath.includes(USERNAME_PLACEHOLDER) ||
    templatedPath.includes(PASSWORD_PLACEHOLDER)
  ) {
    throw new Error("Stream path sablonu eksik credential degeri iceriyor.");
  }

  if (templatedPath !== normalizedPath) {
    return `${base}/${templatedPath}`;
  }

  return `${base}/${encodedUsername}/${encodedPassword}/${normalizedPath}`;
}

export function streamUrlMatchesCredentials(
  streamUrl: string,
  baseUrl: string,
  username: string,
  password: string
) {
  try {
    const target = new URL(streamUrl);
    const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

    if (target.origin !== base.origin) {
      return false;
    }

    const baseSegments = base.pathname.split("/").filter(Boolean);
    const targetSegments = target.pathname.split("/").filter(Boolean);

    for (let index = 0; index < baseSegments.length; index += 1) {
      if (targetSegments[index] !== baseSegments[index]) {
        return false;
      }
    }

    const relativeSegments = targetSegments.slice(baseSegments.length);
    return relativeSegments.some((segment, index) => {
      if (index >= relativeSegments.length - 1) {
        return false;
      }

      return (
        decodeURIComponent(segment) === username &&
        decodeURIComponent(relativeSegments[index + 1] ?? "") === password
      );
    });
  } catch {
    return false;
  }
}
