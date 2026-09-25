#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LIVE_VOD_SHA256 = "bf0f30692130863d0e0d15c225041335e26e5076a5c7d82a62956ac047cd4eb9";

function replaceExactlyOne(source, label, pattern, replacement) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} anchor; found ${matches.length}.`);
  }
  return source.replace(pattern, replacement);
}

export function transformLiveVodSource(source) {
  let patched = replaceExactlyOne(
    source,
    "diagnostic callback",
    /^([ \t]*)await options\.onDiagnostic\?\.\(input\);$/gm,
    (_, indent) => `${indent}void Promise.resolve(options.onDiagnostic?.(input)).catch(() => undefined);`
  );

  patched = replaceExactlyOne(
    patched,
    "createPlayback start",
    /^([ \t]*)async function createPlayback\(input: CreateVodPlaybackInput\): Promise<VodPlaybackRecord> \{(\r?\n)([ \t]*)const debugEnabled = input\.debug === true \|\| process\.env\.FLIXIFY_VOD_DEBUG === "1";$/gm,
    (_, functionIndent, newline, bodyIndent) =>
      `${functionIndent}async function createPlayback(input: CreateVodPlaybackInput): Promise<VodPlaybackRecord> {${newline}${bodyIndent}const startupStartedAt = performance.now();${newline}${bodyIndent}const debugEnabled = input.debug === true || process.env.FLIXIFY_VOD_DEBUG === "1";`
  );

  patched = replaceExactlyOne(
    patched,
    "provider probe",
    /^([ \t]*)const probe = await probeVodStream\(input\.sourceUrl, input\.proxyUrl\);(\r?\n)(?=[ \t]*debugLog\("probe-result", \{)/gm,
    (_, indent, newline) =>
      `${indent}const probe = await probeVodStream(input.sourceUrl, input.proxyUrl);${newline}${indent}const probeDurationMs = Math.round(performance.now() - startupStartedAt);${newline}`
  );

  patched = replaceExactlyOne(
    patched,
    "media profile probe",
    /^([ \t]*)const mediaProfile = await probeVodMediaProfile\(options\.ffprobeBinary, effectiveSourceUrl, effectiveTransport, input\.proxyUrl\);$/gm,
    (_, indent) =>
      `${indent}const mediaProfileStartedAt = performance.now();\n${indent}const mediaProfile = await probeVodMediaProfile(options.ffprobeBinary, effectiveSourceUrl, effectiveTransport, input.proxyUrl);\n${indent}const mediaProfileDurationMs = Math.round(performance.now() - mediaProfileStartedAt);`
  );

  patched = replaceExactlyOne(
    patched,
    "failed source probe branch",
    /^([ \t]*)if \(explicitSourceFailure \|\| \(\(!probe\.ok \|\| !probe\.finalUrl\) && !allowUnverifiedSource\)\) \{(\r?\n)/gm,
    (match, indent, newline) => {
      const bodyIndent = `${indent}  `;
      return `${match}${bodyIndent}await emitDiagnostic({${newline}${bodyIndent}  itemId: input.itemId,${newline}${bodyIndent}  kind: input.kind,${newline}${bodyIndent}  event: "playback-failed",${newline}${bodyIndent}  deliveryMode: "hls_transcoded",${newline}${bodyIndent}  sourceTransport: probe.transport,${newline}${bodyIndent}  errorCode: "source-probe-failed",${newline}${bodyIndent}  detail: {${newline}${bodyIndent}    probeDurationMs,${newline}${bodyIndent}    failedDurationMs: Math.round(performance.now() - startupStartedAt)${newline}${bodyIndent}  }${newline}${bodyIndent}});${newline}`;
    }
  );

  patched = replaceExactlyOne(
    patched,
    "FFmpeg unavailable branch",
    /^([ \t]*)if \(decision\.requiresFfmpeg && !canUseFfmpeg\) \{(\r?\n)/gm,
    (match, indent, newline) => {
      const bodyIndent = `${indent}  `;
      return `${match}${bodyIndent}await emitDiagnostic({${newline}${bodyIndent}  itemId: input.itemId,${newline}${bodyIndent}  kind: input.kind,${newline}${bodyIndent}  event: "playback-failed",${newline}${bodyIndent}  deliveryMode: "hls_transcoded",${newline}${bodyIndent}  sourceTransport: effectiveTransport,${newline}${bodyIndent}  errorCode: "ffmpeg-unavailable",${newline}${bodyIndent}  detail: {${newline}${bodyIndent}    probeDurationMs,${newline}${bodyIndent}    mediaProfileDurationMs,${newline}${bodyIndent}    failedDurationMs: Math.round(performance.now() - startupStartedAt)${newline}${bodyIndent}  }${newline}${bodyIndent}});${newline}`;
    }
  );

  patched = replaceExactlyOne(
    patched,
    "session-created detail",
    /(event: "session-created",[\s\S]*?detail: \{\r?\n[ \t]*audioTrackCount: session\.audioTracks\.length,\r?\n[ \t]*defaultAudioTrackId: session\.defaultAudioTrackId,\r?\n)([ \t]*)selectedAudioTrackId: session\.selectedAudioTrackId(\r?\n)([ \t]*\})/g,
    (_, prefix, indent, newline, closingBrace) =>
      `${prefix}${indent}selectedAudioTrackId: session.selectedAudioTrackId,${newline}${indent}probeDurationMs,${newline}${indent}mediaProfileDurationMs,${newline}${indent}sessionCreatedDurationMs: Math.round(performance.now() - startupStartedAt)${newline}${closingBrace}`
  );

  return patched;
}

export async function applyLiveVodLatencyPatch({ sourcePath, outputPath, expectedSha256 = LIVE_VOD_SHA256 }) {
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    throw new Error("Source and output paths must differ; the live source remains untouched.");
  }

  const sourceBytes = await readFile(sourcePath);
  const actualSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA256 mismatch for live VOD source: expected ${expectedSha256}, found ${actualSha256}.`);
  }

  const patched = transformLiveVodSource(sourceBytes.toString("utf8"));
  await writeFile(outputPath, patched, { flag: "wx" });
  return { outputSha256: createHash("sha256").update(patched).digest("hex") };
}

export async function patchLiveVodInPlace({ sourcePath, expectedSha256 = LIVE_VOD_SHA256 }) {
  const temporaryPath = `${sourcePath}.latency-${process.pid}-${randomUUID()}.tmp`;
  try {
    const result = await applyLiveVodLatencyPatch({ sourcePath, outputPath: temporaryPath, expectedSha256 });
    await rename(temporaryPath, sourcePath);
    return result;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const paths = process.argv.slice(2);
  if (paths.length !== 0 && paths.length !== 2) {
    console.error("Usage: node apply-live-vod-latency.mjs [SOURCE_VOD_TS OUTPUT_VOD_TS]");
    process.exitCode = 2;
  } else {
    try {
      if (paths.length === 0) {
        await patchLiveVodInPlace({ sourcePath: "/app/apps/api/src/vod.ts" });
      } else {
        await applyLiveVodLatencyPatch({ sourcePath: paths[0], outputPath: paths[1] });
      }
      console.log("Verified live VOD source and applied latency patch.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
