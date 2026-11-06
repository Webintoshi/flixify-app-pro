export function createRegistrationNotifier(options) {
  const {
    load, save, listUsers, getAdminIds, deliver,
    now = Date.now, onError = () => {},
    pageSize = 100, maxPages = 200, maxEntries = 10_000, overlapMs = 120_000
  } = options;
  for (const dependency of [load, save, listUsers, getAdminIds, deliver, now, onError]) {
    if (typeof dependency !== "function") throw new Error("registration_dependency_invalid");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10_000 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000 ||
      !Number.isSafeInteger(overlapMs) || overlapMs < 1000 || overlapMs > 86_400_000) {
    throw new Error("registration_bounds_invalid");
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const time = value => typeof value === "string" && value.length <= 40 ? Date.parse(value) : NaN;
  const id = value => typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\s\u0000-\u001f\u007f]/.test(value);
  const ids = value => Array.isArray(value) && value.length <= 100 && value.every(id) && new Set(value).size === value.length;
  let state = null;
  let firstAttemptAt = null;
  let inFlight = false;

  function validate(candidate) {
    if (!candidate || candidate.version !== 1 || !Number.isFinite(time(candidate.cutoffAt)) ||
        !Number.isFinite(time(candidate.checkpointAt)) || time(candidate.checkpointAt) < time(candidate.cutoffAt) ||
        !Array.isArray(candidate.entries) || candidate.entries.length > maxEntries) {
      throw new Error("registration_state_invalid");
    }
    const seen = new Set();
    for (const entry of candidate.entries) {
      if (!entry || !id(entry.userId) || seen.has(entry.userId) || !Number.isFinite(time(entry.createdAt)) ||
          time(entry.createdAt) < time(candidate.cutoffAt) || !ids(entry.adminIds) || !entry.adminIds.length ||
          !ids(entry.acknowledgedAdminIds) || entry.acknowledgedAdminIds.some(value => !entry.adminIds.includes(value))) {
        throw new Error("registration_state_invalid");
      }
      seen.add(entry.userId);
    }
  }

  async function commit(next) {
    validate(next);
    const durable = clone(next);
    await save(durable);
    state = clone(durable);
  }

  async function initialize(startedAt) {
    if (state) return;
    const stored = await load();
    if (stored != null) {
      validate(stored);
      state = clone(stored);
      return;
    }
    firstAttemptAt ??= startedAt;
    const cutoff = new Date(firstAttemptAt).toISOString();
    await commit({ version: 1, cutoffAt: cutoff, checkpointAt: cutoff, entries: [] });
  }

  async function discover(lowerBound) {
    const found = new Map();
    let largestTotal = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await listUsers(page, pageSize);
      if (!response || !Array.isArray(response.items) || response.items.length > pageSize ||
          !Number.isSafeInteger(response.total) || response.total < response.items.length ||
          (response.items.length === 0 && response.total > (page - 1) * pageSize)) {
        throw new Error("registration_page_invalid");
      }
      largestTotal = Math.max(largestTotal, response.total);
      let older = false;
      for (const item of response.items) {
        if (!item || !id(item.id) || !Number.isFinite(time(item.createdAt))) {
          throw new Error("registration_row_invalid");
        }
        const timestamp = time(item.createdAt);
        if (timestamp < lowerBound) { older = true; continue; }
        const existing = found.get(item.id);
        const createdAt = new Date(timestamp).toISOString();
        if (existing && existing.createdAt !== createdAt) throw new Error("registration_duplicate_invalid");
        found.set(item.id, { userId: item.id, createdAt });
        if (found.size > maxEntries) throw new Error("registration_scan_limit");
      }
      // Complete the whole page, including every row at the boundary timestamp.
      if (older || response.items.length < pageSize || page * pageSize >= largestTotal) return [...found.values()];
    }
    throw new Error("registration_scan_limit");
  }

  async function poll() {
    if (inFlight) return { status: "busy" };
    inFlight = true;
    try {
      const startedAt = now();
      if (!Number.isFinite(startedAt)) throw new Error("registration_clock_invalid");
      await initialize(startedAt);
      if (startedAt < time(state.cutoffAt)) throw new Error("registration_clock_invalid");
      const adminIds = [...new Set([...getAdminIds()].map(String))];
      if (!ids(adminIds)) throw new Error("registration_administrators_invalid");
      if (!adminIds.length) return { status: "no-admins" };
      const activeAdmins = new Set(adminIds);
      const lowerBound = Math.max(time(state.cutoffAt), time(state.checkpointAt) - overlapMs);
      const discovered = await discover(lowerBound);
      const merged = new Map(state.entries.map(entry => [entry.userId, clone(entry)]));
      for (const item of discovered) {
        const existing = merged.get(item.userId);
        if (existing && existing.createdAt !== item.createdAt) throw new Error("registration_duplicate_invalid");
        if (!existing) merged.set(item.userId, { ...item, adminIds: [...adminIds], acknowledgedAdminIds: [] });
      }
      if (merged.size > maxEntries) throw new Error("registration_state_limit");
      await commit({ ...state, entries: [...merged.values()].sort((a, b) =>
        time(a.createdAt) - time(b.createdAt) || a.userId.localeCompare(b.userId)) });
      let failed = 0;
      let sent = 0;
      for (const userId of state.entries.map(entry => entry.userId)) {
        const targets = state.entries.find(entry => entry.userId === userId).adminIds;
        for (const adminId of targets) {
          const entry = state.entries.find(value => value.userId === userId);
          if (!activeAdmins.has(adminId) || entry.acknowledgedAdminIds.includes(adminId)) continue;
          try {
            const result = await deliver(userId, adminId);
            if (result === false) throw new Error("registration_delivery_rejected");
          } catch {
            failed += 1;
            try { onError({ operation: "registration-delivery", code: "delivery-pending" }); } catch {}
            continue;
          }
          const next = clone(state);
          next.entries.find(value => value.userId === userId).acknowledgedAdminIds.push(adminId);
          await commit(next);
          sent += 1;
        }
      }
      if (failed) return { status: "delivery-pending", failed, sent };
      const checkpointAt = new Date(Math.max(startedAt, time(state.checkpointAt))).toISOString();
      const retainAfter = Math.max(time(state.cutoffAt), time(checkpointAt) - overlapMs);
      await commit({ ...state, checkpointAt, entries: state.entries.filter(entry =>
        time(entry.createdAt) >= retainAfter || entry.adminIds.some(adminId =>
          activeAdmins.has(adminId) && !entry.acknowledgedAdminIds.includes(adminId))) });
      return { status: "ok", sent };
    } finally {
      inFlight = false;
    }
  }

  return { poll };
}
