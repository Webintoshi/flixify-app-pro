#!/usr/bin/env node

import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = nextValue;
    index += 1;
  }

  return result;
}

function parseManifestState(content) {
  const mediaSequenceMatch = /^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m.exec(content);
  const mediaSequence = mediaSequenceMatch ? Number(mediaSequenceMatch[1]) : null;
  const segmentCount = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")).length;

  return {
    mediaSequence: Number.isFinite(mediaSequence) ? mediaSequence : null,
    segmentCount
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return text.length > 0 ? JSON.parse(text) : null;
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args.baseUrl ?? "http://localhost:4000").replace(/\/$/, "");
  const code = String(args.code ?? "").trim().toUpperCase();
  const channelNeedle = args.channel ? normalize(args.channel) : null;
  const channelId = args.channelId ? String(args.channelId).trim() : null;
  const intervalSeconds = Math.max(5, Number(args.interval ?? 20));
  const minutes = Math.max(1, Number(args.minutes ?? 120));
  const outputPath = path.resolve(String(args.out ?? `tmp/live-soak-${Date.now()}.jsonl`));

  if (!code) {
    throw new Error("--code gerekli");
  }

  if (!channelNeedle && !channelId) {
    throw new Error("--channel veya --channelId gerekli");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  const auth = await requestJson(`${baseUrl}/auth/login-by-code`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      code,
      deviceName: "Live Relay Soak Script",
      platform: "script"
    })
  });

  const accessToken = auth?.accessToken;
  if (!accessToken) {
    throw new Error("Access token alinamadi");
  }

  const headers = {
    authorization: `Bearer ${accessToken}`
  };

  let selectedChannelId = channelId;
  let selectedChannelTitle = channelId ?? "unknown";

  if (!selectedChannelId) {
    const search = encodeURIComponent(String(args.channel));
    const catalog = await requestJson(
      `${baseUrl}/me/catalog/live?page=1&pageSize=500&search=${search}`,
      { headers }
    );
    const items = Array.isArray(catalog?.items) ? catalog.items : [];
    const matched =
      items.find((item) => normalize(item.title) === channelNeedle) ??
      items.find((item) => normalize(item.title).includes(channelNeedle));

    if (!matched) {
      throw new Error(`Kanal bulunamadi: ${args.channel}`);
    }

    selectedChannelId = matched.id;
    selectedChannelTitle = matched.title;
  }

  const playback = await requestJson(`${baseUrl}/me/live/${selectedChannelId}/playback`, {
    headers
  });

  if (!playback?.url) {
    throw new Error(`Playback URL alinamadi: ${playback?.errorMessage ?? "bilinmeyen hata"}`);
  }

  const manifestUrl = playback.url;
  const deadline = Date.now() + minutes * 60 * 1000;
  let lastSequence = null;

  console.log(
    JSON.stringify({
      status: "started",
      channelId: selectedChannelId,
      channelTitle: selectedChannelTitle,
      deliveryMode: playback.deliveryMode,
      sourceTransport: playback.sourceTransport,
      transport: playback.transport,
      manifestUrl,
      outputPath
    })
  );

  while (Date.now() < deadline) {
    const startedAt = Date.now();
    let entry;

    try {
      const response = await fetch(manifestUrl, {
        headers: {
          "cache-control": "no-cache"
        }
      });

      const body = await response.text();
      const manifestState = response.ok ? parseManifestState(body) : { mediaSequence: null, segmentCount: 0 };
      const sequenceAdvanced =
        manifestState.mediaSequence !== null &&
        lastSequence !== null &&
        manifestState.mediaSequence > lastSequence;

      if (manifestState.mediaSequence !== null) {
        lastSequence = manifestState.mediaSequence;
      }

      entry = {
        ts: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        ok: response.ok,
        mediaSequence: manifestState.mediaSequence,
        segmentCount: manifestState.segmentCount,
        sequenceAdvanced,
        contentLength: body.length
      };
    } catch (error) {
      entry = {
        ts: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        ok: false,
        error: error instanceof Error ? error.message : "Bilinmeyen fetch hatasi"
      };
    }

    await appendFile(outputPath, `${JSON.stringify(entry)}\n`, "utf8");
    console.log(JSON.stringify(entry));
    await sleep(intervalSeconds * 1000);
  }

  console.log(
    JSON.stringify({
      status: "completed",
      outputPath
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
