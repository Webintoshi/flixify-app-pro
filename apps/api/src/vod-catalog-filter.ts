import {
  isJunkVodCatalogTitle,
  isValidMovieCatalogEntry,
  isValidSeriesEpisodeCatalogEntry
} from "@flixify/contracts";

export type StoredMovieCatalogRow = {
  id: string;
  title: string;
  poster_url: string | null;
  group_title: string | null;
  stream_path: string;
  order_index: number;
};

export type StoredSeriesCatalogRow = {
  id: string;
  title: string;
  poster_url: string | null;
  group_title: string | null;
};

export type StoredSeriesEpisodeRow = {
  id: string;
  series_id: string;
  title: string;
  season_number: number;
  episode_number: number;
  stream_path: string;
  order_index?: number;
};

export function filterStoredMovieCatalogRows(rows: StoredMovieCatalogRow[]) {
  return rows.filter((row) =>
    isValidMovieCatalogEntry({
      title: row.title,
      groupTitle: row.group_title,
      source: row.stream_path
    })
  );
}

export function filterStoredSeriesCatalogRows(
  seriesRows: StoredSeriesCatalogRow[],
  episodeRows: StoredSeriesEpisodeRow[]
) {
  const seriesById = new Map(seriesRows.map((row) => [row.id, row] as const));
  const episodesBySeriesId = new Map<string, StoredSeriesEpisodeRow[]>();

  for (const episode of episodeRows) {
    const seriesRow = seriesById.get(episode.series_id);
    if (!seriesRow || isJunkVodCatalogTitle(seriesRow.title)) {
      continue;
    }

    if (
      !isValidSeriesEpisodeCatalogEntry({
        seriesTitle: seriesRow.title,
        title: episode.title,
        groupTitle: seriesRow.group_title,
        source: episode.stream_path
      })
    ) {
      continue;
    }

    const bucket = episodesBySeriesId.get(episode.series_id) ?? [];
    bucket.push(episode);
    episodesBySeriesId.set(episode.series_id, bucket);
  }

  const filteredSeriesRows = seriesRows.filter((row) => {
    if (isJunkVodCatalogTitle(row.title)) {
      return false;
    }

    return (episodesBySeriesId.get(row.id)?.length ?? 0) > 0;
  });

  const filteredEpisodesBySeriesId = new Map<string, StoredSeriesEpisodeRow[]>();
  for (const row of filteredSeriesRows) {
    filteredEpisodesBySeriesId.set(row.id, episodesBySeriesId.get(row.id) ?? []);
  }

  return {
    seriesRows: filteredSeriesRows,
    episodesBySeriesId: filteredEpisodesBySeriesId
  };
}
