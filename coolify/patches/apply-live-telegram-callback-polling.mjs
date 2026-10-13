#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const constructor = "const bot = new TelegramBot(config.telegramBotToken, { polling: false });";
const replacement = 'const bot = new TelegramBot(config.telegramBotToken, { polling: { autoStart: false, params: { allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "callback_query"] } } });';

export function transformLiveTelegramCallbackPollingSource(source) {
  const count = source.split(constructor).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one Telegram polling constructor anchor; found ${count}.`);
  }
  return source.replace(constructor, replacement);
}

export async function applyLiveTelegramCallbackPollingPatch({ sourcePath, outputPath, expectedSha256 }) {
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("An explicit expected source SHA256 is required.");
  }
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    throw new Error("Source and output paths must differ; the live source remains untouched.");
  }
  const sourceBytes = await readFile(sourcePath);
  const actualSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA256 mismatch for live Telegram source: expected ${expectedSha256}, found ${actualSha256}.`);
  }
  const patched = transformLiveTelegramCallbackPollingSource(sourceBytes.toString("utf8"));
  await writeFile(outputPath, patched, { flag: "wx", mode: 0o600 });
  return { outputSha256: createHash("sha256").update(patched).digest("hex") };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error("Usage: node apply-live-telegram-callback-polling.mjs SOURCE_MJS OUTPUT_MJS EXPECTED_SHA256");
    process.exitCode = 2;
  } else {
    try {
      const result = await applyLiveTelegramCallbackPollingPatch({ sourcePath: args[0], outputPath: args[1], expectedSha256: args[2] });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
