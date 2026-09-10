import type { PoolClient, QueryResultRow } from "pg";
import { env } from "./env.js";
import { pool } from "./db.js";
import {
  buildPlaylistUrl,
  buildStreamUrl,
  getSharedPlaylistConfig,
  redactCredentials,
  type PlaylistConfig
} from "./iptv.js";
import { classifyLiveProbeHealth, probeLiveStream } from "./live.js";
import { loadSharedSourceConfig, processJob, type SharedSourceRow } from "./sync-job.js";

let pausedUntil = 0;
const HEALTH_SWEEP_INTERVAL_MS = 60_000;
const HEALTH_PROBE_LIMIT = 24;
const PLAYLIST_ACCESS_PROBE_TIMEOUT_MS = 5_000;
let lastHealthSweepAt = 0;

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
      `[worker] Shared health sweep atlandi: referans playlist probe hatasi -> ${redactCredentials(
        error instanceof Error ? error.message : "bilinmeyen hata"
      )}`
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
