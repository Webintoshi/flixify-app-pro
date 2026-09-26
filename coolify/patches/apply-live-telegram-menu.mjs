#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Patch the verified live version without replacing it with the older repository bot.
export function transformLiveTelegramMenuSource(source) {
  const anchor = /normalized\.includes\("(?:kullanici|kullanıcı)"\)/g;
  const matches = [...source.matchAll(anchor)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Telegram management menu anchor; found ${matches.length}.`);
  }
  return source.replace(anchor, '(normalized === "kullanici" || normalized === "kullanıcı")');
}

export async function applyLiveTelegramMenuPatch({ sourcePath, outputPath, expectedSha256 }) {
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
  const patched = transformLiveTelegramMenuSource(sourceBytes.toString("utf8"));
  await writeFile(outputPath, patched, { flag: "wx", mode: 0o600 });
  return { outputSha256: createHash("sha256").update(patched).digest("hex") };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error("Usage: node apply-live-telegram-menu.mjs SOURCE_MJS OUTPUT_MJS EXPECTED_SHA256");
    process.exitCode = 2;
  } else {
    try {
      const result = await applyLiveTelegramMenuPatch({ sourcePath: args[0], outputPath: args[1], expectedSha256: args[2] });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
