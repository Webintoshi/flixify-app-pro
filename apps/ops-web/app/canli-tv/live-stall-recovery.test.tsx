import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveTvPage from "./page";

const state = vi.hoisted(() => ({ platform: {} as any, engines: [] as any[], hlsImportGate:null as Promise<void>|null }));
vi.mock("../platform/session", () => ({ usePlatform: () => state.platform, useProviderExpiry: () => state.platform.providerExpiresAt }));
vi.mock("../platform/artwork", () => ({ FavoriteButton: () => null }));
vi.mock("../components/player-chrome", () => ({ PlayerChrome: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("channel=channel-a") }));
vi.mock("next/link", () => ({ default: (props: any) => React.createElement("a", props) }));
vi.mock("hls.js", async () => {
 if(state.hlsImportGate)await state.hlsImportGate;
 return { default: class {
  static Events = { ERROR: "error" };
  static ErrorTypes = { MEDIA_ERROR: "media" };
  static isSupported() { return true; }
  handlers = new Map<string, Function>();
  destroyed = false;
  source = "";
  constructor() { state.engines.push(this); }
  on(event: string, listener: Function) { this.handlers.set(event, listener); }
  loadSource(source: string) { this.source = source; }
  attachMedia() {}
  recoverMediaError() {}
  destroy() { this.destroyed = true; }
  networkError() { this.handlers.get("error")?.("error", { fatal: true, type: "network" }); }
} };
});

describe("live stream stall recovery", () => {
  let root: Root;
  let container: HTMLElement;
  let expiresAt: string;
  let playback: ReturnType<typeof vi.fn>;
  const ref = { source: "personal", sourceVersion: "line-a", kind: "live", id: "274", extension: "m3u8" };
  const url = "https://edge.test/live/personal/test-password/274.m3u8";
  async function settle(action: () => void = () => {}) { await act(async () => { action(); await vi.dynamicImportSettled(); }); }
  async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await vi.dynamicImportSettled(); }); }
  function video() { return container.querySelector("video")!; }
  async function progress() {
    await settle(() => { video().currentTime += 1; video().dispatchEvent(new Event("timeupdate")); });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    const dom = parseHTML("<html><body><div id='root'></div></body></html>");
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    vi.stubGlobal("localStorage", storage);
    Object.defineProperty(dom.window, "localStorage", { configurable: true, value: storage });
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      currentTime: { configurable: true, writable: true, value: 0 },
      src: { configurable: true, get() { return this.getAttribute("src") ?? ""; }, set(value: string) { this.setAttribute("src",value); } },
      readyState: { configurable: true, writable: true, value: 4 },
      paused: { configurable: true, writable: true, value: false },
      ended: { configurable: true, writable: true, value: false },
      buffered: { configurable: true, get() { return { length: 1, start: () => 0, end: () => this.currentTime + 5 }; } },
      play: { configurable: true, value() { this.paused = false; return Promise.resolve(); } },
      pause: { configurable: true, value() { this.paused = true; } },
      load: { configurable: true, value() { this.currentTime = 0; } },
      canPlayType: { configurable: true, value: () => "" }
    });
    expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    playback = vi.fn(async () => ({ url, expiresAt }));
    state.engines = [];state.hlsImportGate=null;
    state.platform = { session: { accessToken: "test-token" }, favorites: [], providerMode: "personal", providerScope: "line-a",
      personalProvider: { catalog: async () => [{ id: "channel-a", title: "ATV HD", groupTitle: "TR", personalRef: ref }],
        playback, shortEpg: async () => ({ status: "empty", programmes: [] }) } };
    container = document.getElementById("root")!;
    root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function mount() {
    await settle(() => root.render(<LiveTvPage/>));
    await settle();
    expect(state.engines).toHaveLength(1);
    await progress();
  }

  it("bounds a pending engine import and preserves the newly authorized source when the retired chunk resolves", async () => {
    let release!:()=>void;state.hlsImportGate=new Promise<void>(done=>release=done);
    const renewed="https://edge.test/live/personal/test-password/274.mp4";
    playback.mockResolvedValueOnce({url,expiresAt}).mockResolvedValue({url:renewed,expiresAt});
    try {
      await act(async()=>root.render(<LiveTvPage/>));
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(playback).toHaveBeenCalledTimes(1);expect(state.engines).toHaveLength(0);
      await act(async()=>{await vi.advanceTimersByTimeAsync(29000);});
      expect(playback).toHaveBeenCalledTimes(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
      expect(playback).toHaveBeenCalledTimes(2);
      expect(video().src).toBe(renewed);
      release();state.hlsImportGate=null;await settle();
      expect(state.engines).toHaveLength(0);
      expect(video().src).toBe(renewed);
    } finally {release();state.hlsImportGate=null;await settle();}
  });

  it("attaches supported native HLS without waiting for the optional JavaScript engine download", async () => {
    let release!:()=>void;state.hlsImportGate=new Promise<void>(done=>release=done);
    Object.defineProperty(window.HTMLElement.prototype,"canPlayType",{configurable:true,value:()=>"probably"});
    try {
      await act(async()=>root.render(<LiveTvPage/>));
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(video().src).toBe(url);
      expect(state.engines).toHaveLength(0);
      expect(playback).toHaveBeenCalledTimes(1);
    }finally{release();state.hlsImportGate=null;await settle();}
  });

  it("starts from the channel selection authorization without waiting for a duplicate personal request", async () => {
    playback.mockResolvedValueOnce({url,expiresAt}).mockImplementation(()=>new Promise(()=>{}));
    await settle(()=>root.render(<LiveTvPage/>));await settle();
    expect(state.engines).toHaveLength(1);
    expect(state.engines[0].source).toBe(url);
    expect(playback).toHaveBeenCalledTimes(1);
  });

  it("keeps the current engine when delayed EPG metadata and favorite presentation update", async () => {
    const pending: Array<(value: unknown)=>void> = [];
    state.platform.personalProvider.shortEpg = () => new Promise(resolve => pending.push(resolve));
    await mount();const engine=state.engines[0];const media=video();
    await settle(()=>pending.forEach(resolve=>resolve({status:"ready",programmes:[{title:"Fixture programme",description:"",start:Date.now()-1000,end:Date.now()+60000}]})));
    state.platform={...state.platform,favorites:[{id:"channel-a",kind:"live"}]};
    await settle(()=>root.render(<LiveTvPage/>));
    expect(state.engines).toHaveLength(1);expect(state.engines[0]).toBe(engine);expect(engine.destroyed).toBe(false);
    expect(video()).toBe(media);expect(playback).toHaveBeenCalledTimes(1);
  });

  it("bounds pending recovery authorization independently of the previous playback stall and ignores its late result", async () => {
    await mount();let resolveOld!:(value:unknown)=>void;
    const renewed=url+"?fresh=1";
    playback.mockImplementationOnce(()=>new Promise(resolve=>resolveOld=resolve)).mockResolvedValue({url:renewed,expiresAt});
    await settle(()=>state.engines[0].networkError());await tick(4100);
    expect(playback).toHaveBeenCalledTimes(2);expect(state.engines[0].destroyed).toBe(true);
    await tick(29000);expect(playback).toHaveBeenCalledTimes(2);
    await tick(8000);expect(playback).toHaveBeenCalledTimes(3);expect(state.engines).toHaveLength(2);
    expect(state.engines[1].source).toBe(renewed);
    await settle(()=>resolveOld({url:url+"?retired=1",expiresAt}));
    expect(state.engines).toHaveLength(2);expect(state.engines[1].source).toBe(renewed);expect(state.engines[1].destroyed).toBe(false);
  });

  it("preserves a slow first-frame connection for its thirty-second preparation budget", async () => {
    await settle(()=>root.render(<LiveTvPage/>));await settle();
    expect(state.engines).toHaveLength(1);
    Object.defineProperty(video(),"readyState",{value:0,configurable:true,writable:true});
    await settle(()=>video().dispatchEvent(new Event("waiting")));
    await tick(29_000);
    expect(state.engines).toHaveLength(1);
    expect(state.engines[0].destroyed).toBe(false);
    await tick(5_000);
    expect(state.engines).toHaveLength(2);
    expect(playback).toHaveBeenCalledTimes(2);
  });

  for(const mode of ["hls","native-hls","native-mp4"]){
    it(`recovers a pending ${mode} play promise after its startup budget and ignores its late rejection`, async () => {
      let rejectFirst!:(reason:Error)=>void;let plays=0;
      Object.defineProperty(window.HTMLElement.prototype,"play",{configurable:true,value(){
        this.paused=false;plays++;return plays===1?new Promise<void>((_resolve,reject)=>rejectFirst=reject):Promise.resolve();
      }});
      if(mode==="native-hls")Object.defineProperty(window.HTMLElement.prototype,"canPlayType",{configurable:true,value:()=>"probably"});
      const source=mode==="native-mp4"?"https://edge.test/live/personal/test-password/274.mp4":url;
      playback.mockResolvedValue({url:source,expiresAt});
      await settle(()=>root.render(<LiveTvPage/>));await settle();
      expect(plays).toBe(1);expect(playback).toHaveBeenCalledTimes(1);
      await tick(29_000);expect(plays).toBe(1);
      await tick(5_000);expect(plays).toBe(2);expect(playback).toHaveBeenCalledTimes(2);
      if(mode==="hls"){expect(state.engines).toHaveLength(2);expect(state.engines[0].destroyed).toBe(true);expect(state.engines[1].destroyed).toBe(false);}
      else expect(video().src).toBe(source);
      await settle(()=>rejectFirst(new Error("retired playback promise")));
      await tick(10_000);expect(plays).toBe(2);expect(playback).toHaveBeenCalledTimes(2);
      expect(container.querySelector("[data-reconnect-attempt]")?.getAttribute("data-reconnect-attempt")).toBe("1");
      expect(container.textContent).not.toContain("Yayın kesildi");
    });
  }

  it("gives established playback twelve seconds to recover before replacing its connection", async () => {
    await mount();
    Object.defineProperty(video(),"readyState",{value:0,configurable:true,writable:true});
    await settle(()=>video().dispatchEvent(new Event("waiting")));
    await tick(11_000);expect(state.engines).toHaveLength(1);
    await tick(5_000);expect(state.engines).toHaveLength(2);
  });

  it("keeps canplay inside the startup budget and accepts playing as first-frame progress", async () => {
    await settle(()=>root.render(<LiveTvPage/>));await settle();
    await settle(()=>video().dispatchEvent(new Event("canplay")));
    await tick(13_000);expect(state.engines).toHaveLength(1);
    await settle(()=>video().dispatchEvent(new Event("playing")));
    await tick(11_000);expect(state.engines).toHaveLength(1);
    await tick(5_000);expect(state.engines).toHaveLength(2);
  });

  it("freshly authorizes a manual retry after the automatic connection budget is exhausted", async () => {
    await mount();
    for(const [index,delay] of [4_000,6_000,10_000].entries()){
      await settle(()=>state.engines.at(-1).networkError());await tick(delay+100);
      expect(state.engines).toHaveLength(index+2);
    }
    expect(state.engines).toHaveLength(4);expect(playback).toHaveBeenCalledTimes(4);
    await settle(()=>state.engines.at(-1).networkError());
    const retry=[...container.querySelectorAll("button")].find(button=>button.textContent==="Tekrar Dene");
    expect(retry).toBeDefined();
    const renewed=url+"?renewed=1";playback.mockResolvedValue({url:renewed,expiresAt});
    await settle(()=>retry!.click());
    expect(playback).toHaveBeenCalledTimes(5);expect(state.engines).toHaveLength(5);expect(state.engines.at(-1).source).toBe(renewed);
  });

  for(const extension of ["mp4","mkv"]){
    it(`plays the exact native ${extension} URL and clears its media source on close`, async () => {
      const nativeUrl=`https://edge.test/live/personal/test-password/274.${extension}?subtitle=.m3u8`;
      playback.mockResolvedValue({url:nativeUrl,expiresAt});
      await settle(()=>root.render(<LiveTvPage/>));await settle();
      const media=video();expect(media.src).toBe(nativeUrl);expect(state.engines).toHaveLength(0);
      const close=container.querySelector('button[aria-label="Oynatıcıyı kapat"]');expect(close).not.toBeNull();
      await settle(()=> (close as HTMLElement).click());
      expect(container.querySelector("video")).toBeNull();expect(media.src).toBe("");
    });
  }

  it("cleans up a pending native start when its account leaves and ignores its late play result", async () => {
    let release!:()=>void;Object.defineProperty(window.HTMLElement.prototype,"play",{configurable:true,value(){this.paused=false;return new Promise<void>(done=>release=done);}});
    playback.mockResolvedValue({url:"https://edge.test/live/personal/test-password/274.mp4",expiresAt});
    await settle(()=>root.render(<LiveTvPage/>));await settle();const media=video();expect(media.src).not.toBe("");
    state.platform={...state.platform,session:null,personalProvider:null,providerMode:"legacy",providerScope:""};
    await settle(()=>root.render(<LiveTvPage/>));expect(media.src).toBe("");
    await settle(()=>release());expect(container.querySelector("video")).toBeNull();expect(state.engines).toHaveLength(0);
  });

  it("restarts the same authorized HLS channel after a buffered stall with no further media events", async () => {
    await mount();
    await settle(() => video().dispatchEvent(new Event("stalled")));
    await tick(13_000);
    expect(container.textContent).not.toMatch(/Yayın (?:dengeleniyor|yenileniyor)/i);
    await tick(4_000);
    expect(state.engines).toHaveLength(2);
    expect(state.engines[0].destroyed).toBe(true);
    expect(state.engines[1].source).toBe(url);
    expect(playback.mock.calls.every(([value]) => value.id === "274")).toBe(true);
    expect(video().getAttribute("aria-label")).toBe("ATV HD canlı yayın");
  });

  it("leaves a manually paused stream alone", async () => {
    await mount();
    Object.defineProperty(video(), "paused", { value: true, configurable: true, writable: true });
    await tick(30_000);
    expect(state.engines).toHaveLength(1);
  });

  it("cancels recovery at the original three-hour access deadline", async () => {
    expiresAt = new Date(Date.now() + 10_000).toISOString();
    await mount();
    await tick(15_000);
    expect(state.engines).toHaveLength(1);
    expect(container.querySelector("video")).toBeNull();
  });

  it("extends and shortens a running engine deadline without replacing the engine", async () => {
    expiresAt = new Date(Date.now()+10000).toISOString(); await mount();
    const engine = state.engines[0];
    state.platform = {...state.platform, providerExpiresAt:new Date(Date.now()+30000).toISOString()};
    await settle(()=>root.render(<LiveTvPage/>));
    await tick(11000); await progress();
    expect(state.engines).toHaveLength(1); expect(engine.destroyed).toBe(false);
    expect(container.querySelector("video")).not.toBeNull();
    state.platform = {...state.platform, providerExpiresAt:new Date(Date.now()).toISOString()};
    await settle(()=>root.render(<LiveTvPage/>));
    expect(engine.destroyed).toBe(true); expect(container.querySelector("video")).toBeNull();
  });

  it("uses the latest extended cutoff when a later stall recreates its deadline", async () => {
    expiresAt=new Date(Date.now()+10000).toISOString();await mount();
    state.platform={...state.platform,providerExpiresAt:new Date(Date.now()+60000).toISOString()};
    await settle(()=>root.render(<LiveTvPage/>));
    await settle(()=>video().dispatchEvent(new Event("stalled")));
    await tick(17000);
    expect(state.engines).toHaveLength(2);expect(state.engines[1].destroyed).toBe(false);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("cancels recovery when the account signs out", async () => {
    await mount();
    await tick(9_000);
    state.platform = { ...state.platform, session: null, personalProvider: null, providerMode: "legacy", providerScope: "" };
    await settle(() => root.render(<LiveTvPage/>));
    await tick(20_000);
    expect(state.engines).toHaveLength(1);
    expect(container.querySelector("video")).toBeNull();
  });

  it("coalesces watchdog ticks while personal playback authorization is pending", async () => {
    await mount();
    let resolve!: (value: { url: string; expiresAt: string }) => void;
    playback.mockImplementation(() => new Promise(done => { resolve = done; }));
    await tick(17_000);
    expect(playback).toHaveBeenCalledTimes(2);
    await tick(20_000);
    expect(playback).toHaveBeenCalledTimes(2);
    await settle(() => resolve({ url, expiresAt }));
    expect(state.engines).toHaveLength(2);
  });

  it("resets the retry budget after sustained healthy progress between independent interruptions", async () => {
    await mount();
    for (let interruption = 0; interruption < 4; interruption++) {
      for (let second = 0; second < 10; second++) { await progress(); await tick(1_000); }
      expect(container.querySelector("[data-reconnect-attempt]")?.getAttribute("data-reconnect-attempt")).toBe("0");
      await settle(() => state.engines.at(-1).networkError());
      await tick(4_100);
      await settle();
      expect(state.engines).toHaveLength(interruption + 2);
    }
  });
});
