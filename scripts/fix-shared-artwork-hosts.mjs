import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const LEGACY_ARTWORK_HOSTS = [
  "45.87.29.12",
  "epg.ottoprime.net",
  "home-playtv.com:25461",
  "kongking.shop",
  "latinoamericatv.vip:8080",
  "logo.uixtreamreseller.com:8080",
  "sltv-logo.cms-s.com",
  "udashboard.shop",
  "udashboard.shop:8080",
  "udashboard.vip",
  "udashboard.win",
  "xtitan.xyz:2082"
];

const TARGETS = [
  { table: "shared_live_channels", column: "logo_url" },
  { table: "shared_movies", column: "poster_url" },
  { table: "shared_series", column: "poster_url" }
];

const LEGACY_ARTWORK_PATH_REGEX = String.raw`^https?://[^/]+/(images|logo|picon|public/dist/img/uploads/logos)/`;

function getDatabaseSslConfig(databaseUrl) {
  return databaseUrl.includes("supabase.com") ? { rejectUnauthorized: false } : undefined;
}

function getArtworkBaseOrigin(sharedSourceBaseUrl) {
  const parsed = new URL(sharedSourceBaseUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(databaseUrl)
  });

  await client.connect();

  try {
    const settingsResult = await client.query(`
      select
        shared_source_base_url,
        shared_source_snapshot_version
      from public.app_settings
      where id = true
      limit 1
    `);

    const settings = settingsResult.rows[0];
    if (!settings?.shared_source_base_url) {
      throw new Error("shared_source_base_url is not configured.");
    }

    const snapshotVersion = Number(settings.shared_source_snapshot_version ?? 0);
    if (!Number.isFinite(snapshotVersion) || snapshotVersion <= 0) {
      throw new Error("shared_source_snapshot_version is invalid.");
    }

    const artworkBaseOrigin = getArtworkBaseOrigin(settings.shared_source_base_url);
    const summary = [];

    await client.query("begin");

    for (const target of TARGETS) {
      const previewResult = await client.query(
        `
          select count(*)::int as count
          from public.${target.table}
          where snapshot_version = $1
            and ${target.column} is not null
            and split_part(${target.column}, '/', 3) = any($2::text[])
            and ${target.column} ~* $3
        `,
        [snapshotVersion, LEGACY_ARTWORK_HOSTS, LEGACY_ARTWORK_PATH_REGEX]
      );

      const previewCount = Number(previewResult.rows[0]?.count ?? 0);
      const updateResult = await client.query(
        `
          update public.${target.table}
          set ${target.column} = regexp_replace(${target.column}, '^https?://[^/]+', $1, 'i')
          where snapshot_version = $2
            and ${target.column} is not null
            and split_part(${target.column}, '/', 3) = any($3::text[])
            and ${target.column} ~* $4
        `,
        [artworkBaseOrigin, snapshotVersion, LEGACY_ARTWORK_HOSTS, LEGACY_ARTWORK_PATH_REGEX]
      );

      summary.push({
        table: target.table,
        column: target.column,
        eligible: previewCount,
        updated: updateResult.rowCount ?? 0
      });
    }

    await client.query("commit");

    console.log(
      JSON.stringify(
        {
          snapshotVersion,
          artworkBaseOrigin,
          legacyArtworkHosts: LEGACY_ARTWORK_HOSTS,
          summary
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
