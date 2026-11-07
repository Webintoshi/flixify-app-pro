import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PhoneLoginPreview from "./phone-login-preview";
import type { PhoneAuthClient, PhoneIntent } from "./phone-auth-client";
import type { AccountCodeClient, AnonymousRegistrationClient } from "./account-code-client";

const state = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), save: vi.fn(), analytics: vi.fn(), session: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace, push: state.push }) }));
vi.mock("next/link", () => ({ default: (props: any) => <a {...props}/> }));
vi.mock("next/image", () => ({ default: ({ priority: _priority, ...props }: any) => <img {...props}/> }));
vi.mock("../platform/session", () => ({ usePlatform: () => ({ session: state.session, saveSession: state.save }) }));
vi.mock("../platform/analytics", () => ({ trackAnalytics: state.analytics }));
vi.mock("../platform/device-login", () => ({ DeviceLoginQr: ({ onManual }: { onManual: () => void }) => <section>QR giriş<button onClick={onManual}>Kullanıcı koduyla giriş yap</button></section> }));

let root: Root, container: HTMLElement, monotonic: number;
const challenge = { challengeId: "opaque-challenge", challengeSecret: "opaque-browser-only-secret", expiresInSeconds: 300, resendAfterSeconds: 60, maskedPhone: "+90 ••• ••• 1234", delivery: "accepted" as const };
const paidSession = { accessToken: "fixture-access", refreshToken: "fixture-refresh", user: { id: "existing-paid-account" }, kryptoniteCode: null };
const settle = async (action = () => {}) => { await act(async () => { action(); }); };
function client() { return { status: vi.fn().mockResolvedValue({ enabled: true, deliveryChannel: "whatsapp" }), request: vi.fn().mockResolvedValue(challenge), verify: vi.fn().mockResolvedValue(paidSession) }; }
function findButton(text: string) { const found = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.trim() === text); if (!found) throw new Error(`Button absent: ${text}`); return found; }
function props(element: Element) { const key = Object.keys(element).find(key => key.startsWith("__reactProps")); if (!key) throw new Error("React input props absent"); return (element as any)[key]; }
async function type(id: string, value: string) { await settle(() => { const element = container.querySelector<HTMLInputElement>(id)!; element.value = value; element.setSelectionRange?.(value.length, value.length); props(element).onChange({ target: element, currentTarget: element }); }); }
async function submit() { await settle(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function render(transport: PhoneAuthClient, codeClient?: AccountCodeClient, options: { initialIntent?: PhoneIntent; onAuthenticated?: () => void; registrationClient?: AnonymousRegistrationClient } = {}) { await settle(() => root.render(<PhoneLoginPreview client={transport} codeClient={codeClient} {...options}/>)); }
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.HTMLInputElement.prototype.setSelectionRange = function (start: number, end: number) { Object.defineProperty(this, "selectionStart", { configurable: true, value: start }); Object.defineProperty(this, "selectionEnd", { configurable: true, value: end }); };
  Object.defineProperty(window, "location", { configurable: true, value: { search: "" } });
  const memory = new Map([["flixify-installation-id", "installation-fixture"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
  monotonic = 100; vi.stubGlobal("performance", { now: () => monotonic }); vi.useFakeTimers();
  state.replace.mockReset(); state.push.mockReset(); state.save.mockReset(); state.analytics.mockReset(); state.session = null;
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("does not claim OTP was sent or enable sending when the channel is unavailable", async () => {
  const transport = client(); transport.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  await render(transport); await type("#phone-number", "555 123 12 34");
  expect(findButton("WhatsApp ile giriş yap").disabled).toBe(true);
  expect(container.textContent).toContain("WhatsApp girişi şu an kullanılamıyor.");
  expect(findButton("Kullanıcı koduyla giriş")).not.toBeNull();
  await submit(); expect(transport.request).not.toHaveBeenCalled(); expect(container.querySelector("#phone-otp")).toBeNull();
});

it("keeps registration available inline only when the server explicitly disables phone authentication", async () => {
  const transport = client(); transport.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  const registration = vi.fn().mockResolvedValue({ ...paidSession, kryptoniteCode: "AB12CD34EF56GH78" });
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?ref=ABCDEFGHJKLM" } });
  await render(transport, undefined, { initialIntent: "register", registrationClient: registration });
  expect(container.querySelector("#phone-number")).toBeNull();
  expect(findButton("Hesap numarası oluştur").disabled).toBe(false);
  await submit();
  expect(registration).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ platform: "web", installationId: "installation-fixture", referralCode: "ABCDEFGHJKLM" }), expect.any(AbortSignal));
  expect(transport.request).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>("#issued-account-code")?.value).toBe("AB12CD34EF56GH78");
  expect(findButton("Devam et").disabled).toBe(true);
  await settle(() => props(container.querySelector("#account-code-saved")!).onChange({ target: { checked: true } }));
  await submit(); expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kryptoniteCode: "AB12CD34EF56GH78" }));
  expect(state.replace).toHaveBeenCalledWith("/");
  expect(state.analytics).toHaveBeenCalledWith("sign_up", { method: "account_code" });
});

it.each([new Error("network failed"), Object.assign(new Error("offline"), { status: 503 })])("does not offer anonymous registration during a phone status outage", async cause => {
  const transport = client(); transport.status.mockRejectedValue(cause); const registration = vi.fn();
  await render(transport, undefined, { initialIntent: "register", registrationClient: registration });
  expect(container.textContent).not.toContain("Hesap numarası oluştur");
  expect(findButton("WhatsApp ile hesap oluştur").disabled).toBe(true); await submit();
  expect(registration).not.toHaveBeenCalled();
});

it("prefers phone registration while enabled and never creates another account for a signed-in user", async () => {
  const registration = vi.fn(); await render(client(), undefined, { initialIntent: "register", registrationClient: registration });
  expect(container.textContent).not.toContain("Hesap numarası oluştur");
  await settle(() => root.unmount()); root = createRoot(container); state.session = paidSession;
  const disabled = client(); disabled.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  await render(disabled, undefined, { initialIntent: "register", registrationClient: registration });
  expect(container.textContent).not.toContain("Hesap numarası oluştur"); expect(registration).not.toHaveBeenCalled();
});

it("submits anonymous registration once and ignores a cancelled response after switching to login", async () => {
  const transport = client(); transport.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  let resolve!: (value: Awaited<ReturnType<AnonymousRegistrationClient>>) => void;
  const registration = vi.fn<AnonymousRegistrationClient>((_input, _signal) => new Promise(value => { resolve = value; }));
  await render(transport, undefined, { initialIntent: "register", registrationClient: registration });
  await submit(); await submit(); expect(registration).toHaveBeenCalledTimes(1);
  await settle(() => findButton("Giriş yap").click());
  await settle(() => resolve({ ...paidSession, kryptoniteCode: "AB12CD34EF56GH78" }));
  expect(registration.mock.calls[0][1].aborted).toBe(true);
  expect(container.querySelector("#issued-account-code")).toBeNull(); expect(state.save).not.toHaveBeenCalled();
});

it("does not replace an account opened elsewhere while the new account code awaits acknowledgement", async () => {
  const transport = client(); transport.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  const registration = vi.fn().mockResolvedValue({ ...paidSession, kryptoniteCode: "AB12CD34EF56GH78" });
  await render(transport, undefined, { initialIntent: "register", registrationClient: registration }); await submit();
  localStorage.setItem("flixify-public-session", JSON.stringify({ accessToken: "another-session", user: { id: "another-account" } }));
  await settle(() => props(container.querySelector("#account-code-saved")!).onChange({ target: { checked: true } }));
  await submit(); expect(state.save).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Başka bir oturum açıldı.");
});

it("returns an acknowledged anonymous account to the pending TV approval without another registration", async () => {
  const transport = client(); transport.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  const registration = vi.fn().mockResolvedValue({ ...paidSession, kryptoniteCode: "AB12CD34EF56GH78" });
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?device_code=ABCD-EFGH" } });
  await render(transport, undefined, { initialIntent: "register", registrationClient: registration }); await submit();
  await settle(() => props(container.querySelector("#account-code-saved")!).onChange({ target: { checked: true } })); await submit();
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/cihaz?code=ABCD-EFGH"); expect(registration).toHaveBeenCalledTimes(1);
});

it("labels the review wall as design examples without an extra visible motion control", async () => {
  await render(client()); expect(container.textContent).toContain("Yorum ve profiller tasarım örneğidir.");
  expect(container.textContent).toContain("Örnek yorum");
  expect(container.querySelectorAll('[data-slot="marquee"]').length).toBeGreaterThan(1);
  expect(container.textContent).not.toContain("Arka planı durdur");
  expect(container.querySelector('h1')).toBeNull();
  expect(container.textContent).not.toContain("WhatsApp girişi şu an kullanılamıyor.");
});

it("requires an explicit registration choice and shows the trial rule only during registration", async () => {
  const transport = client(); await render(transport);
  expect(container.textContent).not.toContain("Ücretsiz deneme:");
  await settle(() => findButton("Hesap oluştur").click());
  expect(container.textContent).toContain("Ücretsiz deneme: yalnız ilk üyelikte 3 saat.");
  await type("#phone-number", "555 123 12 34"); await submit();
  expect(transport.request.mock.calls[0][0]).toMatchObject({ intent: "register", phone: "+905551231234", installationId: "installation-fixture" });
});

it("starts the registration route in registration mode and retains its valid invitation context", async () => {
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?ref=ABCDEFGHJKLM" } });
  const transport = client(); await render(transport, undefined, { initialIntent: "register" });
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Hesap oluştur");
  await type("#phone-number", "5551231234"); await submit();
  expect(transport.request.mock.calls[0][0]).toMatchObject({ intent: "register", referralCode: "ABCDEFGHJKLM" });
});

it("keeps a dialog sign-in on the current screen and prioritizes an explicit TV pairing return", async () => {
  const completed = vi.fn(), transport = client(); await render(transport, undefined, { onAuthenticated: completed });
  await type("#phone-number", "5551231234"); await submit(); await type("#phone-otp", "123456"); await submit();
  expect(completed).toHaveBeenCalledTimes(1); expect(state.replace).not.toHaveBeenCalled();
  await settle(() => root.unmount()); root = createRoot(container); state.replace.mockReset(); completed.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?device_code=ABCD-EFGH" } });
  await render(client(), undefined, { onAuthenticated: completed }); await type("#phone-number", "5551231234"); await submit(); await type("#phone-otp", "123456"); await submit();
  expect(state.replace).toHaveBeenCalledWith("/cihaz?code=ABCD-EFGH"); expect(completed).not.toHaveBeenCalled();
});

it("adopts an unambiguous pasted international country without duplicating its calling code", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "0044 7510 123456");
  expect(container.querySelector('button[aria-label="Ülke: Birleşik Krallık (+44)"]')).not.toBeNull();
  await submit(); expect(transport.request.mock.calls[0][0].phone).toBe("+447510123456");
});

it("rejects a Turkish trunk zero and formats the number without repeating the selected country code", async () => {
  const transport = client(); await render(transport);
  await type("#phone-number", "0555 123 12 34");
  expect((container.querySelector("#phone-number") as HTMLInputElement).value).toBe("");
  expect(container.textContent).toContain("Başına 0 eklemeden yaz: 5xx xxx xx xx.");
  expect(findButton("WhatsApp ile giriş yap").disabled).toBe(true);
  await submit(); expect(transport.request).not.toHaveBeenCalled();
  await type("#phone-number", "5551231234");
  expect((container.querySelector("#phone-number") as HTMLInputElement).value).toBe("555 123 12 34");
  expect(container.textContent).not.toContain("Başına 0 eklemeden yaz:");
  await submit(); expect(transport.request.mock.calls[0][0].phone).toBe("+905551231234");
});

it("keeps the selected calling code out of a pasted complete Turkish number", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "+90 555 123 12 34");
  expect((container.querySelector("#phone-number") as HTMLInputElement).value).toBe("555 123 12 34");
  await submit(); expect(transport.request.mock.calls[0][0].phone).toBe("+905551231234");
});

it("handles partial deletion and refuses a pasted extra zero after the Turkish calling code", async () => {
  const transport = client(); await render(transport);
  for (const [value, expected] of [["5", "5"], ["555 ", "555"], ["55", "55"], ["", ""]]) {
    await type("#phone-number", value);
    expect((container.querySelector("#phone-number") as HTMLInputElement).value).toBe(expected);
    expect(findButton("WhatsApp ile giriş yap").disabled).toBe(true);
  }
  await type("#phone-number", "0090 0555 123 12 34");
  expect((container.querySelector("#phone-number") as HTMLInputElement).value).toBe("");
  await submit(); expect(transport.request).not.toHaveBeenCalled();
});

it("preserves a significant Italian leading zero when an international number is pasted", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "+39 02 1234 5678");
  expect(container.querySelector('button[aria-label="Ülke: İtalya (+39)"]')).not.toBeNull();
  expect((container.querySelector("#phone-number") as HTMLInputElement).value).toBe("02 1234 5678");
  await submit(); expect(transport.request.mock.calls[0][0].phone).toBe("+390212345678");
});

it("preserves the phone challenge secret and adopts the same paid account after verification", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "555 123 12 34"); await submit();
  expect(container.querySelector("#phone-otp")).not.toBeNull();
  expect(container.textContent).not.toContain(challenge.challengeSecret); expect(container.innerHTML).not.toContain(challenge.challengeId);
  expect(findButton("Yeniden gönder (1:00)").disabled).toBe(true);
  await type("#phone-otp", "123456"); await submit();
  expect(transport.verify.mock.calls[0][0]).toEqual({ challengeId: challenge.challengeId, challengeSecret: challenge.challengeSecret, code: "123456", installationId: "installation-fixture" });
  expect(state.save).toHaveBeenCalledWith(paidSession); expect(state.replace).toHaveBeenCalledWith("/");
});

it("does not adopt a late challenge after switching from login to registration", async () => {
  const transport = client(); let finish!: (value: typeof challenge) => void;
  transport.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(transport); await type("#phone-number", "555 123 12 34"); await submit();
  const signal = transport.request.mock.calls[0][1];
  await settle(() => findButton("Hesap oluştur").click()); await settle(() => finish(challenge));
  expect(signal.aborted).toBe(true); expect(container.querySelector("#phone-otp")).toBeNull(); expect(state.save).not.toHaveBeenCalled();
});

it("stops verifying an expired code without granting time or creating a session", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "555 123 12 34"); await submit(); await type("#phone-otp", "123456");
  monotonic += 300000; await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
  expect(container.textContent).toContain("Kodun süresi doldu"); expect(findButton("Doğrula ve devam et").disabled).toBe(true);
  await submit(); expect(transport.verify).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});

it("returns a verified phone session to the originally requested TV pairing page", async () => {
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?device_code=ABCD-EFGH" } });
  const transport = client(); await render(transport); await type("#phone-number", "555 123 12 34"); await submit(); await type("#phone-otp", "123456"); await submit();
  expect(state.replace).toHaveBeenCalledWith("/cihaz?code=ABCD-EFGH");
});

it("signs in with an existing code on this screen while keeping package state and the TV return path", async () => {
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?device_code=ABCD-EFGH" } });
  const transport = client(), codeClient = { login: vi.fn().mockResolvedValue({ ...paidSession, user: { ...paidSession.user, hasActiveSubscription: false } }) };
  transport.status.mockResolvedValue({ enabled: false, deliveryChannel: "whatsapp" });
  await render(transport, codeClient); await settle(() => findButton("Kullanıcı koduyla giriş").click());
  expect(state.push).not.toHaveBeenCalled(); expect(container.querySelector("#phone-number")).toBeNull();
  await type("#login-account-code", "ab12-cd34 ef56-gh78"); await submit();
  expect(codeClient.login.mock.calls[0][0]).toEqual({ code: "AB12CD34EF56GH78", deviceName: "Flixify Web", platform: "web", installationId: "installation-fixture" });
  expect(transport.request).not.toHaveBeenCalled(); expect(transport.verify).not.toHaveBeenCalled();
  expect(state.save.mock.calls[0][0].user.hasActiveSubscription).toBe(false);
  expect(state.analytics).toHaveBeenCalledExactlyOnceWith("login", { method: "account_code" });
  expect(state.replace).toHaveBeenCalledWith("/cihaz?code=ABCD-EFGH");
});

it("moves QR manual login into the inline account-code form and returns to the phone form", async () => {
  await render(client()); await settle(() => findButton("QR ile giriş").click());
  await settle(() => findButton("Kullanıcı koduyla giriş yap").click());
  expect(container.querySelector("#login-account-code")).not.toBeNull(); expect(state.push).not.toHaveBeenCalled();
  await settle(() => findButton("Telefonla giriş").click()); expect(container.querySelector("#phone-number")).not.toBeNull();
});

it("refuses late code-login sessions after a mode switch or a concurrent account change", async () => {
  let finish!: (value: typeof paidSession) => void;
  const codeClient = { login: vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })) };
  await render(client(), codeClient); await settle(() => findButton("Kullanıcı koduyla giriş").click());
  await type("#login-account-code", "AB12CD34EF56GH78"); await submit();
  const signal = codeClient.login.mock.calls[0][1];
  await settle(() => findButton("Telefonla giriş").click()); await settle(() => finish(paidSession));
  expect(signal.aborted).toBe(true); expect(state.save).not.toHaveBeenCalled();
  await settle(() => findButton("Kullanıcı koduyla giriş").click()); await type("#login-account-code", "AB12CD34EF56GH78"); await submit();
  localStorage.setItem("flixify-public-session", JSON.stringify({ accessToken: "other-account" }));
  await settle(() => finish(paidSession)); expect(state.save).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
});

it("restores the inline login form when browser storage is unavailable", async () => {
  const codeClient = { login: vi.fn() }; await render(client(), codeClient);
  await settle(() => findButton("Kullanıcı koduyla giriş").click()); await type("#login-account-code", "AB12CD34EF56GH78");
  localStorage.getItem = () => { throw new DOMException("Storage denied", "SecurityError"); };
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Giriş tamamlanamadı. Lütfen tekrar dene.");
  expect(container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(false);
  expect(codeClient.login).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
});

it("sends only one code-login request when submit is triggered twice before rendering", async () => {
  let finish!: (value: typeof paidSession) => void;
  const codeClient = { login: vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })) };
  await render(client(), codeClient); await settle(() => findButton("Kullanıcı koduyla giriş").click()); await type("#login-account-code", "AB12CD34EF56GH78");
  await settle(() => { for (let index = 0; index < 2; index++) container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(codeClient.login).toHaveBeenCalledTimes(1); await settle(() => finish(paidSession)); expect(state.save).toHaveBeenCalledTimes(1);
});


it("passes invitations only for new registrations, never account binding or sign-in", async () => {
  Object.defineProperty(window, "location", { configurable: true, value: { search: "?ref=ABCDEFGHJKLM" } });
  const transport = client(); await render(transport);
  await type("#phone-number", "5551231234"); await submit();
  expect(transport.request.mock.calls[0][0]).not.toHaveProperty("referralCode");
  await settle(() => findButton("Hesap oluştur").click());
  await settle(() => { const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!; props(checkbox).onChange({ target: { checked: true } }); });
  await type("#existing-account-code", "AB12CD34EF56GH78"); await type("#phone-number", "5551231234"); await submit();
  expect(transport.request.mock.calls[1][0]).not.toHaveProperty("referralCode");
});

it("does not send two WhatsApp messages when the form is submitted twice before rendering", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "5551231234");
  await settle(() => { const form = container.querySelector("form")!; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(transport.request).toHaveBeenCalledTimes(1);
});

it("does not save a late OTP login over a concurrent account change", async () => {
  let finish!: (value: typeof paidSession) => void;
  const transport = client(); transport.verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(transport); await type("#phone-number", "5551231234"); await submit(); await type("#phone-otp", "123456"); await submit();
  localStorage.setItem("flixify-public-session", JSON.stringify({ accessToken: "other-account", user: { id: "other" } }));
  await settle(() => finish(paidSession));
  expect(state.save).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
});


it("reports successful WhatsApp sign-in through the existing consent-gated analytics adapter without personal values", async () => {
  const transport = client(); await render(transport); await type("#phone-number", "5551231234"); await submit(); await type("#phone-otp", "123456"); await submit();
  expect(state.analytics).toHaveBeenCalledExactlyOnceWith("login", { method: "whatsapp" });
  const event = JSON.stringify(state.analytics.mock.calls); expect(event).not.toContain("5551231234"); expect(event).not.toContain("fixture-access"); expect(event).not.toContain("123456");
});
