#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const lookupAnchor = "return items.find((l) => String(l.username).trim().toLowerCase() === String(username).trim().toLowerCase()) || items[0] || null;";
const lookupReplacement = "return items.find((l) => String(l.username).trim().toLowerCase() === String(username).trim().toLowerCase()) || null;";
const fakeSuccessAnchor = `return {
      id: detail.iptvUsername || requestedCredentials.username,
      username: requestedCredentials.username,
      password: requestedCredentials.password,
      exp_date: null
    };`;
const failureReplacement = 'throw new Error("Mevcut hat bulunamadı.");';
const renewStartAnchor = "if (existingLine?.id) {";
const renewStartReplacement = `if (existingLine?.id) {
      if (String(existingLine.password ?? "") !== String(requestedCredentials.password)) {
        throw new Error("Mevcut hat şifresi uyuşmuyor.");
      }`;
const createReturnAnchor = "return normalizePanelLine(rawResult, requestedCredentials);";
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
const existingLineBranchAnchor = /if \(lineAlreadyExists\) \{\s*const existingLine = await findResellerLine\(requestedCredentials\.username\);\s*if \(existingLine\?\.id\) \{\s*const extended = await extendPanelLine\(existingLine\.id, packageConfig\);\s*return normalizePanelLine\(extended\?\.data \|\| extended, requestedCredentials\);\s*\}\s*return \{\s*id: detail\.iptvUsername \|\| requestedCredentials\.username,\s*username: requestedCredentials\.username,\s*password: requestedCredentials\.password,\s*exp_date: null\s*\};\s*\}/g;

export function transformLiveTelegramAssignmentSource(source) {
  const lookupCount = source.split(lookupAnchor).length - 1;
  if (lookupCount !== 1) {
    throw new Error(`Expected exactly one reseller lookup anchor; found ${lookupCount}.`);
  }
  const fakeSuccessCount = source.split(fakeSuccessAnchor).length - 1;
  if (fakeSuccessCount !== 1) {
    throw new Error(`Expected exactly one fake-success assignment anchor; found ${fakeSuccessCount}.`);
  }
  const createReturnCount = source.split(createReturnAnchor).length - 1;
  if (createReturnCount !== 1) {
    throw new Error(`Expected exactly one new-line return anchor; found ${createReturnCount}.`);
  }
  const branches = [...source.matchAll(existingLineBranchAnchor)];
  if (branches.length !== 1) {
    throw new Error(`Expected exactly one existing-line assignment anchor; found ${branches.length}.`);
  }
  const safeBranch = branches[0][0]
    .replace(renewStartAnchor, renewStartReplacement)
    .replace(fakeSuccessAnchor, failureReplacement);
  return source
    .replace(lookupAnchor, lookupReplacement)
    .replace(branches[0][0], safeBranch)
    .replace(createReturnAnchor, verifiedCreateReplacement);
}

export async function applyLiveTelegramAssignmentSafetyPatch({ sourcePath, outputPath, expectedSha256 }) {
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
  const patched = transformLiveTelegramAssignmentSource(sourceBytes.toString("utf8"));
  await writeFile(outputPath, patched, { flag: "wx", mode: 0o600 });
  return { outputSha256: createHash("sha256").update(patched).digest("hex") };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error("Usage: node apply-live-telegram-assignment-safety.mjs SOURCE_MJS OUTPUT_MJS EXPECTED_SHA256");
    process.exitCode = 2;
  } else {
    try {
      const result = await applyLiveTelegramAssignmentSafetyPatch({ sourcePath: args[0], outputPath: args[1], expectedSha256: args[2] });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
