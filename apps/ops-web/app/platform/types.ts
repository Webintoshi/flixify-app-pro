export type Kind = "live" | "movie" | "series";
export type Episode = { id: string; title: string; seasonNumber: number; episodeNumber: number; playbackAllowed: boolean; watched?: boolean };
export type MediaItem = {
  id: string; title: string; kind: Kind; posterUrl?: string | null; logoUrl?: string | null;
  groupTitle?: string | null; playbackAllowed?: boolean; available?: boolean; lookupFailed?: boolean;
  seasons?: { seasonNumber: number; title: string; episodes: Episode[] }[];
  seasonCount?: number; episodeCount?: number;
};
export type Catalog = { items: MediaItem[]; total: number; groups?: { title: string; count: number }[] };
export type Session = { accessToken: string; refreshToken?: string; kryptoniteCode?: string | null; user?: { kryptoniteCode?: string | null } };
export const sessionKey = "flixify-public-session";
export const itemKey = (item: Pick<MediaItem,"kind"|"id">) => `${item.kind}:${item.id}`;
export const maskCode = (code: string) => code.length > 7 ? `${code.slice(0,4)}••••••${code.slice(-3)}` : "••••••";
