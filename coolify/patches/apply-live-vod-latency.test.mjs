import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyLiveVodLatencyPatch, patchLiveVodInPlace, transformLiveVodSource } from "./apply-live-vod-latency.mjs";

const liveFragment = `
  async function emitDiagnostic(input: DiagnosticInput) {
    try {
      await options.onDiagnostic?.(input);
    } catch {
      // Diagnostics should never block playback startup.
    }
  }

  async function createPlayback(input: CreateVodPlaybackInput): Promise<VodPlaybackRecord> {
    const debugEnabled = input.debug === true || process.env.FLIXIFY_VOD_DEBUG === "1";
    const probe = await probeVodStream(input.sourceUrl, input.proxyUrl);
    const allowUnverifiedSource = input.allowUnverifiedSource === true;
    const explicitSourceFailure = !probe.ok && probe.statusCode !== 0;
    if (explicitSourceFailure || ((!probe.ok || !probe.finalUrl) && !allowUnverifiedSource)) {
      return buildDisabledPlaybackRecord({ itemId: input.itemId });
    }
    const effectiveSourceUrl = probe.finalUrl ?? input.sourceUrl;
    const effectiveTransport = probe.transport;
    const mediaProfile = await probeVodMediaProfile(options.ffprobeBinary, effectiveSourceUrl, effectiveTransport, input.proxyUrl);
    const canUseFfmpeg = decision.requiresFfmpeg ? await checkFfmpegAvailability() : true;
    if (decision.requiresFfmpeg && !canUseFfmpeg) {
      debugLog("unsupported-without-ffmpeg", { transport: effectiveTransport });
      return buildDisabledPlaybackRecord({ itemId: input.itemId });
    }

    await emitDiagnostic({
      itemId: session.itemId,
      kind: session.kind,
      event: "session-created",
      detail: {
        audioTrackCount: session.audioTracks.length,
        defaultAudioTrackId: session.defaultAudioTrackId,
        selectedAudioTrackId: session.selectedAudioTrackId
      }
    });
  }
`;

test("live patch preserves proxy arguments and records nonblocking stage timings", () => {
  const patched = transformLiveVodSource(liveFragment);

  assert.match(patched, /void Promise\.resolve\(options\.onDiagnostic\?\.\(input\)\)\.catch\(\(\) => undefined\)/);
  assert.match(patched, /probeVodStream\(input\.sourceUrl, input\.proxyUrl\)/);
  assert.match(patched, /probeVodMediaProfile\(options\.ffprobeBinary, effectiveSourceUrl, effectiveTransport, input\.proxyUrl\)/);
  assert.match(patched, /const probeDurationMs = Math\.round\(performance\.now\(\) - startupStartedAt\)/);
  assert.match(patched, /const mediaProfileDurationMs = Math\.round\(performance\.now\(\) - mediaProfileStartedAt\)/);
  assert.match(patched, /sessionCreatedDurationMs: Math\.round\(performance\.now\(\) - startupStartedAt\)/);
  assert.match(patched, /errorCode: "source-probe-failed"/);
  assert.match(patched, /errorCode: "ffmpeg-unavailable"/);
  assert.equal((patched.match(/event: "playback-failed"/g) ?? []).length, 2);
  assert.doesNotMatch(patched, /sourceUrl: input\.sourceUrl,\s*errorCode:/);
  assert.equal((patched.match(/probeDurationMs,/g) ?? []).length, 3);
  assert.equal((patched.match(/mediaProfileDurationMs,/g) ?? []).length, 2);
});

test("live patch rejects missing or duplicate anchors", () => {
  assert.throws(() => transformLiveVodSource(liveFragment.replace("await options.onDiagnostic?.(input);", "return;")), /exactly one.*diagnostic/i);
  assert.throws(() => transformLiveVodSource(liveFragment.replace("const probe = await probeVodStream(input.sourceUrl, input.proxyUrl);", "const probe = await probeVodStream(input.sourceUrl);")), /exactly one.*probe/i);
  assert.throws(() => transformLiveVodSource(liveFragment + liveFragment), /exactly one/i);
});

test("file patch checks SHA before writing and leaves input untouched", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "flixify-live-vod-patch-"));
  const sourcePath = path.join(tempDir, "live-vod.ts");
  const outputPath = path.join(tempDir, "patched-vod.ts");
  await writeFile(sourcePath, liveFragment);

  try {
    await assert.rejects(
      applyLiveVodLatencyPatch({ sourcePath, outputPath, expectedSha256: "0".repeat(64) }),
      /SHA256 mismatch/i
    );
    await assert.rejects(readFile(outputPath));

    const expectedSha256 = createHash("sha256").update(liveFragment).digest("hex");
    await applyLiveVodLatencyPatch({ sourcePath, outputPath, expectedSha256 });
    assert.equal(await readFile(sourcePath, "utf8"), liveFragment);
    assert.match(await readFile(outputPath, "utf8"), /sessionCreatedDurationMs/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("image build patch atomically replaces only the verified source", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "flixify-live-vod-image-patch-"));
  const sourcePath = path.join(tempDir, "vod.ts");
  await writeFile(sourcePath, liveFragment);

  try {
    const expectedSha256 = createHash("sha256").update(liveFragment).digest("hex");
    await patchLiveVodInPlace({ sourcePath, expectedSha256 });
    assert.match(await readFile(sourcePath, "utf8"), /sessionCreatedDurationMs/);
    await assert.rejects(patchLiveVodInPlace({ sourcePath, expectedSha256 }), /SHA256 mismatch/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
