import assert from "node:assert/strict";
import test from "node:test";
import { createRegistrationNotifier } from "./telegram-registration-core.mjs";

const START = Date.parse("2026-11-07T08:00:00.000Z");
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const row = (id, at) => ({ id, createdAt: new Date(at).toISOString(), status: "active", m3uAssigned: true });

function fixture(options = {}) {
  let clock = START;
  let stored = null;
  let users = [row("historical", START - 86_400_000)];
  let admins = ["1"];
  let failAdmin = null;
  let failSave = false;
  const sent = [];
  const saves = [];
  const requests = [];
  const errors = [];
  const dependencies = {
    now: () => clock,
    load: async () => copy(stored),
    save: async (state) => {
      if (failSave) throw new Error("synthetic persistence failure");
      stored = copy(state); saves.push(copy(state));
    },
    getAdminIds: () => admins,
    listUsers: async (page, pageSize) => {
      requests.push({ page, pageSize });
      const sorted = [...users].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return { items: sorted.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: sorted.length };
    },
    deliver: async (userId, adminId) => {
      sent.push({ userId, adminId });
      if (adminId === failAdmin) throw new Error("synthetic network failure");
    },
    onError: (event) => errors.push(event),
    ...options
  };
  return {
    dependencies, sent, saves, requests, errors,
    notifier: createRegistrationNotifier(dependencies),
    restart: () => createRegistrationNotifier(dependencies),
    state: () => copy(stored),
    setState: value => { stored = copy(value); },
    setUsers: value => { users = value; },
    setClock: value => { clock = value; },
    setAdmins: value => { admins = value; },
    failAdmin: value => { failAdmin = value; },
    failSave: value => { failSave = value; }
  };
}

test("first deployment persists a cutoff and never sends historical accounts", async () => {
  const f = fixture();
  const result = await f.notifier.poll();
  assert.equal(result.status, "ok");
  assert.equal(f.saves[0].cutoffAt, new Date(START).toISOString());
  assert.equal(f.sent.length, 0);
  assert.equal(f.requests.length, 1);
});

test("active assigned accounts are discovered from the independent unfiltered feed", async () => {
  const f = fixture(); await f.notifier.poll();
  f.setClock(START + 20_000); f.setUsers([row("fast-trial", START + 1000)]);
  await f.notifier.poll();
  assert.deepEqual(f.sent, [{ userId: "fast-trial", adminId: "1" }]);
  await f.notifier.poll();
  assert.equal(f.sent.length, 1);
});

test("equal timestamps across several pages all deliver once, including a later visible tie", async () => {
  const f = fixture({ pageSize: 2 }); await f.notifier.poll();
  f.setClock(START + 30_000);
  f.setUsers(["a", "b", "c", "d", "e"].map(id => row(id, START + 1000)));
  await f.notifier.poll();
  assert.equal(new Set(f.sent.map(x => x.userId)).size, 5);
  f.setUsers(["a", "b", "c", "d", "e", "late-tie"].map(id => row(id, START + 1000)));
  await f.notifier.poll();
  assert.equal(f.sent.length, 6);
  assert.equal(f.sent.at(-1).userId, "late-tie");
});

test("per-admin acknowledgements survive restart and failed delivery holds the checkpoint", async () => {
  const f = fixture(); await f.notifier.poll();
  const originalCheckpoint = f.state().checkpointAt;
  f.setAdmins(["1", "2"]); f.failAdmin("2");
  f.setClock(START + 20_000); f.setUsers([row("new", START + 1000)]);
  const failed = await f.notifier.poll();
  assert.equal(failed.status, "delivery-pending");
  assert.equal(f.state().checkpointAt, originalCheckpoint);
  assert.deepEqual(f.state().entries[0].acknowledgedAdminIds, ["1"]);
  f.failAdmin(null);
  await f.restart().poll();
  assert.deepEqual(f.sent.map(x => x.adminId), ["1", "2", "2"]);
  assert.equal(f.state().checkpointAt, new Date(START + 20_000).toISOString());
});

test("outbox is persisted before the first delivery", async () => {
  let f;
  f = fixture({ deliver: async (userId, adminId) => {
    const entry = f.state().entries.find(x => x.userId === userId);
    assert.ok(entry); assert.ok(entry.adminIds.includes(adminId));
  } });
  await f.notifier.poll(); f.setClock(START + 20_000); f.setUsers([row("new", START + 1000)]);
  await f.notifier.poll();
});

test("bootstrap and discovery persistence failures cannot send or advance state", async () => {
  const f = fixture(); f.failSave(true);
  await assert.rejects(f.notifier.poll(), /synthetic persistence/);
  assert.equal(f.requests.length, 0); assert.equal(f.sent.length, 0);
  f.failSave(false); await f.notifier.poll();
  f.setClock(START + 20_000); f.setUsers([row("new", START + 1000)]); f.failSave(true);
  await assert.rejects(f.notifier.poll(), /synthetic persistence/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.state().checkpointAt, new Date(START).toISOString());
});

test("no administrators cannot silently consume registrations", async () => {
  const f = fixture(); await f.notifier.poll(); f.setAdmins([]);
  f.setClock(START + 20_000); f.setUsers([row("new", START + 1000)]);
  assert.equal((await f.notifier.poll()).status, "no-admins");
  assert.equal(f.state().checkpointAt, new Date(START).toISOString());
  f.setAdmins(["1"]); await f.notifier.poll(); assert.equal(f.sent.length, 1);
});

test("a later-page fetch failure preserves the checkpoint and sends no partial discovery", async () => {
  const f = fixture({ pageSize: 1 }); await f.notifier.poll();
  f.setClock(START + 20_000);
  const notifier = createRegistrationNotifier({ ...f.dependencies, listUsers: async page => {
    if (page === 2) throw new Error("synthetic API timeout");
    return { items: [row("new", START + 1000)], total: 2 };
  } });
  await assert.rejects(notifier.poll(), /synthetic API timeout/);
  assert.equal(f.sent.length, 0); assert.equal(f.state().entries.length, 0);
});

test("page and state bounds fail closed without losing an existing outbox", async () => {
  const f = fixture({ pageSize: 1, maxPages: 2, maxEntries: 2 }); await f.notifier.poll();
  f.setClock(START + 20_000); f.setUsers(["a", "b", "c"].map(id => row(id, START + 1000)));
  await assert.rejects(f.notifier.poll(), /registration_scan_limit/);
  assert.equal(f.sent.length, 0); assert.equal(f.state().entries.length, 0);
});

test("invalid timestamps, duplicate divergent rows and corrupt persisted state fail closed", async () => {
  for (const users of [
    [{ id: "bad", createdAt: "not-a-date" }],
    [row("same", START + 1000), row("same", START + 2000)]
  ]) {
    const f = fixture(); await f.notifier.poll(); f.setUsers(users);
    await assert.rejects(f.notifier.poll(), /registration_(row|duplicate)_invalid/);
    assert.equal(f.sent.length, 0);
  }
  const f = fixture(); f.setState({ version: 999 });
  await assert.rejects(f.notifier.poll(), /registration_state_invalid/);
  assert.equal(f.saves.length, 0);
});

test("successful entries are pruned beyond overlap while failed entries remain durable", async () => {
  const f = fixture({ overlapMs: 120_000 }); await f.notifier.poll();
  f.setClock(START + 20_000); f.setUsers([row("new", START + 1000)]); await f.notifier.poll();
  assert.equal(f.state().entries.length, 1);
  f.setClock(START + 180_000); await f.notifier.poll();
  assert.equal(f.state().entries.length, 0);
  assert.equal(f.sent.length, 1);
});

test("overlapping ticks never send concurrent or duplicate batches", async () => {
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const f = fixture({ listUsers: async () => { await gate; return { items: [], total: 0 }; } });
  const first = f.notifier.poll();
  assert.equal((await f.notifier.poll()).status, "busy");
  unblock(); await first;
});
