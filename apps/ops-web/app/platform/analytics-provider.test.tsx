import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsRuntime, type AnalyticsDependencies } from "./analytics-policy";
import { AnalyticsBoundary, AnalyticsPreferences } from "./analytics-provider";
import { InstallProvider } from "../components/install/InstallProvider";
import { Landing } from "./landing";
import SiteShell from "../site-shell";

const state = vi.hoisted(() => ({ runtime: null as ReturnType<typeof createAnalyticsRuntime> | null, path: "/filmler" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path, useRouter: () => ({ push() {} }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ priority, ...props }: Record<string, unknown>) => <img {...props} /> }));
vi.mock("./session", () => ({ usePlatform: () => ({ session: null, ready: true }) }));
vi.mock("./welcome-offer", () => ({ WelcomeOfferBoundary: ({ children }: React.PropsWithChildren) => children }));
vi.mock("./shell", () => ({ AppShell: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("../components/navigation/MobileTabBar", () => ({ default: () => null }));
vi.mock("./analytics", () => ({ webAnalytics: () => state.runtime, trackAnalytics: (name: string, params: Record<string, unknown>) => state.runtime?.track(name, params), openAnalyticsPreferences: () => window.dispatchEvent(new Event("flixify-analytics-preferences")) }));

describe("analytics choice remains usable independently of account access", () => {
  let root: Root;
  let element: HTMLElement;
  let memory: Map<string, string>;
  let dependencies: AnalyticsDependencies;
  let calls: unknown[][];
  const settle = async (action = () => {}) => { await act(async () => { action(); await Promise.resolve(); }); };
  const button = (text: string) => [...element.querySelectorAll("button")].find(node => node.textContent === text)!;
  beforeEach(() => {
    const dom = parseHTML("<html><body><div id='root'></div></body></html>");
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    memory = new Map(); calls = []; state.path = "/filmler";
    dependencies = {
      storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } },
      loadConfig: vi.fn(async () => ({ schema: 1, consentVersion: 1, web: { enabled: true, measurementId: "G-TEST123456" } })),
      loadTag: vi.fn(async () => (...args: unknown[]) => { calls.push(args); }), disableTag: vi.fn(), clearIdentity: vi.fn(), relayConsent: vi.fn(async () => {}), platform: () => "web", now: Date.now
    };
    state.runtime = createAnalyticsRuntime(dependencies);
    element = document.getElementById("root")!; root = createRoot(element);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });
  it("keeps content available after rejection, permits later opt-in, and withdraws without duplicate strict-mode collection", async () => {
    await settle(() => root.render(<StrictMode><AnalyticsBoundary><main>Film arşivi</main><AnalyticsPreferences /></AnalyticsBoundary></StrictMode>));
    expect(element.textContent).toContain("Film arşivi");
    expect(dependencies.loadConfig).not.toHaveBeenCalled(); expect(dependencies.loadTag).not.toHaveBeenCalled();
    await settle(() => button("İzin verme").click());
    expect(element.textContent).not.toContain("İzin verİzin verme"); expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).toBeNull();
    expect(element.textContent).toContain("Kapalı"); expect(element.textContent).toContain("Film arşivi");
    await settle(() => button("İstatistik tercihleri").click()); await settle(() => button("İzin ver").click());
    expect(element.textContent).toContain("Açık"); expect(dependencies.loadTag).toHaveBeenCalledTimes(1);
    expect(calls.filter(call => call[0] === "event" && call[1] === "page_view")).toHaveLength(1);
    await settle(() => button("İstatistik tercihleri").click()); await settle(() => button("İzin verme").click());
    expect(element.textContent).toContain("Kapalı"); expect(dependencies.clearIdentity).toHaveBeenCalledTimes(1);
    expect(memory.get("flixify-analytics-consent-v1")).toBe('{"version":1,"choice":"rejected"}');
  });
  it("lets an anonymous visitor reopen and withdraw consent from the actual landing footer", async () => {
    state.path = "/";
    await settle(() => root.render(<AnalyticsBoundary><SiteShell><Landing /></SiteShell></AnalyticsBoundary>));
    await settle(() => button("İzin ver").click());
    expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).toBeNull();
    const preferences = element.querySelector("footer button");
    expect(preferences?.textContent).toBe("İstatistik tercihleri");
    await settle(() => (preferences as HTMLButtonElement).click());
    expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).not.toBeNull();
    await settle(() => button("İzin verme").click());
    expect(dependencies.clearIdentity).toHaveBeenCalledTimes(1);
    expect(dependencies.disableTag).toHaveBeenLastCalledWith("G-TEST123456", true);
  });
  it("keeps preferences reachable on public account, authentication and catalogue routes without adding an admin control", async () => {
    memory.set("flixify-analytics-consent-v1", '{"version":1,"choice":"rejected"}');
    state.runtime = createAnalyticsRuntime(dependencies);
    for (const path of ["/paketler", "/iletisim", "/giris-yap", "/kayit-ol", "/filmler", "/diziler", "/canli-tv", "/odeme-sonucu"]) {
      state.path = path;
      await settle(() => root.render(<AnalyticsBoundary><SiteShell><p>Sayfa içeriği</p></SiteShell></AnalyticsBoundary>));
      expect(element.querySelectorAll("footer button")).toHaveLength(1);
      await settle(() => button("İstatistik tercihleri").click());
      expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).not.toBeNull();
      await settle(() => button("Kapat").click());
    }
    state.path = "/admin";
    await settle(() => root.render(<AnalyticsBoundary><SiteShell><p>Yönetim</p></SiteShell></AnalyticsBoundary>));
    expect(element.querySelector("footer button")).toBeNull();
    expect(dependencies.loadTag).not.toHaveBeenCalled();
  });
  it("honors withdrawal from another tab while the page remains mounted", async () => {
    await settle(() => root.render(<AnalyticsBoundary><AnalyticsPreferences /></AnalyticsBoundary>));
    await settle(() => button("İzin ver").click());
    memory.set("flixify-analytics-consent-v1", '{"version":1,"choice":"rejected"}');
    const event = new Event("storage"); Object.defineProperty(event, "key", { value: "flixify-analytics-consent-v1" });
    await settle(() => window.dispatchEvent(event));
    expect(element.textContent).toContain("Kapalı");
    expect(dependencies.disableTag).toHaveBeenLastCalledWith("G-TEST123456", true);
  });
  it("shows the mobile install suggestion after the analytics choice rather than covering it with a second banner", async () => {
    state.path = "/";
    vi.stubGlobal("navigator", { userAgent: "iPhone", maxTouchPoints: 5 });
    vi.stubGlobal("localStorage", dependencies.storage);
    Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
    await settle(() => root.render(<AnalyticsBoundary><InstallProvider><main>Flixify</main></InstallProvider></AnalyticsBoundary>));
    expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).not.toBeNull();
    expect(element.querySelector("[aria-label='Uygulama kurulumu']")).toBeNull();
    await settle(() => button("İzin verme").click());
    expect(element.querySelector("[aria-label='Uygulama kurulumu']")).not.toBeNull();
  });
});
