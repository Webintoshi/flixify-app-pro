import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { phoneDownload } from "./phone-download";
import { sanitizeAnalyticsEvent } from "./analytics-policy";

it("serves the audited phone installer described by the download link", () => {
  const apk = readFileSync(new URL(`../../public${phoneDownload.href}`, import.meta.url));
  expect(apk.byteLength).toBe(phoneDownload.sizeBytes);
  expect(createHash("sha256").update(apk).digest("hex")).toBe(phoneDownload.sha256);
});

it("reports phone APK downloads separately without retaining phone or OTP values", () => {
  expect(sanitizeAnalyticsEvent("file_download", {
    download_platform: "android_phone", file_extension: "apk",
    file_name: phoneDownload.filename, target_version: phoneDownload.version,
    phone: "+905551231234", otp: "123456",
  })).toEqual({ name: "file_download", params: {
    download_platform: "android_phone", file_extension: "apk",
    file_name: phoneDownload.filename, target_version: phoneDownload.version,
  } });
});
