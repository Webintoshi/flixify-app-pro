import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsRuntime, type AnalyticsDependencies } from "./analytics-policy";
import { AnalyticsBoundary } from "./analytics-provider";
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
vi.mock("./analytics", () => ({ webAnalytics: () => state.runtime, trackAnalytics: (name: string, params: Record<string, unknown>) => state.runtime?.track(name, params) }));

describe("forced analytics acceptance", () => {
  let root: Root;
  let element: HTMLElement;
  let memory: Map<string, string>;
  let dependencies: AnalyticsDependencies;
  let calls: unknown[][];
  const settle = async (action = () => {}) => { await act(async () => { action(); await Promise.resolve(); }); };
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
  it("renders no analytics permission controls on public and account surfaces", async () => {
    state.path = "/";
    await settle(() => root.render(<StrictMode><AnalyticsBoundary><SiteShell><Landing /></SiteShell></AnalyticsBoundary></StrictMode>));
    expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).toBeNull();
    expect(element.textContent).not.toContain("İstatistik tercihleri");
    expect(element.textContent).not.toContain("İzin verme");
    expect(element.textContent).not.toContain("İzin ver");
    expect(memory.get("flixify-analytics-consent-v1")).toBe('{"version":1,"choice":"accepted"}');
    expect(dependencies.loadTag).toHaveBeenCalledTimes(1);
    expect(calls.filter(call => call[0] === "event" && call[1] === "page_view")).toHaveLength(1);

    state.path = "/ayarlar";
    await settle(() => root.render(<AnalyticsBoundary><SiteShell><main>Hesabım</main></SiteShell></AnalyticsBoundary>));
    expect(element.textContent).toContain("Hesabım");
    expect(element.textContent).not.toContain("İstatistik tercihleri");
    expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).toBeNull();
  });
  it("shows the mobile install suggestion without an analytics permission banner", async () => {
    state.path = "/";
    vi.stubGlobal("navigator", { userAgent: "iPhone", maxTouchPoints: 5 });
    vi.stubGlobal("localStorage", dependencies.storage);
    Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
    await settle(() => root.render(<AnalyticsBoundary><InstallProvider><main>Flixify</main></InstallProvider></AnalyticsBoundary>));
    expect(element.querySelector("[aria-labelledby='analytics-consent-title']")).toBeNull();
    expect(element.querySelector("[aria-label='Uygulama kurulumu']")).not.toBeNull();
  });
});
