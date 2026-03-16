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
