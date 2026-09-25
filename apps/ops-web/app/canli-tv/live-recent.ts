export function parseRecentChannelIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentChannel(ids: string[], id: string): string[] {
  return [id, ...ids.filter((current) => current !== id)].slice(0, 20);
}

export function recentStorageKey(accountCode: string | null | undefined, accessToken: string): string {
  let hash = 2166136261;
  for (const character of accountCode || accessToken) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `flixify-live-recent-${(hash >>> 0).toString(36)}`;
}
