import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const sourceDigest = "7053b1c96b62417f8db532871bfca2d28630ec20c8850566d7d26f2649000d70";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function addEmailRegistrationLabel(source) {
  if (digest(source) !== sourceDigest) throw new Error("Registration card source has changed.");
  const start = source.indexOf("function renderUserCardText(detail) {");
  const end = source.indexOf("\nfunction renderPaymentRequestText(", start);
  if (start < 0 || end <= start) throw new Error("Registration card formatter was not found.");
  const formatter = source.slice(start, end);
  const anchor = '    : registration?.method === "account_code"';
  if (formatter.split(anchor).length !== 2) throw new Error("Registration method label has changed.");
  const newline = formatter.includes("\r\n") ? "\r\n" : "\n";
  const emailLabel = '    : registration?.method === "email_otp" ? "E-posta doğrulaması"';
  return source.slice(0, start) + formatter.replace(anchor, `${emailLabel}${newline}${anchor}`) + source.slice(end);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [source, output, ...extra] = process.argv.slice(2);
  if (!source || !output || extra.length) throw new Error("Provide a source file and a new output file.");
  const updated = addEmailRegistrationLabel(await readFile(source, "utf8"));
  await writeFile(output, updated, { flag: "wx", mode: 0o600 });
  console.log(digest(updated));
}
