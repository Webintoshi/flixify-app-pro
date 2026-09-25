import type { Episode, MediaItem } from "./types";

type Seasons = NonNullable<MediaItem["seasons"]>;

function orderedPlayable(seasons: Seasons): Episode[] {
  return seasons
    .slice()
    .sort((left, right) => left.seasonNumber - right.seasonNumber)
    .flatMap(season => season.episodes.slice().sort((left, right) => left.episodeNumber - right.episodeNumber))
    .filter(episode => episode.playbackAllowed);
}

export function nextPlayableEpisode(seasons: Seasons, currentId: string): Episode | null {
  const episodes = orderedPlayable(seasons);
  const index = episodes.findIndex(episode => episode.id === currentId);
  return index >= 0 ? episodes[index + 1] ?? null : null;
}

export function firstUnwatchedEpisode(seasons: Seasons, watched: ReadonlySet<string>): Episode | null {
  const episodes = orderedPlayable(seasons);
  return episodes.find(episode => !watched.has(episode.id)) ?? episodes[0] ?? null;
}
