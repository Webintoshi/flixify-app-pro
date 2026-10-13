import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const patchPath = new URL("./apply-live-telegram-assignment-safety.mjs", import.meta.url).pathname;
const lookupAnchor = "return items.find((l) => String(l.username).trim().toLowerCase() === String(username).trim().toLowerCase()) || items[0] || null;";
const lookupReplacement = "return items.find((l) => String(l.username).trim().toLowerCase() === String(username).trim().toLowerCase()) || null;";
const fakeSuccessAnchor = `return {
      id: detail.iptvUsername || requestedCredentials.username,
      username: requestedCredentials.username,
      password: requestedCredentials.password,
      exp_date: null
    };`;
const failureReplacement = 'throw new Error("Mevcut hat bulunamadı.");';
const createReturnAnchor = "return normalizePanelLine(rawResult, requestedCredentials);";
const renewStartAnchor = "if (existingLine?.id) {";
const renewStartReplacement = `if (existingLine?.id) {
      if (String(existingLine.password ?? "") !== String(requestedCredentials.password)) {
        throw new Error("Mevcut hat şifresi uyuşmuyor.");
      }`;
const verifiedCreateReplacement = `const isValidResellerId = (id) =>
    (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
    (typeof id === "string" && id.trim() !== "" && id.trim() !== "-" && id.trim() !== "0");
  const usernameMatches = (line) =>
    String(line?.username ?? "").trim().toLowerCase() === String(requestedCredentials.username).trim().toLowerCase();
  if (isValidResellerId(rawResult?.id) && usernameMatches(rawResult) &&
      String(rawResult?.password ?? "") === String(requestedCredentials.password)) {
    return normalizePanelLine(rawResult, requestedCredentials);
  }
  const verifiedLine = await findResellerLine(requestedCredentials.username);
  if (!isValidResellerId(verifiedLine?.id) || !usernameMatches(verifiedLine) ||
      String(verifiedLine?.password ?? "") !== String(requestedCredentials.password)) {
    throw new Error("Yeni hat doğrulanamadı.");
  }
  return normalizePanelLine(verifiedLine, requestedCredentials);`;
const source = `// Provider search can return another subscriber's line.
async function findResellerLine(username) {
  const items = await searchProvider(username);
  ${lookupAnchor}
}
async function createOrRenewPanelLine(detail, requestedCredentials, packageConfig) {
  const lineAlreadyExists = detail.lineAlreadyExists === true;
  if (lineAlreadyExists) {
    const existingLine = await findResellerLine(requestedCredentials.username);
    if (existingLine?.id) {
      const extended = await extendPanelLine(existingLine.id, packageConfig);
      return normalizePanelLine(extended?.data || extended, requestedCredentials);
    }
    ${fakeSuccessAnchor}
  }
  const rawResult = detail.rawResult;
  ${createReturnAnchor}
}
// Unrelated live bot logic remains byte-for-byte intact.
`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function withFiles(run, contents = source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flixify-assignment-safety-"));
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

function loadFunctions(patched, items, onExtend = async () => ({}), onSearch = async () => items) {
  return vm.runInNewContext(`${patched}\n({ findResellerLine, createOrRenewPanelLine })`, {
    searchProvider: onSearch,
    extendPanelLine: onExtend,
    normalizePanelLine: (line) => line
  });
}

test("broad provider search cannot renew a different subscriber's line", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  assert.equal(patched, source
    .replace(lookupAnchor, lookupReplacement)
    .replace(renewStartAnchor, renewStartReplacement)
    .replace(fakeSuccessAnchor, failureReplacement)
    .replace(createReturnAnchor, verifiedCreateReplacement));
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  const functions = loadFunctions(patched, [{ id: "wrong-line", username: "another-person" }], async () => {
    throw new Error("A wrong line was renewed.");
  });
  assert.equal(await functions.findResellerLine("requested-person"), null);
  await assert.rejects(
    () => functions.createOrRenewPanelLine({ lineAlreadyExists: true }, { username: "requested-person", password: "fixture" }, {}),
    /Mevcut hat bulunamadı/i
  );
  assert.deepEqual(JSON.parse(result.stdout), { outputSha256: sha(patched) });
  assert.doesNotMatch(result.stdout + result.stderr, /another-person|requested-person|fixture/);
}));

test("exact case-insensitive username match still renews the correct line", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  const functions = loadFunctions(patched, [
    { id: "wrong-line", username: "another-person" },
    { id: "correct-line", username: "  REQUESTED-PERSON  ", password: "fixture" }
  ], async (id) => {
    assert.equal(id, "correct-line");
    return { data: { id, status: "renewed" } };
  });
  const resultLine = await functions.createOrRenewPanelLine({ lineAlreadyExists: true }, { username: "requested-person", password: "fixture" }, {});
  assert.equal(resultLine.id, "correct-line");
  assert.equal(resultLine.status, "renewed");
}));

test("existing line with a different password is not renewed", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  const functions = loadFunctions(patched, [
    { id: "matching-line", username: "requested-person", password: "someone-elses-password" }
  ], async () => { throw new Error("Wrong credentials were renewed."); });
  await assert.rejects(
    () => functions.createOrRenewPanelLine({ lineAlreadyExists: true }, { username: "requested-person", password: "fixture" }, {}),
    /Mevcut hat şifresi uyuşmuyor/i
  );
}));

test("empty new-line response requires exact provider confirmation", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  const functions = loadFunctions(patched, [{ id: "wrong-line", username: "another-person", password: "fixture" }]);
  await assert.rejects(
    () => functions.createOrRenewPanelLine({ rawResult: {} }, { username: "requested-person", password: "fixture" }, {}),
    /Yeni hat doğrulanamadı/i
  );
}));

test("verified create result or exact provider confirmation is accepted", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(outputPath, "utf8");
  const functions = loadFunctions(patched, [
    { id: "wrong-line", username: "another-person", password: "fixture" },
    { id: "confirmed-line", username: "requested-person", password: "fixture" }
  ]);
  const line = await functions.createOrRenewPanelLine(
    { rawResult: { id: "-", username: "requested-person" } },
    { username: "requested-person", password: "fixture" },
    {}
  );
  assert.equal(line.id, "confirmed-line");
  const directFunctions = loadFunctions(patched, [], undefined, async () => { throw new Error("Unexpected provider lookup."); });
  const directLine = await directFunctions.createOrRenewPanelLine(
    { rawResult: { id: "new-line", username: "REQUESTED-PERSON", password: "fixture" } },
    { username: "requested-person", password: "fixture" },
    {}
  );
  assert.equal(directLine.id, "new-line");
}));

test("raw create result with wrong or missing password requires exact provider confirmation", async () => {
  for (const rawResult of [
    { id: "raw-line", username: "requested-person", password: "wrong-password" },
    { id: "raw-line", username: "requested-person" }
  ]) {
    await withFiles(async ({ sourcePath, outputPath }) => {
      const result = runPatch(sourcePath, outputPath, sha(source));
      assert.equal(result.status, 0, result.stderr);
      const patched = await readFile(outputPath, "utf8");
      const missingLineFunctions = loadFunctions(patched, [{ id: "wrong-line", username: "another-person", password: "fixture" }]);
      await assert.rejects(
        () => missingLineFunctions.createOrRenewPanelLine({ rawResult }, { username: "requested-person", password: "fixture" }, {}),
        /Yeni hat doğrulanamadı/i
      );
      const confirmedFunctions = loadFunctions(patched, [{ id: "confirmed-line", username: "requested-person", password: "fixture" }]);
      const line = await confirmedFunctions.createOrRenewPanelLine(
        { rawResult }, { username: "requested-person", password: "fixture" }, {}
      );
      assert.equal(line.id, "confirmed-line");
    });
  }
});

test("provider confirmation without a real id or matching password fails", async () => {
  for (const providerLine of [
    { username: "requested-person", password: "fixture" },
    { id: "confirmed-line", username: "requested-person", password: "wrong-password" }
  ]) {
    await withFiles(async ({ sourcePath, outputPath }) => {
      const result = runPatch(sourcePath, outputPath, sha(source));
      assert.equal(result.status, 0, result.stderr);
      const patched = await readFile(outputPath, "utf8");
      const functions = loadFunctions(patched, [providerLine]);
      await assert.rejects(
        () => functions.createOrRenewPanelLine({ rawResult: null }, { username: "requested-person", password: "fixture" }, {}),
        /Yeni hat doğrulanamadı/i
      );
    });
  }
});

test("different fallback indentation and CRLF remain patchable without changing other lines", () => {
  const variantReturn = `return {
\t\t\tid: detail.iptvUsername || requestedCredentials.username,
\t\t\tusername: requestedCredentials.username,
\t\t\tpassword: requestedCredentials.password,
\t\t\texp_date: null
\t\t};`;
  const variant = source.replace(fakeSuccessAnchor, variantReturn).replaceAll("\n", "\r\n");
  return withFiles(async ({ sourcePath, outputPath }) => {
    const result = runPatch(sourcePath, outputPath, sha(variant));
    assert.equal(result.status, 0, result.stderr);
    const patched = await readFile(outputPath, "utf8");
    assert.equal(await readFile(sourcePath, "utf8"), variant);
    assert.doesNotMatch(patched, /(?<!\r)\n/);
    assert.match(patched, /\/\/ Unrelated live bot logic remains byte-for-byte intact\.\r\n$/);
    const functions = loadFunctions(patched, [{ id: "wrong-line", username: "another-person" }]);
    await assert.rejects(
      () => functions.createOrRenewPanelLine({ lineAlreadyExists: true }, { username: "requested-person", password: "fixture" }, {}),
      /Mevcut hat bulunamadı/i
    );
  }, variant);
});

test("fallback-shaped text outside the assignment branch remains untouched", () => {
  const appendix = `\n/*\n${fakeSuccessAnchor}\n*/\n`;
  const variant = source + appendix;
  return withFiles(async ({ sourcePath, outputPath }) => {
    const result = runPatch(sourcePath, outputPath, sha(variant));
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await readFile(outputPath, "utf8")).endsWith(appendix));
  }, variant);
});

test("source SHA mismatch refuses patch without creating output", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = runPatch(sourcePath, outputPath, "0".repeat(64));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256 mismatch/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  assert.equal(await readFile(sourcePath, "utf8"), source);
}));

test("missing or duplicate exact anchors fail closed", async () => {
  const variants = [
    source.replace(lookupAnchor, "return items[0] || null;"),
    source.replace(fakeSuccessAnchor, "return null;"),
    `${source}\n${lookupAnchor}\n`,
    source.replace(fakeSuccessAnchor, `${fakeSuccessAnchor}\n    ${fakeSuccessAnchor}`)
  ];
  for (const variant of variants) {
    await withFiles(async ({ sourcePath, outputPath }) => {
      const result = runPatch(sourcePath, outputPath, sha(variant));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /exactly one.*anchor/i);
      await assert.rejects(readFile(outputPath), { code: "ENOENT" });
    }, variant);
  }
});

test("source path cannot be used as output", () => withFiles(async ({ sourcePath }) => {
  const result = runPatch(sourcePath, sourcePath, sha(source));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /paths must differ/i);
  assert.equal(await readFile(sourcePath, "utf8"), source);
}));

test("existing output is never overwritten", () => withFiles(async ({ sourcePath, outputPath }) => {
  await writeFile(outputPath, "keep-existing-output");
  const result = runPatch(sourcePath, outputPath, sha(source));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST/i);
  assert.equal(await readFile(outputPath, "utf8"), "keep-existing-output");
}));

test("CLI requires explicit source, output, and SHA256", () => withFiles(async ({ sourcePath, outputPath }) => {
  const incomplete = spawnSync(process.execPath, [patchPath, sourcePath, outputPath], { encoding: "utf8" });
  assert.equal(incomplete.status, 2);
  assert.match(incomplete.stderr, /Usage:/);
  const malformed = runPatch(sourcePath, outputPath, "bad-sha");
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /expected.*SHA256/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
}));
