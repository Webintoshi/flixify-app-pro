import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const patchPath = new URL("./apply-live-telegram-callback-polling.mjs", import.meta.url).pathname;
const constructor = "const bot = new TelegramBot(config.telegramBotToken, { polling: false });";
const replacement = 'const bot = new TelegramBot(config.telegramBotToken, { polling: { autoStart: false, params: { allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "callback_query"] } } });';
const source = `// Preserve the rest of the live bot.\n${constructor}\n// Leave unrelated handlers alone.\n`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function withFiles(run, contents = source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flixify-telegram-polling-patch-"));
  const sourcePath = path.join(directory, "live.mjs");
  const outputPath = path.join(directory, "patched.mjs");
  await writeFile(sourcePath, contents);
  try {
    await run({ sourcePath, outputPath, contents });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runPatch(sourcePath, outputPath, expectedSha256) {
  return spawnSync(process.execPath, [patchPath, sourcePath, outputPath, expectedSha256], { encoding: "utf8" });
}

test("verified live source enables callback updates and preserves all other bytes", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  assert.equal(patched, source.replace(constructor, replacement));
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  const bot = vm.runInNewContext(`${patched}\nbot`, {
    TelegramBot: function TelegramBot(_token, options) { return { options }; },
    config: { telegramBotToken: "fixture-only" }
  });
  assert.equal(JSON.stringify(bot.options.polling), JSON.stringify({
    autoStart: false,
    params: { allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "callback_query"] }
  }));
  assert.deepEqual(JSON.parse(result.stdout), { outputSha256: sha(patched) });
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-only|Preserve the rest/);
}));

test("source SHA mismatch refuses patch and leaves no output", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, "0".repeat(64));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256 mismatch/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  assert.equal(await readFile(sourcePath, "utf8"), source);
}));

test("changed or duplicate constructor anchors fail closed", async () => {
  for (const variant of [
    source.replace("polling: false", "polling: true"),
    `${source}\n${constructor}\n`
  ]) {
    await withFiles(async ({ sourcePath, outputPath }) => {
      const result = runPatch(sourcePath, outputPath, sha(variant));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /exactly one.*anchor/i);
      await assert.rejects(readFile(outputPath), { code: "ENOENT" });
    }, variant);
  }
});

test("source and output must differ", () => withFiles(async ({ sourcePath }) => {
  const result = runPatch(sourcePath, sourcePath, sha(source));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /paths must differ/i);
  assert.equal(await readFile(sourcePath, "utf8"), source);
}));

test("an existing output cannot be overwritten", () => withFiles(async ({ sourcePath, outputPath }) => {
  await writeFile(outputPath, "keep-existing-output");
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST/i);
  assert.equal(await readFile(outputPath, "utf8"), "keep-existing-output");
}));

test("CLI requires source, output, and a valid SHA256", () => withFiles(async ({ sourcePath, outputPath }) => {
  const incomplete = spawnSync(process.execPath, [patchPath, sourcePath, outputPath], { encoding: "utf8" });
  assert.equal(incomplete.status, 2);
  assert.match(incomplete.stderr, /Usage:/);
  const malformed = runPatch(sourcePath, outputPath, "incorrect-hash");
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /expected.*SHA256/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
}));
