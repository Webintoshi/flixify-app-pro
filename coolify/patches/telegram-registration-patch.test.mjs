import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { transformTelegramRegistrationSource, applyTelegramRegistrationPatch } from "./telegram-registration-patch.mjs";

const poll = await fs.readFile(new URL("./telegram-registration-live-poll.fixture.txt", import.meta.url), "utf8");
const sha = value => createHash("sha256").update(value).digest("hex");
const fixture = `// Unrelated management handlers remain byte-identical.\n${poll}\n\nasync function startNotifier() { return "unchanged-startup"; }\n`;

test("verified patch preserves every byte outside the audited poll and retains management function", () => {
  const patched = transformTelegramRegistrationSource(fixture, sha(fixture));
  assert.ok(patched.startsWith("// Unrelated management handlers remain byte-identical.\n"));
  assert.ok(patched.endsWith('\n\nasync function startNotifier() { return "unchanged-startup"; }\n'));
  assert.equal(patched.match(/async function pollNewUsers\(/g).length, 1);
  assert.ok(patched.includes("      Promise.resolve([]),\n      listPendingPaymentRequests(),"));
  assert.ok(patched.includes("query: { page, pageSize }"));
  assert.ok(patched.includes("await registrationNotifier.poll();"));
  assert.equal(spawnSync(process.execPath, ["--check", "--input-type=module"], { input: patched }).status, 0);
});

test("source hash, audited poll hash, duplicate anchors and repeat patching fail closed", () => {
  assert.throws(() => transformTelegramRegistrationSource(fixture, "0".repeat(64)), /source_hash_mismatch/);
  const drift = fixture.replace('status: "running", seedOnly: true', 'status: "changed", seedOnly: true');
  assert.throws(() => transformTelegramRegistrationSource(drift, sha(drift)), /poll_body_changed/);
  const duplicate = fixture + "\n" + poll;
  assert.throws(() => transformTelegramRegistrationSource(duplicate, sha(duplicate)), /poll_anchor_invalid/);
  const patched = transformTelegramRegistrationSource(fixture, sha(fixture));
  assert.throws(() => transformTelegramRegistrationSource(patched, sha(patched)), /already_patched/);
});

test("patch output is exclusive0600 and cannot overwrite the source or an existing candidate", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flixify-registration-patch-"));
  try {
    const sourcePath = path.join(dir, "source.mjs"); const outputPath = path.join(dir, "candidate.mjs");
    await fs.writeFile(sourcePath, fixture);
    const result = await applyTelegramRegistrationPatch({ sourcePath, outputPath, expectedSha256: sha(fixture) });
    assert.equal(result.outputSha256, sha(await fs.readFile(outputPath)));
    assert.equal((await fs.stat(outputPath)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(sourcePath, "utf8"), fixture);
    await assert.rejects(applyTelegramRegistrationPatch({ sourcePath, outputPath: sourcePath, expectedSha256: sha(fixture) }), /source_output_must_differ/);
    await assert.rejects(applyTelegramRegistrationPatch({ sourcePath, outputPath, expectedSha256: sha(fixture) }), { code: "EEXIST" });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

async function integration(run, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flixify-registration-integration-"));
  const counters = { pending: 0, payment: 0, trial: 0, legacySave: 0, detail: 0, sends: [], errors: [] };
  let clock = Date.parse("2026-11-07T09:00:00.000Z"); let users = [];
  class ClockDate extends Date { static now() { return clock; } }
  const context = vm.createContext({
    fs, path, Buffer, process: { pid: process.pid }, Date: ClockDate,
    config: { stateFilePath: path.join(dir, "legacy.json"), telegramAdminIds: new Set(["1"]) },
    notifierTickInFlight: false,
    notifierState: { bootstrapped: true, knownPendingUserIds: ["old-pending"], knownPendingPaymentRequestIds: [], knownPendingTrialRequestIds: [] },
    listAllPendingUsers: async () => { counters.pending++; return []; },
    listPendingPaymentRequests: async () => { counters.payment++; return []; },
    listPendingTrialRequests: async () => { counters.trial++; return []; },
    flixifyRequest: async (route, options) => {
      assert.equal(route, "/admin/users"); assert.deepEqual(Object.keys(options.query).sort(), ["page", "pageSize"]);
      assert.equal(options.query.pageSize, 100);
      return { items: users, total: users.length };
    },
    getUserDetail: async id => { counters.detail++; return { id }; },
    renderUserCardText: detail => `synthetic user ${detail.id}`,
    buildUserCardKeyboard: id => ({ inline_keyboard: [[{ text: "synthetic card", callback_data: `user:${id}` }]] }),
    bot: { sendMessage: async (adminId, text, options) => { counters.sends.push({ adminId, text, options }); return { message_id: 1 }; } },
    console: { error: (...args) => counters.errors.push(args.join(" ")) },
    normalizeErrorMessage: () => "redacted",
    dedupeIds: values => [...new Set(values)], saveNotifierState: async () => { counters.legacySave++; },
    writeHeartbeat: async () => {}, notifyPaymentRequest: async () => {}, notifyTrialRequest: async () => {},
    ...overrides
  });
  vm.runInContext(transformTelegramRegistrationSource(fixture, sha(fixture)), context);
  try { await run({ context, counters, dir, setClock: value => { clock = value; }, setUsers: value => { users = value; } }); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("actual patched poll uses a separate durable journal and still runs payment and trial work", () => integration(async ({ context, counters, dir, setClock, setUsers }) => {
  await vm.runInContext("pollNewUsers()", context);
  assert.equal(counters.pending, 0); assert.equal(counters.payment, 1); assert.equal(counters.trial, 1);
  const cutoff = JSON.parse(await fs.readFile(path.join(dir, "legacy.json.registrations.json"), "utf8")).cutoffAt;
  setClock(Date.parse(cutoff) + 20_000);
  setUsers([{ id: "fast-active", createdAt: new Date(Date.parse(cutoff) + 1000).toISOString(), status: "active", m3uAssigned: true }]);
  await vm.runInContext("pollNewUsers()", context);
  assert.equal(counters.sends.length, 1); assert.equal(counters.detail, 1);
  assert.equal(counters.payment, 2); assert.equal(counters.trial, 2);
  const journal = JSON.parse(await fs.readFile(path.join(dir, "legacy.json.registrations.json"), "utf8"));
  assert.deepEqual(journal.entries[0].acknowledgedAdminIds, ["1"]);
  assert.deepEqual([...context.notifierState.knownPendingUserIds], ["old-pending"]);
  assert.equal((await fs.stat(path.join(dir, "legacy.json.registrations.json"))).mode & 0o777, 0o600);
  assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith(".tmp")), []);
}));

test("registration errors are generic and cannot stop existing payment and trial work", () => integration(async ({ context, counters }) => {
  await vm.runInContext("pollNewUsers()", context);
  assert.equal(counters.payment, 1); assert.equal(counters.trial, 1);
  assert.equal(counters.sends.length, 0);
  assert.ok(counters.errors.some(value => value.includes("registration notifier poll failed")));
  assert.ok(counters.errors.every(value => !value.includes("synthetic-private-upstream")));
}, { flixifyRequest: async () => { throw new Error("synthetic-private-upstream"); } }));

test("oversized or nonregular journals fail without parsing or sending and preserve old workflows", () => integration(async ({ context, counters, dir }) => {
  const journal = path.join(dir, "legacy.json.registrations.json");
  await fs.writeFile(journal, "x"); await fs.truncate(journal, 16 * 1024 * 1024 + 1);
  await vm.runInContext("pollNewUsers()", context);
  assert.equal(counters.sends.length, 0); assert.equal(counters.payment, 1); assert.equal(counters.trial, 1);
  assert.ok(counters.errors.length > 0);
}));
