import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

try {
  const source = await readFile(process.argv[2], 'utf8');
  const anchor = 'function createRegistrationNotifier(options) {';
  assert.equal(source.split(anchor).length, 2);
  const start = source.indexOf(anchor);
  const tail = source.slice(start);
  const end = tail.indexOf('\n}');
  assert.ok(end > 0);
  const factory = vm.runInNewContext('(' + tail.slice(0, end + 2) + ')', {}, { timeout: 1000 });
  const checks = [];
  let clock = Date.parse('2026-11-07T00:00:00Z');
  let stored = null;
  let users = [];
  const sent = [];
  const failingAdmins = new Set();
  let durableBeforeSend = false;
  const dependencies = {
    load: async () => stored && structuredClone(stored),
    save: async state => { stored = structuredClone(state); },
    listUsers: async () => ({ items: structuredClone(users), total: users.length }),
    getAdminIds: () => ['synthetic-admin-a', 'synthetic-admin-b'],
    deliver: async (userId, adminId) => {
      durableBeforeSend = stored.entries.some(row => row.userId === userId);
      assert.ok(durableBeforeSend);
      if (failingAdmins.has(adminId)) throw new Error('synthetic-delivery-failure');
      sent.push({ userId, adminId });
    },
    now: () => clock,
    onError: () => {}
  };
  const notifier = factory(dependencies);
  await notifier.poll();
  assert.equal(sent.length, 0);
  clock += 20_000;
  users = [{ id: 'synthetic-registered-user', createdAt: new Date(clock - 1000).toISOString(),
    status: 'active', m3uAssigned: true }];
  await notifier.poll();
  assert.equal(sent.length, 2);
  checks.push('active-assigned-registration', 'durable-discovery');
  assert.equal(stored.entries[0].acknowledgedAdminIds.length, 2);
  checks.push('acknowledged-delivery');
  await factory(dependencies).poll();
  assert.equal(sent.length, 2);
  checks.push('restart-no-duplicate');
  clock += 20_000;
  users.unshift({ id: 'synthetic-retry-user', createdAt: new Date(clock - 1000).toISOString(),
    status: 'active', m3uAssigned: true });
  failingAdmins.add('synthetic-admin-b');
  await notifier.poll();
  assert.equal(sent.length, 3);
  failingAdmins.clear();
  await notifier.poll();
  assert.equal(sent.length, 4);
  assert.equal(sent.filter(row => row.userId === 'synthetic-retry-user' && row.adminId === 'synthetic-admin-a').length, 1);
  checks.push('failed-delivery-retry');
  console.log(JSON.stringify({ passed: true, checks }));
} catch {
  console.log(JSON.stringify({ passed: false, code: 'isolated-registration-probe-failed' }));
  process.exitCode = 1;
}
