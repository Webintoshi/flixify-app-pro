import { afterEach, expect, it, vi } from "vitest";
import type { apiRequest } from "../../lib/api";
import { accountCodeError, createAccountCodeClient, normalizeAccountCode } from "./account-code-client";

const input = { code: "AB12CD34EF56GH78", platform: "web" as const, deviceName: "Flixify Web", installationId: "existing-installation" };
const session = { accessToken: "fixture-access", refreshToken: "fixture-refresh", user: { id: "existing-account", hasActiveSubscription: false } };
afterEach(() => vi.useRealTimers());

it("normalizes an existing account code and signs in without registration, OTP or trial requests", async () => {
  expect(normalizeAccountCode("ab12-cd34 ef56-gh78")).toBe(input.code);
  const request = vi.fn().mockResolvedValue(session), client = createAccountCodeClient(request as typeof apiRequest);
  expect(await client.login(input, new AbortController().signal)).toEqual(session);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe("/auth/login-by-code");
  expect(request.mock.calls[0][1]).toMatchObject({ method: "POST", body: input, skipAuthRefresh: true });
});

it.each([{ ...session, accessToken: "" }, { ...session, refreshToken: "" }, { ...session, user: {} }])("rejects a malformed session instead of saving it", async value => {
  const client = createAccountCodeClient(vi.fn().mockResolvedValue(value) as typeof apiRequest);
  await expect(client.login(input, new AbortController().signal)).rejects.toThrow("Invalid account session");
});

it("does not send an incomplete account code", async () => {
  const request = vi.fn(), client = createAccountCodeClient(request as typeof apiRequest);
  await expect(client.login({ ...input, code: "SHORT" }, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
  expect(request).not.toHaveBeenCalled();
});

it("cancels a stalled login after twenty seconds without retrying", async () => {
  vi.useFakeTimers(); let signal: AbortSignal | undefined;
  const request = vi.fn((_path, options) => new Promise((_resolve, reject) => { const requestSignal = options.signal as AbortSignal; signal = requestSignal; requestSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
  const pending = expect(createAccountCodeClient(request as typeof apiRequest).login(input, new AbortController().signal)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(20000); await pending;
  expect(signal?.aborted).toBe(true); expect(request).toHaveBeenCalledTimes(1);
});

it("cancels login when its screen changes and hides raw provider errors", async () => {
  let signal: AbortSignal | undefined; const outer = new AbortController();
  const request = vi.fn((_path, options) => new Promise((_resolve, reject) => { const requestSignal = options.signal as AbortSignal; signal = requestSignal; requestSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
  const pending = expect(createAccountCodeClient(request as typeof apiRequest).login(input, outer.signal)).rejects.toMatchObject({ name: "AbortError" });
  outer.abort(); await pending; expect(signal?.aborted).toBe(true);
  expect(accountCodeError(Object.assign(new Error("personal provider details"), { status: 401 }))).toBe("Kullanıcı kodunu kontrol edip tekrar dene.");
  expect(accountCodeError(new Error("personal provider details"))).not.toContain("personal provider details");
});

