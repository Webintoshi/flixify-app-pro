import crypto from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { buildLiveVariantMetadata, isValidMovieCatalogEntry, isValidSeriesEpisodeCatalogEntry } from "@flixify/contracts";
import { env } from "./env.js";
import { pool } from "./db.js";
import { buildPlaylistUrl, buildStreamUrl, extractStreamPath, type PlaylistConfig } from "./iptv.js";
import { classifyLiveProbeHealth, detectLiveTransport, probeLiveStream } from "./live.js";
import { classifyLiveChannelCountry } from "./live-country.js";
import { parseM3U, type ParsedCatalog } from "./m3u.js";

let pausedUntil = 0;
const INSERT_BATCH_SIZE = 500;
const HEALTH_SWEEP_INTERVAL_MS = 60_000;
const HEALTH_PROBE_LIMIT = 24;
const PLAYLIST_ACCESS_PROBE_TIMEOUT_MS = 5_000;
let lastHealthSweepAt = 0;

const LIVE_VARIANT_COLUMNS_SQL = `
  alter table public.shared_live_channels
  add column if not exists variant_group_key text,
  add column if not exists quality_rank integer;

  create index if not exists idx_shared_live_channels_variant_lookup
  on public.shared_live_channels(snapshot_version, variant_group_key, quality_rank desc, order_index asc);
`;

type SharedSourceRow = QueryResultRow & {
  shared_source_base_url: string | null;
  shared_source_playlist_path: string | null;
  shared_source_playlist_suffix: string | null;
  shared_source_reference_username: string | null;
  shared_source_reference_password: string | null;
  shared_source_snapshot_version: number | null;
};

type HealthCandidateRow = QueryResultRow & {
  id: string;
  snapshot_version: number;
  stream_path: string;
  transport: "ts" | "hls" | "mp4" | "mkv" | "unknown";
  group_title: string | null;
};

function shouldPauseWorker(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("authentication") ||
    message.includes("password authentication failed") ||
    message.includes("circuit breaker open")
  );
}

function pauseWorker() {
  pausedUntil = Date.now() + 5 * 60 * 1000;
  console.error("Worker polling paused for 5 minutes after repeated database auth failures");
}

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

function tryExtractStreamPath(streamUrl: string, config: PlaylistConfig, context: string) {
  try {
    const streamPath = extractStreamPath(streamUrl, config);
    return streamPath.trim().length > 0 ? streamPath : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen stream path hatasi.";
    console.warn(`[worker] ${context}: stream atlandi -> ${message}`);
    return null;
  }
}

function getSharedPlaylistConfig(row: SharedSourceRow | null): PlaylistConfig | null {
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

async function loadSharedSourceConfig(client: PoolClient) {
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

async function canRunSharedHealthSweep(config: PlaylistConfig) {
  try {
    const response = await fetch(buildPlaylistUrl(config), {
      signal: AbortSignal.timeout(PLAYLIST_ACCESS_PROBE_TIMEOUT_MS)
    });
    const cancelPromise = response.body?.cancel?.();
    cancelPromise?.catch(() => {});

    if (!response.ok) {
      console.warn(
        `[worker] Shared health sweep atlandi: referans playlist erisimi basarisiz (${response.status}).`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      `[worker] Shared health sweep atlandi: referans playlist probe hatasi -> ${
        error instanceof Error ? error.message : "bilinmeyen hata"
      }`
    );
    return false;
  }
}

async function expireSubscriptions() {
  await pool.query(
    `
      update public.subscriptions
      set status = 'expired',
          end_reason = coalesce(end_reason, 'duration-finished')
      where status = 'active'
        and ends_at <= timezone('utc', now())
    `
  );
}

async function pullNextJob() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const jobResult = await client.query<{ id: string }>(
      `
        select id
        from public.shared_m3u_sync_jobs
        where status = 'queued'
        order by created_at asc
        limit 1
        for update skip locked
      `
    );

    const job = jobResult.rows[0];
    if (!job) {
      await client.query("rollback");
      return null;
    }

    await client.query(
      `
        update public.shared_m3u_sync_jobs
        set status = 'processing',
            attempt_count = attempt_count + 1,
            started_at = timezone('utc', now())
        where id = $1
      `,
      [job.id]
    );

    await client.query(
      `
        update public.app_settings
        set shared_source_status = 'syncing',
            shared_source_last_error = null
        where id = true
      `
    );

    await client.query("commit");
    return job;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function markJobFailed(jobId: string, message: string) {
  await pool.query(
    `
      update public.shared_m3u_sync_jobs
      set status = 'failed',
          error_message = $2,
          completed_at = timezone('utc', now())
      where id = $1
    `,
    [jobId, message]
  );

  await pool.query(
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

async function insertSharedLiveChannels(
  client: PoolClient,
  snapshotVersion: number,
  catalog: ParsedCatalog["live"],
  config: PlaylistConfig
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
    const streamPath = tryExtractStreamPath(channel.streamUrl, config, `canli:${channel.title}`);
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
    console.warn(`[worker] Canli katalogda ${skippedCount} kayit gecersiz stream nedeniyle atlandi.`);
  }
  console.info(
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

async function insertSharedMovies(
  client: PoolClient,
  snapshotVersion: number,
  catalog: ParsedCatalog["movies"],
  config: PlaylistConfig
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
    const streamPath = tryExtractStreamPath(movie.streamUrl, config, `film:${movie.title}`);
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
    console.warn(`[worker] Film katalogunda ${skippedCount} kayit gecersiz stream nedeniyle atlandi.`);
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

async function insertSharedSeriesAndEpisodes(
  client: PoolClient,
  snapshotVersion: number,
  catalog: ParsedCatalog["series"],
  config: PlaylistConfig
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
    const streamPath = tryExtractStreamPath(entry.streamUrl, config, `dizi:${entry.title}`);
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
    console.warn(`[worker] Dizi katalogunda ${skippedCount} bolum gecersiz stream nedeniyle atlandi.`);
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

async function cleanupOldSnapshots(client: PoolClient, currentSnapshotVersion: number) {
  const floorVersion = Math.max(currentSnapshotVersion - 1, 0);
  await client.query("delete from public.shared_live_channels where snapshot_version < $1", [floorVersion]);
  await client.query("delete from public.shared_movies where snapshot_version < $1", [floorVersion]);
  await client.query("delete from public.shared_episodes where snapshot_version < $1", [floorVersion]);
  await client.query("delete from public.shared_series where snapshot_version < $1", [floorVersion]);
}

async function loadHealthCandidates(limit = HEALTH_PROBE_LIMIT) {
  const result = await pool.query<HealthCandidateRow>(
    `
      select
        c.id,
        c.snapshot_version,
        c.stream_path,
        c.transport,
        c.group_title
      from public.shared_live_channels c
      left join public.shared_live_channel_health h on h.channel_id = c.id
      where c.snapshot_version = (
        select shared_source_snapshot_version
        from public.app_settings
        where id = true
      )
        and (
          upper(coalesce(c.country_code, '')) = 'TR'
          or lower(coalesce(c.group_title, '')) like 'tr:%'
          or c.order_index < 40
          or h.last_play_requested_at >= timezone('utc', now()) - interval '30 minutes'
          or coalesce(h.health_status, 'unknown') in ('degraded', 'broken')
        )
        and (
          h.last_checked_at is null
          or h.last_checked_at < timezone('utc', now()) - interval '2 minutes'
        )
      order by
        case
          when upper(coalesce(c.country_code, '')) = 'TR' then 0
          when lower(coalesce(c.group_title, '')) like 'tr:%' then 1
          when h.last_play_requested_at >= timezone('utc', now()) - interval '30 minutes' then 2
          when coalesce(h.health_status, 'unknown') in ('degraded', 'broken') then 3
          when c.order_index < 40 then 4
          else 5
        end,
        coalesce(h.last_checked_at, 'epoch'::timestamptz) asc,
        c.order_index asc
      limit $1
    `,
    [limit]
  );

  return result.rows;
}

async function updateLiveChannelHealth(
  channelId: string,
  snapshotVersion: number,
  input: {
    status: "healthy" | "degraded" | "broken";
    errorMessage?: string | null;
    resetFailureCount?: boolean;
  }
) {
  await pool.query(
    `
      insert into public.shared_live_channel_health (
        channel_id,
        snapshot_version,
        health_status,
        failure_count,
        last_checked_at,
        last_success_at,
        last_error
      ) values (
        $1,
        $2,
        $3,
        case when $3 = 'healthy' or $5::boolean then 0 else 1 end,
        timezone('utc', now()),
        case when $3 = 'healthy' then timezone('utc', now()) else null end,
        $4
      )
      on conflict (channel_id) do update
      set
        snapshot_version = excluded.snapshot_version,
        health_status = excluded.health_status,
        failure_count = case
          when excluded.health_status = 'healthy' or $5::boolean then 0
          else public.shared_live_channel_health.failure_count + 1
        end,
        last_checked_at = timezone('utc', now()),
        last_success_at = case
          when excluded.health_status = 'healthy' then timezone('utc', now())
          else public.shared_live_channel_health.last_success_at
        end,
        last_error = excluded.last_error
    `,
    [
      channelId,
      snapshotVersion,
      input.status,
      input.errorMessage ?? null,
      input.resetFailureCount ?? false
    ]
  );

  if (input.status !== "healthy") {
    await pool.query(
      `
        update public.shared_live_channel_health
        set health_status = case
          when failure_count >= 12 then 'broken'
          when failure_count >= 4 then 'degraded'
          else health_status
        end
        where channel_id = $1
      `,
      [channelId]
    );
  }
}

async function probeHotLiveChannels() {
  const configClient = await pool.connect();
  let configRow: SharedSourceRow | null = null;
  try {
    configRow = await loadSharedSourceConfig(configClient);
  } finally {
    configClient.release();
  }

  const config = getSharedPlaylistConfig(configRow);
  if (!config) {
    return;
  }

  if (!(await canRunSharedHealthSweep(config))) {
    return;
  }

  const candidates = await loadHealthCandidates();
  for (const candidate of candidates) {
    const streamUrl = buildStreamUrl(
      config.baseUrl,
      config.username,
      config.password,
      candidate.stream_path
    );
    const probe = await probeLiveStream(streamUrl);
    const status = classifyLiveProbeHealth(probe);
    await updateLiveChannelHealth(candidate.id, candidate.snapshot_version, {
      status,
      errorMessage: probe.errorMessage,
      resetFailureCount: probe.ok
    });
  }
}

async function processJob(job: { id: string }) {
  try {
    const configClient = await pool.connect();
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

    const response = await fetch(buildPlaylistUrl(config));
    if (!response.ok) {
      throw new Error(`M3U indirme hatasi: ${response.status}`);
    }

    const content = await response.text();
    const catalog = parseM3U(content, {
      artworkBaseUrl: config.baseUrl
    });
    const snapshotVersion = (configRow?.shared_source_snapshot_version ?? 0) + 1;

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(LIVE_VARIANT_COLUMNS_SQL);
      await insertSharedLiveChannels(client, snapshotVersion, catalog.live, config);
      await insertSharedMovies(client, snapshotVersion, catalog.movies, config);
      await insertSharedSeriesAndEpisodes(client, snapshotVersion, catalog.series, config);

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
    await markJobFailed(
      job.id,
      error instanceof Error ? error.message : "Bilinmeyen isleyici hatasi"
    );
  }
}

async function tick() {
  if (Date.now() < pausedUntil) {
    return;
  }

  await expireSubscriptions();
  const job = await pullNextJob();
  if (job) {
    await processJob(job);
    return;
  }

  if (Date.now() - lastHealthSweepAt >= HEALTH_SWEEP_INTERVAL_MS) {
    lastHealthSweepAt = Date.now();
    await probeHotLiveChannels();
  }
}

const interval =
  env.APP_DEMO_MODE
    ? null
    : setInterval(() => {
        tick().catch((error) => {
          console.error("Worker tick failed", error);
          if (shouldPauseWorker(error)) {
            pauseWorker();
          }
        });
      }, env.WORKER_POLL_INTERVAL_MS);

if (env.APP_DEMO_MODE) {
  console.log("Worker is running in demo mode. Database polling is disabled.");
} else {
  tick().catch((error) => {
    console.error("Initial worker tick failed", error);
    if (shouldPauseWorker(error)) {
      pauseWorker();
    }
  });
}

process.on("SIGINT", async () => {
  if (interval) {
    clearInterval(interval);
  }
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (interval) {
    clearInterval(interval);
  }
  await pool.end();
  process.exit(0);
});
