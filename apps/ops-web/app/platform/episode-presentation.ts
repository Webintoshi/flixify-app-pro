import type { Episode } from "./types";

export function episodeDisplayTitle(episode: Episode, seriesTitle: string): string {
  let title = episode.title.trim();
  const series = seriesTitle.trim();
  if (title.toLocaleLowerCase("tr").startsWith(series.toLocaleLowerCase("tr"))) {
    const rest = title.slice(series.length);
    if (/^\s*[-–—:|]\s*/.test(rest)) title = rest.replace(/^\s*[-–—:|]\s*/, "");
  }
  const code = new RegExp(`^S0*${episode.seasonNumber}E0*${episode.episodeNumber}(?:\\b|\\s)(?:\\s*[-–—:|]\\s*)?`, "i");
  title = title.replace(code, "").trim();
  return title || episode.title.trim();
}
