import { createHash } from "node:crypto";
import { query } from "./db.js";

export type LiveChannelPolicy = { revision: string; excludedIds: string[] };
type PolicyLog = { warn(fields: { code: string }, message: string): void };

function canonicalOrigin(value: string): string {
  const origin = new URL(value);
  if (value.length > 256 || origin.protocol !== "https:" || origin.username || origin.password || origin.origin !== value) {
    throw new Error("Invalid live channel policy origin");
  }
  return origin.origin;
}

export function buildLiveChannelPolicy(origin: string, ids: string[]): LiveChannelPolicy {
  canonicalOrigin(origin);
  if (!Array.isArray(ids) || ids.length > 50000 || ids.some((id) => typeof id !== "string" || !/^[1-9]\d{0,14}$/.test(id))) {
    throw new Error("Invalid live channel exclusions");
  }
  const excludedIds = [...new Set(ids)].sort((left, right) => left.length - right.length || left.localeCompare(right, "en"));
  const revision = createHash("sha256").update(JSON.stringify(["flixify-live-policy-v1", origin, excludedIds])).digest("hex");
  return { revision, excludedIds };
}

export async function loadLiveChannelPolicy(origin: string, log?: PolicyLog): Promise<LiveChannelPolicy | undefined> {
  try {
    canonicalOrigin(origin);
    const result = await query<{ stream_id: string }>(
      `select stream_id from public.live_channel_exclusions
       where provider_origin = $1
       order by length(stream_id), stream_id
       limit 50001`,
      [origin]
    );
    return buildLiveChannelPolicy(origin, result.rows.map((row: { stream_id: string }) => row.stream_id));
  } catch {
    if (log) log.warn({ code: "LIVE_POLICY_UNAVAILABLE" }, "Live channel exclusions unavailable");
    else console.warn("Live channel exclusions unavailable", { code: "LIVE_POLICY_UNAVAILABLE" });
    return undefined;
  }
}
