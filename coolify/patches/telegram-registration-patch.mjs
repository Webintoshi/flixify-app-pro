import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRegistrationNotifier } from "./telegram-registration-core.mjs";

const AUDITED_POLL_SHA256 = "6f9bdd1cefb88a117e6e7177083fedad291ca04708696629b34999836c57a8ad";
const MARKER = "// Flixify registration notifier v1";
const sha = value => createHash("sha256").update(value).digest("hex");

function createRegistrationNotifierForBot() {
  const registrationStatePath = `${config.stateFilePath}.registrations.json`;
  const maxStateBytes = 16 * 1024 * 1024;
  return createRegistrationNotifier({
    pageSize: 100,
    load: async () => {
      try {
        const stat = await fs.lstat(registrationStatePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxStateBytes) {
          throw new Error("registration_journal_invalid");
        }
        const data = await fs.readFile(registrationStatePath);
        if (data.length > maxStateBytes) throw new Error("registration_journal_invalid");
        return JSON.parse(data.toString("utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
    save: async state => {
      const directory = path.dirname(registrationStatePath);
      await fs.mkdir(directory, { recursive: true });
      const serialized = `${JSON.stringify(state)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > maxStateBytes) throw new Error("registration_journal_invalid");
      const temporary = `${registrationStatePath}.${process.pid}.${Date.now()}.tmp`;
      let handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
        await handle.close(); handle = null;
        await fs.rename(temporary, registrationStatePath);
        const parent = await fs.open(directory, "r");
        try { await parent.sync(); } finally { await parent.close(); }
      } finally {
        if (handle) await handle.close();
        await fs.unlink(temporary).catch(error => { if (error?.code !== "ENOENT") throw error; });
      }
    },
    listUsers: (page, pageSize) => flixifyRequest("/admin/users", { query: { page, pageSize } }),
    getAdminIds: () => config.telegramAdminIds,
    deliver: async (userId, adminId) => {
      const detail = await getUserDetail(userId);
      return bot.sendMessage(adminId, renderUserCardText(detail), {
        parse_mode: "HTML",
        reply_markup: buildUserCardKeyboard(userId, 1)
      });
    },
    onError: () => console.error("telegram-panel-bot registration delivery pending; retry scheduled")
  });
}

export function transformTelegramRegistrationSource(source, expectedSha256) {
  if (typeof source !== "string" || typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("registration_patch_input_invalid");
  }
  if (sha(source) !== expectedSha256) throw new Error("registration_source_hash_mismatch");
  if (source.includes(MARKER)) throw new Error("registration_already_patched");
  const startAnchor = "async function pollNewUsers({ seedOnly = false } = {}) {";
  const endAnchor = "\nasync function startNotifier() {";
  if (source.split(startAnchor).length !== 2 || source.split(endAnchor).length !== 2) {
    throw new Error("registration_poll_anchor_invalid");
  }
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start);
  if (end < start) throw new Error("registration_poll_anchor_invalid");
  const originalPoll = source.slice(start, end);
  if (sha(originalPoll.trimEnd()) !== AUDITED_POLL_SHA256) throw new Error("registration_poll_body_changed");
  const legacyQuery = "      listAllPendingUsers(),";
  const prelude = "  notifierTickInFlight = true;\n\n  try {";
  if (originalPoll.split(legacyQuery).length !== 2 || originalPoll.split(prelude).length !== 2) {
    throw new Error("registration_poll_anchor_invalid");
  }
  const nextPoll = originalPoll.replace(legacyQuery, "      Promise.resolve([]),").replace(prelude,
    "  notifierTickInFlight = true;\n\n  try {\n    await registrationNotifier.poll();\n  } catch {\n" +
    '    console.error("telegram-panel-bot registration notifier poll failed; retry scheduled");\n' +
    "  }\n\n  try {");
  const injected = `${MARKER}\n${createRegistrationNotifier.toString()}\n\n${createRegistrationNotifierForBot.toString()}\n\nconst registrationNotifier = createRegistrationNotifierForBot();\n\n`;
  return source.slice(0, start) + injected + nextPoll + source.slice(end);
}

export async function applyTelegramRegistrationPatch({ sourcePath, outputPath, expectedSha256 }) {
  if (path.resolve(sourcePath) === path.resolve(outputPath)) throw new Error("registration_source_output_must_differ");
  const source = await readFile(sourcePath, "utf8");
  const candidate = transformTelegramRegistrationSource(source, expectedSha256);
  await writeFile(outputPath, candidate, { flag: "wx", mode: 0o600 });
  return { outputSha256: sha(candidate) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [sourcePath, outputPath, expectedSha256, ...extra] = process.argv.slice(2);
  if (!sourcePath || !outputPath || !expectedSha256 || extra.length) {
    console.error("Usage: telegram-registration-patch.mjs SOURCE_MJS OUTPUT_MJS EXPECTED_SHA256");
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await applyTelegramRegistrationPatch({ sourcePath, outputPath, expectedSha256 }))); }
    catch (error) {
      console.error(error?.code === "EEXIST" ? "registration_output_exists" : /^registration_[a-z_]+$/.test(error?.message || "") ? error.message : "registration_patch_failed");
      process.exitCode = 1;
    }
  }
}
