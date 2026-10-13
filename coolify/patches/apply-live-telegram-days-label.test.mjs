import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const patchPath = new URL("./apply-live-telegram-days-label.mjs", import.meta.url).pathname;
const anchor = 'const days = Number.isFinite(Number(item.remainingDays)) ? `${item.remainingDays} gün` : (item.m3uAssigned ? "Aktif" : "Bekliyor");';
const replacement = 'const days = item.remainingDays != null && Number.isFinite(Number(item.remainingDays)) ? `${item.remainingDays} gün` : (item.m3uAssigned ? "Aktif" : "Bekliyor");';
const source = `// Other live bot code remains untouched.\r\nfunction daysLabel(item) {\r\n  ${anchor}\r\n  return days;\r\n}\r\n`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function withFiles(run, contents = source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flixify-telegram-days-"));
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

test("assigned null days shows Aktif; zero and positive day counts remain numeric", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  assert.equal(patched, source.replace(anchor, replacement));
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(patched, /(?<!\r)\n/);
  const label = vm.runInNewContext(`${patched}\ndaysLabel`);
  for (const [item, expected] of [
    [{ remainingDays: null, m3uAssigned: true }, "Aktif"],
    [{ remainingDays: null, m3uAssigned: false }, "Bekliyor"],
    [{ m3uAssigned: true }, "Aktif"],
    [{ m3uAssigned: false }, "Bekliyor"],
    [{ remainingDays: 0, m3uAssigned: true }, "0 gün"],
    [{ remainingDays: 5, m3uAssigned: true }, "5 gün"]
  ]) {
    assert.equal(label(item), expected);
  }
  assert.deepEqual(JSON.parse(result.stdout), { outputSha256: sha(patched) });
  assert.doesNotMatch(result.stdout + result.stderr, /Other live bot code/);
}));

test("wrong source SHA refuses patch and leaves source intact", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, "0".repeat(64));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256 mismatch/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  assert.equal(await readFile(sourcePath, "utf8"), source);
}));

test("missing or duplicate days anchor fails closed", async () => {
  for (const variant of [source.replace(anchor, "const days = \"other\";"), `${source}\r\n${anchor}\r\n`]) {
    await withFiles(async ({ sourcePath, outputPath }) => {
      const result = runPatch(sourcePath, outputPath, sha(variant));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /exactly one.*anchor/i);
      await assert.rejects(readFile(outputPath), { code: "ENOENT" });
    }, variant);
  }
});

test("source cannot be overwritten and existing output cannot be replaced", () => withFiles(async ({ sourcePath, outputPath }) => {
  const samePath = runPatch(sourcePath, sourcePath, sha(source));
  assert.equal(samePath.status, 1);
  assert.match(samePath.stderr, /paths must differ/i);
  await writeFile(outputPath, "keep-existing-output");
  const existing = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /EEXIST/i);
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal(await readFile(outputPath, "utf8"), "keep-existing-output");
}));

test("CLI requires an explicit valid SHA256", () => withFiles(async ({ sourcePath, outputPath }) => {
  const incomplete = spawnSync(process.execPath, [patchPath, sourcePath, outputPath], { encoding: "utf8" });
  assert.equal(incomplete.status, 2);
  assert.match(incomplete.stderr, /Usage:/);
  const malformed = runPatch(sourcePath, outputPath, "not-a-hash");
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /expected.*SHA256/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
}));
