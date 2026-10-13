/** Rewrite every media URI in an HLS manifest before it reaches a viewer. */
export function rewriteHlsManifest(
  content: string,
  resolveUri: (uri: string) => string | null
): string | null {
  const lines = content.split(/\r?\n/);
  if (lines.find((line) => line.trim())?.trim() !== "#EXTM3U") return null;

  const rewrite = (uri: string) => {
    if (!uri || /[\x00-\x20"<>\\{}]/.test(uri)) return null;
    try {
      const result = resolveUri(uri);
      return result && /^https?:\/\//i.test(result) && !/[\x00-\x20"<>]/.test(result) ? result : null;
    } catch {
      return null;
    }
  };

  const rewritten: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      rewritten.push(line);
      continue;
    }
    if (!trimmed.startsWith("#")) {
      const target = rewrite(trimmed);
      if (!target) return null;
      rewritten.push(target);
      continue;
    }

    // Variable substitution and content steering can embed further unproxied URLs.
    if (/^#EXT-X-(?:DEFINE|CONTENT-STEERING)(?::|$)/i.test(trimmed)) return null;
    const colon = line.indexOf(":");
    if (colon < 0 || !/^#EXT-X-/i.test(trimmed)) {
      rewritten.push(line);
      continue;
    }

    const prefix = line.slice(0, colon + 1);
    const attributes = line.slice(colon + 1);
    const parts: string[] = [];
    let quoted = false;
    let start = 0;
    for (let index = 0; index < attributes.length; index += 1) {
      const char = attributes[index];
      if (char === '"') quoted = !quoted;
      if (char === "," && !quoted) {
        parts.push(attributes.slice(start, index));
        start = index + 1;
      }
    }
    if (quoted) return null;
    parts.push(attributes.slice(start));

    const mappedParts: string[] = [];
    let foundUriAttribute = false;
    let hasUnparsedAttribute = false;
    for (const part of parts) {
      const equals = part.indexOf("=");
      if (equals < 0) {
        if (part.trim()) hasUnparsedAttribute = true;
        mappedParts.push(part);
        continue;
      }
      const name = part.slice(0, equals).trim();
      if (!/(?:^|-)URI$/i.test(name)) {
        mappedParts.push(part);
        continue;
      }
      foundUriAttribute = true;
      const raw = part.slice(equals + 1).trim();
      const uri = raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1)
        : !raw.includes('"') ? raw : null;
      const target = uri === null ? null : rewrite(uri);
      if (!target) return null;
      mappedParts.push(`${part.slice(0, equals + 1)}"${target}"`);
    }
    if (foundUriAttribute && hasUnparsedAttribute) return null;
    rewritten.push(`${prefix}${mappedParts.join(",")}`);
  }

  return rewritten.join("\n");
}

export function resolveHttpHlsUri(uri: string, parentUrl: string): string | null {
  try {
    const absolute = new URL(uri, parentUrl);
    if ((absolute.protocol !== "http:" && absolute.protocol !== "https:") || !absolute.hostname || absolute.username || absolute.password) {
      return null;
    }
    return absolute.toString();
  } catch {
    return null;
  }
}

export function isSafeLocalHlsUri(uri: string): boolean {
  return uri !== "." && uri !== ".." && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(uri);
}
