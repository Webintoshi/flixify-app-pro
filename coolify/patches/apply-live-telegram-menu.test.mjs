import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { transformLiveTelegramMenuSource, applyLiveTelegramMenuPatch } from "./apply-live-telegram-menu.mjs";

const liveFragment = `// Keep the richer live bot and its unrelated configuration intact.
bot.on("message", async (msg) => {
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text || text.startsWith("/")) return;
  if (!isAdmin(msg.chat.id)) return;
  const normalized = text.toLowerCase().trim();
  if (text === "👥Kullanici Yonetimi" || text === "Kayitli Kullanicilar" || normalized.includes("kullanici") || normalized === "uyeler" || normalized === "users" || normalized === "liste") {
    await showUserManagementMenu(msg.chat.id);
    return;
  }
  if (text === "🔍Kullanici Ara / Paket" || text === "Ara" || text === "Numara ile Ara" || normalized === "ara" || normalized === "arama" || normalized === "bul") {
    await promptUserSearch(msg.chat.id);
    return;
  }
  await handleUserSearchInput(msg.chat.id, text);
});
// End of the live message handler.
`;

async function dispatch(source, text, admin = true) {
  const actions = [];
  let messageHandler;
  vm.runInNewContext(source, {
    bot: { on: (_event, handler) => { messageHandler = handler; } },
    isAdmin: () => admin,
    showUserManagementMenu: async () => { actions.push("management"); },
    promptUserSearch: async () => { actions.push("search"); },
    handleUserSearchInput: async (_chat, query) => { actions.push(`query:${query}`); }
  });
  await messageHandler({ chat: { id: 1 }, text });
  return actions;
}

test("search reply-keyboard reaches the existing search prompt", async () => {
  assert.deepEqual(await dispatch(transformLiveTelegramMenuSource(liveFragment), "🔍Kullanici Ara / Paket"), ["search"]);
});

test("the Turkish live condition also routes search to the existing prompt", async () => {
  const source = liveFragment.replaceAll("kullanici", "kullanıcı").replaceAll("Kullanici", "Kullanıcı");
  assert.deepEqual(await dispatch(source, "🔍Kullanıcı Ara / Paket"), ["management"]);
  let patched;
  assert.doesNotThrow(() => { patched = transformLiveTelegramMenuSource(source); });
  assert.deepEqual(await dispatch(patched, "🔍Kullanıcı Ara / Paket"), ["search"]);
  assert.deepEqual(await dispatch(patched, "kullanıcı@example.test"), ["query:kullanıcı@example.test"]);
});

test("management reply-keyboard and existing aliases remain available", async () => {
  const patched = transformLiveTelegramMenuSource(liveFragment);
  for (const text of ["👥Kullanici Yonetimi", "Kayitli Kullanicilar", "kullanici", "kullanıcı", "uyeler", "users", "liste"]) {
    assert.deepEqual(await dispatch(patched, text), ["management"], text);
  }
});

test("search session free text containing kullanici is not intercepted", async () => {
  assert.deepEqual(await dispatch(transformLiveTelegramMenuSource(liveFragment), "kullanici@example.test"), ["query:kullanici@example.test"]);
});

test("existing search aliases and authorization gate stay unchanged", async () => {
  const patched = transformLiveTelegramMenuSource(liveFragment);
  for (const text of ["Ara", "Numara ile Ara", "arama", "bul"]) {
    assert.deepEqual(await dispatch(patched, text), ["search"], text);
  }
  assert.deepEqual(await dispatch(patched, "👥Kullanici Yonetimi", false), []);
  assert.deepEqual(await dispatch(patched, "/start"), []);
});

test("only the one confirmed condition changes, including CRLF preservation", () => {
  for (const alias of ["kullanici", "kullanıcı"]) {
    const variant = liveFragment.replace('normalized.includes("kullanici")', `normalized.includes("${alias}")`);
    for (const source of [variant, variant.replaceAll("\n", "\r\n")]) {
      const patched = transformLiveTelegramMenuSource(source);
      assert.equal(patched.replace('(normalized === "kullanici" || normalized === "kullanıcı")', `normalized.includes("${alias}")`), source);
    }
  }
});

test("changed and duplicate source anchors fail closed", () => {
  assert.throws(() => transformLiveTelegramMenuSource(liveFragment.replace('normalized.includes("kullanici")', 'normalized.includes("users")')), /exactly one.*anchor/i);
  assert.throws(() => transformLiveTelegramMenuSource(liveFragment + liveFragment), /exactly one.*anchor/i);
});

const sha = (source) => createHash("sha256").update(source).digest("hex");
async function withFiles(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flixify-telegram-menu-patch-"));
  const sourcePath = path.join(directory, "live.mjs");
  const outputPath = path.join(directory, "patched.mjs");
  await writeFile(sourcePath, liveFragment);
  try { await run({ directory, sourcePath, outputPath }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("explicit source hash is required and a mismatch cannot create output", () => withFiles(async ({ sourcePath, outputPath }) => {
  await assert.rejects(applyLiveTelegramMenuPatch({ sourcePath, outputPath }), /expected.*SHA256/i);
  await assert.rejects(applyLiveTelegramMenuPatch({ sourcePath, outputPath, expectedSha256: "0".repeat(64) }), /SHA256 mismatch/i);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  assert.equal(await readFile(sourcePath, "utf8"), liveFragment);
}));

test("source cannot be overwritten in place", () => withFiles(async ({ sourcePath }) => {
  await assert.rejects(applyLiveTelegramMenuPatch({ sourcePath, outputPath: sourcePath, expectedSha256: sha(liveFragment) }), /paths must differ/i);
  assert.equal(await readFile(sourcePath, "utf8"), liveFragment);
}));

test("existing output cannot be overwritten", () => withFiles(async ({ sourcePath, outputPath }) => {
  await writeFile(outputPath, "keep-existing-output");
  await assert.rejects(applyLiveTelegramMenuPatch({ sourcePath, outputPath, expectedSha256: sha(liveFragment) }), { code: "EEXIST" });
  assert.equal(await readFile(outputPath, "utf8"), "keep-existing-output");
}));

test("verified file patch is private, leaves source intact, and reports output hash", () => withFiles(async ({ sourcePath, outputPath }) => {
  const result = await applyLiveTelegramMenuPatch({ sourcePath, outputPath, expectedSha256: sha(liveFragment) });
  const patched = await readFile(outputPath, "utf8");
  assert.equal(await readFile(sourcePath, "utf8"), liveFragment);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.equal(result.outputSha256, sha(patched));
  assert.deepEqual(await dispatch(patched, "🔍Kullanici Ara / Paket"), ["search"]);
}));

test("CLI requires source, different output, and explicit expected hash", () => withFiles(async ({ sourcePath, outputPath }) => {
  const cliPath = new URL("./apply-live-telegram-menu.mjs", import.meta.url);
  const incomplete = spawnSync(process.execPath, [cliPath.pathname, sourcePath, outputPath], { encoding: "utf8" });
  assert.equal(incomplete.status, 2);
  assert.match(incomplete.stderr, /Usage:/);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  const valid = spawnSync(process.execPath, [cliPath.pathname, sourcePath, outputPath, sha(liveFragment)], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /outputSha256/);
  assert.doesNotMatch(valid.stdout, /Keep the richer live bot/);
}));
