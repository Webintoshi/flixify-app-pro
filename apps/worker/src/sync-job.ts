import crypto from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  buildLiveVariantMetadata,
  isValidMovieCatalogEntry,
  isValidSeriesEpisodeCatalogEntry
} from "@flixify/contracts";
import { pool as defaultPool } from "./db.js";
import {
  buildPlaylistUrl,
  extractStreamPath,
  getSharedPlaylistConfig,
  redactCredentials,
  type PlaylistConfig
} from "./iptv.js";
import { classifyLiveChannelCountry } from "./live-country.js";
import { detectLiveTransport } from "./live.js";
import { isValidM3UContent, parseM3U, type ParsedCatalog } from "./m3u.js";

const INSERT_BATCH_SIZE = 500;

export const LIVE_VARIANT_COLUMNS_SQL = `
  alter table public.shared_live_channels
  add column if not exists variant_group_key text,
  add column if not exists quality_rank integer;

  create index if not exists idx_shared_live_channels_variant_lookup
  on public.shared_live_channels(snapshot_version, variant_group_key, quality_rank desc, order_index asc);
`;

export type SharedSourceRow = QueryResultRow & {
  shared_source_base_url: string | null;
  shared_source_playlist_path: string | null;
  shared_source_playlist_suffix: string | null;
  shared_source_reference_username: string | null;
  shared_source_reference_password: string | null;
  shared_source_snapshot_version: number | null;
};

export type PoolClientLike = {
  query: <T extends QueryResultRow = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

export type PoolLike = {
  connect: () => Promise<PoolClientLike>;
  query: <T extends QueryResultRow = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
};

export type ProcessJobDeps = {
  pool?: PoolLike;
  fetch?: typeof fetch;
  logger?: {
    warn: (msg: string) => void;
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
};

function chunkArray<T>(items: T[], size = INSERT_BATCH_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeSeriesKey(value: string) {
  return value
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ")
    .trim();
}

function tryExtractStreamPath(
  streamUrl: string,
  config: PlaylistConfig,
  context: string,
  logger: { warn: (msg: string) => void } = console
) {
  try {
    const streamPath = extractStreamPath(streamUrl, config);
    return streamPath.trim().length > 0 ? streamPath : null;
  } catch (error) {
    const message = error instanceof Error ? redactCredentials(error.message) : "Bilinmeyen stream path hatasi.";
    logger.warn(`[worker] ${context}: stream atlandi -> ${message}`);
    return null;
  }
}

export async function loadSharedSourceConfig(client: PoolClientLike | PoolClient) {
  const result = await client.query<SharedSourceRow>(
    `
      select
        shared_source_base_url,
        shared_source_playlist_path,
        shared_source_playlist_suffix,
        shared_source_reference_username,
        shared_source_reference_password,
        shared_source_snapshot_version
      from public.app_settings
      where id = true
      limit 1
    `
  );

  return result.rows[0] ?? null;
}

export async function markJobFailed(
  jobId: string,
  message: string,
  targetPool: PoolLike | typeof defaultPool = defaultPool
) {
  await targetPool.query(
    `
      update public.shared_m3u_sync_jobs
      set status = 'failed',
          error_message = $2,
          completed_at = timezone('utc', now())
      where id = $1
    `,
    [jobId, message]
  );

  await targetPool.query(
    `
      update public.app_settings
      set shared_source_status = case
            when coalesce(shared_source_snapshot_version, 0) > 0 then 'ready'
            else 'error'
          end,
          shared_source_last_error = $1
      where id = true
    `,
    [message]
  );
}

export async function insertSharedLiveChannels(
  client: PoolClientLike | PoolClient,
  snapshotVersion: number,
  catalog: ParsedCatalog["live"],
  config: PlaylistConfig,
  logger: { warn: (msg: string) => void; info: (msg: string) => void } = console
) {
  const records: Array<{
    title: string;
    group_title: string | null;
    logo_url: string | null;
    stream_path: string;
    transport: "ts" | "hls" | "mp4" | "mkv" | "unknown";
    tvg_id: string | null;
    variant_group_key: string | null;
    quality_rank: number | null;
    country_code: string | null;
    country_confidence: "high" | "medium" | "unknown";
    country_match_reason: "prefix" | "tr_strong_group" | "tr_balanced_multi_signal" | "none";
    order_index: number;
  }> = [];
  let skippedCount = 0;
  const countryStats = {
    total: 0,
    matched: 0,
    byReason: {
      prefix: 0,
      tr_strong_group: 0,
      tr_balanced_multi_signal: 0,
      none: 0
    },
    byConfidence: {
      high: 0,
      medium: 0,
      unknown: 0
    }
  };

  for (const channel of catalog) {
    const streamPath = tryExtractStreamPath(channel.streamUrl, config, `canli:${channel.title}`, logger);
    if (!streamPath) {
      skippedCount += 1;
      continue;
    }
    const country = classifyLiveChannelCountry({
      title: channel.title,
      groupTitle: channel.groupTitle,
      tvgId: channel.tvgId
    });
    const variantMetadata = buildLiveVariantMetadata(channel.title);
    countryStats.total += 1;
    countryStats.byReason[country.reason] += 1;
    countryStats.byConfidence[country.confidence] += 1;
    if (country.countryCode) {
      countryStats.matched += 1;
    }

    records.push({
      title: channel.title,
      group_title: channel.groupTitle,
      logo_url: channel.logoUrl,
      stream_path: streamPath,
      transport: detectLiveTransport(channel.streamUrl),
      tvg_id: channel.tvgId,
      variant_group_key: variantMetadata.variantGroupKey,
      quality_rank: variantMetadata.qualityRank,
      country_code: country.countryCode,
      country_confidence: country.confidence,
      country_match_reason: country.reason,
      order_index: records.length
    });
  }

  if (skippedCount > 0) {
    logger.warn(`[worker] Canli katalogda ${skippedCount} kayit gecersiz stream nedeniyle atlandi.`);
  }
  logger.info(
    `[worker] Canli ulke siniflandirma: toplam=${countryStats.total} eslesen=${countryStats.matched} ` +
      `high=${countryStats.byConfidence.high} medium=${countryStats.byConfidence.medium} unknown=${countryStats.byConfidence.unknown} ` +
      `prefix=${countryStats.byReason.prefix} tr_strong=${countryStats.byReason.tr_strong_group} ` +
      `tr_medium=${countryStats.byReason.tr_balanced_multi_signal} none=${countryStats.byReason.none}`
  );

  for (const batch of chunkArray(records)) {
    await client.query(
      `
        insert into public.shared_live_channels (
          snapshot_version,
          title,
          group_title,
          logo_url,
          stream_path,
          transport,
          tvg_id,
          variant_group_key,
          quality_rank,
          country_code,
          country_confidence,
          country_match_reason,
          order_index
        )
        select
          $1::integer,
          item.title,
          item.group_title,
          item.logo_url,
          item.stream_path,
          item.transport,
          item.tvg_id,
          item.variant_group_key,
          item.quality_rank,
          item.country_code,
          item.country_confidence,
          item.country_match_reason,
          item.order_index
        from jsonb_to_recordset($2::jsonb) as item(
          title text,
          group_title text,
          logo_url text,
          stream_path text,
          transport text,
          tvg_id text,
          variant_group_key text,
          quality_rank integer,
          country_code text,
          country_confidence text,
          country_match_reason text,
          order_index integer
        )
      `,
      [snapshotVersion, JSON.stringify(batch)]
    );
  }
}

export async function insertSharedMovies(
  client: PoolClientLike | PoolClient,
  snapshotVersion: number,
  catalog: ParsedCatalog["movies"],
  config: PlaylistConfig,
  logger: { warn: (msg: string) => void } = console
) {
  const records: Array<{
    title: string;
    poster_url: string | null;
    group_title: string | null;
    stream_path: string;
    order_index: number;
  }> = [];
  let skippedCount = 0;

  for (const movie of catalog) {
    const streamPath = tryExtractStreamPath(movie.streamUrl, config, `film:${movie.title}`, logger);
    if (!streamPath) {
      skippedCount += 1;
      continue;
    }

    if (
      !isValidMovieCatalogEntry({
        title: movie.title,
        groupTitle: movie.groupTitle,
        source: streamPath
      })
    ) {
      skippedCount += 1;
      continue;
    }

    records.push({
      title: movie.title,
      poster_url: movie.logoUrl,
      group_title: movie.groupTitle,
      stream_path: streamPath,
      order_index: records.length
    });
  }

  if (skippedCount > 0) {
    logger.warn(`[worker] Film katalogunda ${skippedCount} kayit gecersiz stream nedeniyle atlandi.`);
  }

  for (const batch of chunkArray(records)) {
    await client.query(
      `
        insert into public.shared_movies (
          snapshot_version,
          title,
          poster_url,
          group_title,
          stream_path,
          order_index
        )
        select
          $1::integer,
          item.title,
          item.poster_url,
          item.group_title,
          item.stream_path,
          item.order_index
        from jsonb_to_recordset($2::jsonb) as item(
          title text,
          poster_url text,
          group_title text,
          stream_path text,
          order_index integer
        )
      `,
      [snapshotVersion, JSON.stringify(batch)]
    );
  }
}

export async function insertSharedSeriesAndEpisodes(
  client: PoolClientLike | PoolClient,
  snapshotVersion: number,
  catalog: ParsedCatalog["series"],
  config: PlaylistConfig,
  logger: { warn: (msg: string) => void } = console
) {
  const orderedCatalog = catalog
    .slice()
    .sort((left, right) => {
      const titleCompare = normalizeSeriesKey(left.seriesTitle).localeCompare(normalizeSeriesKey(right.seriesTitle), "tr");
      if (titleCompare !== 0) {
        return titleCompare;
      }
      if (left.seasonNumber !== right.seasonNumber) {
        return left.seasonNumber - right.seasonNumber;
      }
      if (left.episodeNumber !== right.episodeNumber) {
        return left.episodeNumber - right.episodeNumber;
      }
      return left.title.localeCompare(right.title, "tr");
    });
  const seriesMap = new Map<string, string>();
  const seriesByKey = new Map<string, { poster_url: string | null }>();
  const seriesRecords: Array<{
    id: string;
    title: string;
    poster_url: string | null;
    group_title: string | null;
    order_index: number;
  }> = [];
  const episodeRecords: Array<{
    id: string;
    series_id: string;
    title: string;
    season_number: number;
    episode_number: number;
    stream_path: string;
    order_index: number;
  }> = [];
  let skippedCount = 0;

  for (const entry of orderedCatalog) {
    const streamPath = tryExtractStreamPath(entry.streamUrl, config, `dizi:${entry.title}`, logger);
    if (!streamPath) {
      skippedCount += 1;
      continue;
    }

    if (
      !isValidSeriesEpisodeCatalogEntry({
        seriesTitle: entry.seriesTitle,
        title: entry.title,
        groupTitle: entry.groupTitle,
        source: streamPath
      })
    ) {
      skippedCount += 1;
      continue;
    }

    const seriesTitle = entry.seriesTitle.trim().length > 0 ? entry.seriesTitle : entry.title;
    const seriesKey = normalizeSeriesKey(seriesTitle);
    let seriesId = seriesMap.get(seriesKey);
    if (!seriesId) {
      seriesId = crypto.randomUUID();
      seriesMap.set(seriesKey, seriesId);
      const record = {
        id: seriesId,
        title: seriesTitle,
        poster_url: entry.logoUrl,
        group_title: entry.groupTitle,
        order_index: seriesRecords.length
      };
      seriesByKey.set(seriesKey, record);
      seriesRecords.push({
        ...record
      });
    } else if (entry.logoUrl) {
      const seriesRecord = seriesByKey.get(seriesKey);
      if (seriesRecord && !seriesRecord.poster_url) {
        seriesRecord.poster_url = entry.logoUrl;
      }
      const existingIndex = seriesRecords.findIndex((item) => item.id === seriesId);
      if (existingIndex >= 0 && !seriesRecords[existingIndex]?.poster_url) {
        seriesRecords[existingIndex] = {
          ...seriesRecords[existingIndex],
          poster_url: entry.logoUrl
        };
      }
    }

    episodeRecords.push({
      id: crypto.randomUUID(),
      series_id: seriesId,
      title: entry.title,
      season_number: entry.seasonNumber,
      episode_number: entry.episodeNumber,
      stream_path: streamPath,
      order_index: episodeRecords.length
    });
  }

  if (skippedCount > 0) {
    logger.warn(`[worker] Dizi katalogunda ${skippedCount} bolum gecersiz stream nedeniyle atlandi.`);
  }

  for (const batch of chunkArray(seriesRecords)) {
    await client.query(
      `
        insert into public.shared_series (
          id,
          snapshot_version,
          title,
          poster_url,
          group_title,
          order_index
        )
        select
          item.id::uuid,
          $1::integer,
          item.title,
          item.poster_url,
          item.group_title,
          item.order_index
        from jsonb_to_recordset($2::jsonb) as item(
          id text,
          title text,
          poster_url text,
          group_title text,
          order_index integer
        )
      `,
      [snapshotVersion, JSON.stringify(batch)]
    );
  }

  for (const batch of chunkArray(episodeRecords)) {
    await client.query(
      `
        insert into public.shared_episodes (
          id,
          series_id,
          snapshot_version,
          title,
          season_number,
          episode_number,
          stream_path,
          order_index
        )
        select
          item.id::uuid,
          item.series_id::uuid,
          $1::integer,
          item.title,
          item.season_number,
          item.episode_number,
          item.stream_path,
          item.order_index
        from jsonb_to_recordset($2::jsonb) as item(
          id text,
          series_id text,
          title text,
          season_number integer,
          episode_number integer,
          stream_path text,
          order_index integer
        )
      `,
      [snapshotVersion, JSON.stringify(batch)]
    );
  }
}

export async function cleanupOldSnapshots(client: PoolClientLike | PoolClient, currentSnapshotVersion: number) {
  const floorVersion = Math.max(currentSnapshotVersion - 1, 0);
  await client.query("delete from public.shared_live_channels where snapshot_version < $1", [floorVersion]);
  await client.query("delete from public.shared_movies where snapshot_version < $1", [floorVersion]);
  await client.query("delete from public.shared_episodes where snapshot_version < $1", [floorVersion]);
  await client.query("delete from public.shared_series where snapshot_version < $1", [floorVersion]);
}

export async function processJob(job: { id: string }, deps?: ProcessJobDeps) {
  const activePool = deps?.pool ?? defaultPool;
  const activeFetch = deps?.fetch ?? fetch;
  const activeLogger = deps?.logger ?? console;

  try {
    const configClient = await activePool.connect();
    let configRow: SharedSourceRow | null = null;
    try {
      configRow = await loadSharedSourceConfig(configClient);
    } finally {
      configClient.release();
    }

    const config = getSharedPlaylistConfig(configRow);
    if (!config) {
      throw new Error("Ortak playlist kaynagi ayarlanmamis.");
    }

    const response = await activeFetch(buildPlaylistUrl(config));
    if (!response.ok) {
      throw new Error(`M3U indirme hatasi: ${response.status}`);
    }

    const content = await response.text();
    if (!isValidM3UContent(content)) {
      throw new Error("Gecerli M3U formati bulunamadi (HTML veya hatali yanit).");
    }

    const catalog = parseM3U(content, {
      artworkBaseUrl: config.baseUrl
    });

    if (
      catalog.live.length === 0 &&
      catalog.movies.length === 0 &&
      catalog.series.length === 0
    ) {
      throw new Error("M3U iceriginde gecerli yayin veya katalog kaydi bulunamadi.");
    }

    const snapshotVersion = (configRow?.shared_source_snapshot_version ?? 0) + 1;

    const client = await activePool.connect();
    try {
      await client.query("begin");
      await client.query(LIVE_VARIANT_COLUMNS_SQL);
      await insertSharedLiveChannels(client, snapshotVersion, catalog.live, config, activeLogger);
      await insertSharedMovies(client, snapshotVersion, catalog.movies, config, activeLogger);
      await insertSharedSeriesAndEpisodes(client, snapshotVersion, catalog.series, config, activeLogger);

      await client.query(
        `
          update public.app_settings
          set shared_source_status = 'ready',
              shared_source_snapshot_version = $1,
              shared_source_last_successful_sync_at = timezone('utc', now()),
              shared_source_last_error = null
          where id = true
        `,
        [snapshotVersion]
      );

      await client.query(
        `
          update public.shared_m3u_sync_jobs
          set status = 'succeeded',
              snapshot_version = $2,
              completed_at = timezone('utc', now()),
              error_message = null
          where id = $1
        `,
        [job.id, snapshotVersion]
      );

      await cleanupOldSnapshots(client, snapshotVersion);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Bilinmeyen isleyici hatasi";
    const safeMessage = redactCredentials(rawMessage);
    await markJobFailed(job.id, safeMessage, activePool);
    try {
      const errorClient = await activePool.connect();
      try {
        await errorClient.query(
          `
            update public.app_settings
            set shared_source_status = 'error',
                shared_source_last_error = $1
            where id = true
          `,
          [safeMessage]
        );
      } finally {
        errorClient.release();
      }
    } catch {
      // ignore secondary error
    }
  }
}
