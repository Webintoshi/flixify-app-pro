import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider, usePlatform } from "./session";
import { VodPlayer } from "./detail";
import { useAccountResource } from "../account/components";
import { AccessBoundary } from "./onboarding";
import { sessionKey, type Session } from "./types";

const transport=vi.hoisted(()=>({mseLive:true}));
vi.mock("mpegts.js",()=>({default:{getFeatureList:()=>({mseLivePlayback:transport.mseLive})}}));

vi.mock("next/navigation", () => ({ usePathname: () => "/filmler" }));
vi.mock("next/image", () => ({ default: ({ unoptimized, fill, priority, ...props }: any) => React.createElement("img", props) }));
vi.mock("next/link", () => ({ default: (props: any) => React.createElement("a", props) }));

const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const session = (accountId = "account-a"): Session => ({
  accessToken: `test.${Buffer.from(JSON.stringify({ sub: accountId })).toString("base64url")}.signature`
});
const bootstrap = (accountId = "account-a") => ({ accountId, sourceVersion: `line-${accountId}`,
  providerOrigin: "https://provider.test", username: "personal", password: "test-only-password",
  expiresAt: expiry, moviePolicy: "general-audience-only" });
const account = (active: boolean) => ({ id: "account-a", status: active ? "active" : "new",
  hasAssignedLink: active, hasActiveSubscription: active,
  activePackage: active ? { title: "3 Saat Deneme", endsAt: expiry } : null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});
const denied = () => json({ message: "Kisisel yayin erisimi kullanilamiyor." }, 403);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

describe("personal provider session recovery", () => {
  let root: Root;
  let container: HTMLElement;
  let platform: ReturnType<typeof usePlatform>;
  let allowed: boolean;
  let active: boolean;
  let bootstrapRequests: AbortSignal[];
  let loadBootstrap: () => Promise<Response>;

  function Probe() {
    platform = usePlatform();
    return <output data-provider-mode={platform.providerMode}>{platform.providerScope}</output>;
  }
  async function settle(action: () => void = () => {}) {
    await act(async () => { action(); });
  }
  async function mount(withAccessBoundary = false) {
    await settle(() => root.render(<PlatformProvider>{withAccessBoundary
      ? <><Probe/><AccessBoundary><p>Accessible catalog</p></AccessBoundary></>
      : <Probe/>}</PlatformProvider>));
  }
  async function focus() { await settle(() => window.dispatchEvent(new Event("focus"))); }
  async function activateAccount() {
    active = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  }

  beforeEach(() => {
    const dom = parseHTML("<!doctype html><html><body><div id='test-root'></div></body></html>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Event", dom.window.Event);
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", storage());
    vi.stubGlobal("sessionStorage", storage());
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    localStorage.setItem(sessionKey, JSON.stringify(session()));
    localStorage.setItem("flixify-welcome:v1:account-a", "seen");
    allowed = false; active = false; bootstrapRequests = [];transport.mseLive=true;
    loadBootstrap = async () => allowed ? json(bootstrap()) : denied();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/me/provider-session") {
        bootstrapRequests.push(init?.signal as AbortSignal);
        return loadBootstrap();
      }
      if (url.pathname === "/me") return json({ user: account(active) });
      if (url.pathname === "/me/favorites") return json({ items: [] });
      if (url.pathname === "/me/personal-library") return json({ favorites: [] });
      if (url.pathname === "/player_api.php") return json([]);
      throw new Error(`Unexpected test request: ${url.pathname}`);
    }));
    container = document.getElementById("test-root")!;
    root = createRoot(container);
  });
  afterEach(async () => {
    await settle(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["focus", "manual"])("recovers the same account after initial 403 on %s refresh", async trigger => {
    await mount();
    expect(container.querySelector("output")?.getAttribute("data-provider-mode")).toBe("legacy");
    allowed = true;
    if (trigger === "focus") await focus();
    else await settle(() => platform.reload());
    expect(container.querySelector("output")?.textContent).toBe("line-account-a");
    expect(platform.providerMode).toBe("personal");
    expect(bootstrapRequests).toHaveLength(2);
  });

  it("coalesces repeated refreshes while bootstrap is pending", async () => {
    await mount();
    const pending = deferred<Response>();
    loadBootstrap = () => pending.promise;
    await focus();
    await focus();
    await settle(() => { platform.reload(); platform.reload(); });
    expect(bootstrapRequests).toHaveLength(2);
    expect(bootstrapRequests[1].aborted).toBe(false);
    await settle(() => pending.resolve(json(bootstrap())));
    expect(platform.providerMode).toBe("personal");
    expect(bootstrapRequests).toHaveLength(2);
  });

  it.each(["success", "failure"])("discards a late legacy favorites %s after recovering personal access", async result => {
    const pending = deferred<Response>();
    const fetchImpl = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => new URL(String(input)).pathname === "/me/favorites"
      ? pending.promise : fetchImpl(input, init));
    await mount();
    allowed = true;
    await focus();
    expect(platform.providerMode).toBe("personal");
    await settle(() => {
      if (result === "success") pending.resolve(json({ items: [{ id: "legacy-movie", kind: "movie", title: "Legacy favorite" }] }));
      else pending.reject(new Error("Legacy favorites unavailable"));
    });
    expect(platform.favoritesReady).toBe(true);
    expect(platform.favorites).toEqual([]);
    expect(platform.favoritesError).toBe("");
  });

  it("recovers after authoritative account activation without focus or page reload", async () => {
    vi.useFakeTimers();
    await mount(true);
    expect(container.querySelector("[data-onboarding-preview]")).not.toBeNull();
    allowed = true;
    await activateAccount();
    expect(container.textContent).toContain("Accessible catalog");
    expect(platform.providerMode).toBe("personal");
    expect(bootstrapRequests).toHaveLength(2);
  });

  it("remembers activation while an earlier ineligible bootstrap is pending", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    loadBootstrap = () => pending.promise;
    await mount(true);
    await activateAccount();
    expect(bootstrapRequests).toHaveLength(1);
    loadBootstrap = async () => json(bootstrap());
    await settle(() => pending.resolve(denied()));
    expect(platform.providerMode).toBe("personal");
    expect(bootstrapRequests).toHaveLength(2);
  });

  it("keeps the personal client and its pending catalog alive on ordinary focus", async () => {
    allowed = true;
    await mount();
    const client = platform.personalProvider!;
    const pending = deferred<Response>();
    const fetchImpl = vi.mocked(fetch).getMockImplementation()!;
    let catalogSignal!: AbortSignal;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname === "/player_api.php") {
        catalogSignal = init?.signal as AbortSignal;
        return (await pending.promise).clone();
      }
      return fetchImpl(input, init);
    });
    const catalog = expect(client.catalog("live")).resolves.toEqual([]);
    await settle();
    await focus();
    expect(platform.personalProvider).toBe(client);
    expect(catalogSignal.aborted).toBe(false);
    expect(bootstrapRequests).toHaveLength(2);
    await settle(() => pending.resolve(json([])));
    await catalog;
  });

  it("cancels pending recovery on logout and ignores a late bootstrap response", async () => {
    await mount();
    const pending = deferred<Response>();
    loadBootstrap = () => pending.promise;
    await focus();
    const signal = bootstrapRequests[1];
    await settle(() => platform.logout());
    expect(signal?.aborted).toBe(true);
    await settle(() => pending.resolve(json(bootstrap())));
    expect(platform.session).toBeNull();
    expect(platform.personalProvider).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("");
  });

  it("cancels pending recovery on account change and preserves the newer identity", async () => {
    await mount();
    const pending = deferred<Response>();
    loadBootstrap = () => pending.promise;
    await focus();
    const signal = bootstrapRequests[1];
    loadBootstrap = async () => json(bootstrap("account-b"));
    await settle(() => platform.saveSession(session("account-b")));
    expect(signal?.aborted).toBe(true);
    expect(container.querySelector("output")?.textContent).toBe("line-account-b");
    await settle(() => pending.resolve(json(bootstrap())));
    expect(container.querySelector("output")?.textContent).toBe("line-account-b");
  });

  it("does not spin when an active account remains ineligible for personal playback", async () => {
    vi.useFakeTimers();
    active = true;
    await mount(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(platform.providerMode).toBe("legacy");
    expect(bootstrapRequests.length).toBeLessThanOrEqual(3);
  });
  it("refreshes expiry on focus while preserving client and cached catalog, then preserves valid access through outage", async () => {
    allowed = true; await mount();
    const client = platform.personalProvider;
    await settle(async () => { await client!.catalog("live"); });
    const extended = new Date(Date.now()+7200000).toISOString();
    loadBootstrap = async () => json({...bootstrap(), expiresAt:extended});
    await focus();
    expect(platform.providerExpiresAt).toBe(extended);
    expect(platform.personalProvider).toBe(client);
    loadBootstrap = async () => { throw new Error("offline"); };
    await focus();
    expect(platform.personalProvider).toBe(client);
    expect(platform.providerExpiresAt).toBe(extended);
  });
  it("revokes only on fixed authoritative denial and polls inactive accounts", async () => {
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
    await mount(); allowed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(platform.providerMode).toBe("personal");
    allowed = false; loadBootstrap = async () => denied(); await focus();
    expect(platform.providerExpiresAt).toBeNull();
    expect(platform.personalProvider).toBeNull();
  });

  it("refreshes settings in the background without clearing confirmed account data", async () => {
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
    let resource: ReturnType<typeof useAccountResource<{user:{hasActiveSubscription:boolean}}>>;
    function Settings() { resource=useAccountResource("/me");return <output>{String(resource.data?.user.hasActiveSubscription)}</output>; }
    await settle(()=>root.render(<Settings/>));
    expect(resource!.data?.user.hasActiveSubscription).toBe(false);
    active=true;await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
    expect(resource!.loading).toBe(false);expect(resource!.data?.user.hasActiveSubscription).toBe(true);
    const impl=vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async(input,init)=>new URL(String(input)).pathname==="/me" ? Promise.reject(new Error("offline")):impl(input,init));
    await focus();expect(resource!.data?.user.hasActiveSubscription).toBe(true);expect(resource!.loading).toBe(false);
  });

  it("preserves never-personal legacy direct playback after bootstrap ineligibility", async () => {
    const prototype=window.HTMLElement.prototype;
    const tracks=Object.assign([], {addEventListener:()=>{},removeEventListener:()=>{}});
    Object.defineProperties(prototype, {
      textTracks:{configurable:true,value:tracks}, pause:{configurable:true,value:()=>{}},
      load:{configurable:true,value:()=>{}}, play:{configurable:true,value:()=>Promise.resolve()},
      canPlayType:{configurable:true,value:()=>""},volume:{configurable:true,value:1}
    });
    const record={url:"https://provider.test/base/movie/test.mp4",canPlay:true,transport:"mp4",deliveryMode:"direct_provider",expiresAt:expiry};
    function LegacyPlayer() { const ctx=usePlatform();platform=ctx;return ctx.providerMode==="legacy" ? <VodPlayer playback={record} title="Legacy film"/> : null; }
    await settle(()=>root.render(<PlatformProvider><LegacyPlayer/></PlatformProvider>));
    expect(platform.providerMode).toBe("legacy");expect(platform.providerExpiresAt).toBeUndefined();
    expect(container.textContent).not.toContain("İzleme süren doldu.");
    expect((container.querySelector("video") as HTMLVideoElement).src).toBe(record.url);
  });
  it("recovers settings on the next poll after the initial request times out", async () => {
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
    let resource: ReturnType<typeof useAccountResource<{user:{hasActiveSubscription:boolean}}>>;
    let requests=0;
    vi.mocked(fetch).mockImplementation(async(_input,init)=>{
      requests++; const signal=init?.signal;
      if(signal?.aborted)throw new Error("aborted");
      if(requests===1)return new Promise<Response>((_resolve,reject)=>signal?.addEventListener("abort",()=>reject(new Error("timeout")),{once:true}));
      return json({user:account(true)});
    });
    function Settings() { resource=useAccountResource("/me");return <output>{String(resource.data?.user.hasActiveSubscription)}</output>; }
    await settle(()=>root.render(<Settings/>));
    await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(resource!.error).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(45000);});
    expect(resource!.data?.user.hasActiveSubscription).toBe(true);expect(resource!.loading).toBe(false);expect(resource!.error).toBe(false);
  });

  it("applies a policy refresh to visible favorites and restores them without source or stored reference changes", async () => {
    allowed=true;let policy:unknown={revision:"a".repeat(64),excludedIds:[]};let liveReads=0;let libraryWrites=0;
    loadBootstrap=async()=>json({...bootstrap(),livePolicy:policy});
    const previous=vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async(input,init)=>{
      const url=new URL(String(input));
      if(url.pathname==="/me/personal-library")return json({favorites:[{source:"personal",sourceVersion:"line-account-a",kind:"live",id:"7"}]});
      if(url.pathname==="/me/personal-library/favorites"){libraryWrites++;return json({ok:true});}
      if(url.pathname==="/player_api.php") {if(url.searchParams.get("action")==="get_live_streams"){liveReads++;return json([{stream_id:7,name:"Saved channel"}]);}return json([]);}
      return previous(input,init);
    });
    await mount();await settle();expect(platform.favorites).toHaveLength(1);
    const client=platform.personalProvider;
    policy={revision:"b".repeat(64),excludedIds:["7"]};await settle(()=>platform.refreshProvider());await settle();
    expect(platform.favorites).toEqual([]);expect(platform.livePolicyRevision).toBe("b".repeat(64));
    expect(platform.providerScope).toBe("line-account-a");expect(platform.personalProvider).toBe(client);
    policy=undefined;await settle(()=>platform.refreshProvider());await settle();expect(platform.favorites).toEqual([]);
    policy={revision:"c".repeat(64),excludedIds:[]};await settle(()=>platform.refreshProvider());await settle();
    expect(platform.favorites).toHaveLength(1);expect(libraryWrites).toBe(0);expect(liveReads).toBe(1);
  });

  it("retries policy favorite hydration after an overlapping favorite mutation completes", async () => {
    allowed=true;let excluded=true;const write=deferred<Response>();
    loadBootstrap=async()=>json({...bootstrap(),livePolicy:{revision:(excluded?"a":"b").repeat(64),excludedIds:excluded?["7"]:[]}});
    const previous=vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async(input,init)=>{
      const url=new URL(String(input));
      if(url.pathname==="/me/personal-library")return json({favorites:[{source:"personal",sourceVersion:"line-account-a",kind:"live",id:"7"}]});
      if(url.pathname==="/me/personal-library/favorites")return write.promise;
      if(url.pathname==="/player_api.php")return json(url.searchParams.get("action")==="get_live_streams"?[{stream_id:7,name:"Saved channel"}]:[]);
      return previous(input,init);
    });
    await mount();await settle();expect(platform.favorites).toHaveLength(0);
    let mutation!:Promise<void>;
    await settle(()=>{mutation=platform.toggle({id:"new-film",kind:"movie",title:"Movie",personalRef:{source:"personal",sourceVersion:"line-account-a",kind:"movie",id:"12",extension:"mp4"}});});
    excluded=false;await settle(()=>platform.refreshProvider());await settle();
    await settle(()=>write.resolve(json({ok:true})));await mutation;await settle();
    expect(platform.favorites.some(item=>item.kind==="live")).toBe(true);
  });

  it.each([{nativeHls:false,mse:true,extension:"ts"},{nativeHls:true,mse:true,extension:"ts"},{nativeHls:false,mse:false,extension:"m3u8"},{nativeHls:true,mse:true,mpegtsLive:false,extension:"m3u8"}])("uses the verified browser default for implicit LIVE metadata: %j",async capabilities=>{
    allowed=true;transport.mseLive=capabilities.mpegtsLive!==false;
    Object.defineProperty(window.HTMLElement.prototype,"canPlayType",{configurable:true,value:()=>capabilities.nativeHls?"probably":""});
    Object.defineProperty(window,"MediaSource",{configurable:true,value:{isTypeSupported:()=>capabilities.mse}});
    const previous=vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async(input,init)=>{
      const url=new URL(String(input));if(url.pathname==="/player_api.php")return json(url.searchParams.get("action")==="get_live_streams"?[{stream_id:7,name:"Implicit live"}]:[]);
      return previous(input,init);
    });
    await mount();await act(async()=>{await vi.dynamicImportSettled();});await settle();
    const items=await platform.personalProvider!.catalog("live");expect(items[0].personalRef.extension).toBe(capabilities.extension);
    expect(items[0].id).toBe("personal:line-account-a:live:7");
  });

});
