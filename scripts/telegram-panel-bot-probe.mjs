#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

class ProbePolicyError extends Error {
  constructor(code) { super(code); this.name = "ProbePolicyError"; this.code = code; }
}

function safeError(error, code = "invocation-failed") {
  const name = error?.name;
  const location = typeof error?.stack === "string" ? error.stack.match(/bot-source-probe:(\d+):(\d+)/) : null;
  return {
    code: error instanceof ProbePolicyError ? error.code : code,
    errorType: typeof name === "string" && /^[A-Za-z_$][\w$]{0,60}$/.test(name) ? name : "Error",
    ...(Number.isInteger(error?.status) ? {status:error.status} : {}),
    ...(location ? {sourceLocation:{line:Number(location[1]),column:Number(location[2])}} : {})
  };
}

export function prepareSource(source, sourcePath) {
  const bootstrapMatches = [...source.matchAll(/^Promise\.resolve\(\)/gm)];
  const bootstrap = bootstrapMatches.at(-1);
  if (!bootstrap || !/\.then\s*\([\s\S]*\.catch\s*\([\s\S]*;\s*$/.test(source.slice(bootstrap.index))) {
    throw new ProbePolicyError("final-bootstrap-not-found");
  }
  return source.slice(0,bootstrap.index)
    .replace(/^import\s+(?:[\s\S]*?);[ \t]*\r?\n/gm, match=>match.replace(/[^\r\n]/g,""))
    .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path.resolve(sourcePath)).href));
}

function apiRouteLabel(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const known = new Set(["users","packages","dashboard","payment-requests","trial-requests","m3u-sources","settings","login"]);
  if (parts[0] !== "admin" || !known.has(parts[1])) return "/admin/:endpoint";
  let label = `/admin/${parts[1]}`;
  if (parts.length > 2) label += "/:id";
  if (parts.length > 3) label += "/:endpoint";
  return label;
}

export function createRestrictedFetch({apiBaseUrl,resellerBaseUrl,transport=globalThis.fetch,onRoute,onUser,onValidation=()=>{}}) {
  const api = new URL(apiBaseUrl);
  const reseller = resellerBaseUrl ? new URL(resellerBaseUrl) : null;
  const apiPrefix = api.pathname.replace(/\/$/, "");
  return async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = String(options.method ?? input?.method ?? "GET").toUpperCase();
    const apiPath = url.pathname.slice(apiPrefix.length);
    let route = "blocked-network-route";
    let policyError = null;
    if (url.origin === api.origin && url.pathname.startsWith(`${apiPrefix}/admin/`) &&
        ((method === "GET") || (method === "POST" && apiPath === "/admin/login"))) {
      route = apiRouteLabel(new URL(apiPath,url.origin));
    } else if (reseller && url.origin === reseller.origin && url.pathname === reseller.pathname && method === "POST") {
      const body = options.body instanceof URLSearchParams ? options.body : new URLSearchParams(String(options.body ?? ""));
      const action = body.get("action");
      if (["user_info","packages","live_connections"].includes(action)) route = `reseller:${action}`;
      else policyError = new ProbePolicyError("reseller-mutation-blocked");
    } else policyError = new ProbePolicyError("network-route-blocked");
    const started = performance.now();
    let status = null;
    let itemCount = null;
    try {
      if (policyError) throw policyError;
      const response = await transport(url.href, {...options,method,redirect:"manual",signal:AbortSignal.timeout(20_000)});
      status = response.status;
      if (response.status >= 300 && response.status < 400) throw new ProbePolicyError("redirect-blocked");
      try {
        const payload = await response.clone().json();
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data) ? payload.data : null;
        itemCount = items?.length ?? null;
        if (method === "GET" && apiPath === "/admin/users" && response.ok) {
          if (!Array.isArray(payload?.items)) onValidation({code:"unexpected-user-list-schema",errorType:"SchemaError"});
          const id = payload?.items?.find(item=>typeof item?.id === "string")?.id;
          if (id) onUser?.(id);
        }
      } catch (error) {
        if (error instanceof ProbePolicyError) throw error;
      }
      return response;
    } catch (error) {
      onValidation(safeError(error,"network-request-failed"));
      throw error;
    } finally {
      onRoute({route,method,status,durationMs:Math.round(performance.now()-started),itemCount});
    }
  };
}

export async function runProbeSource(source,sourcePath,{transport=globalThis.fetch,environment=process.env,emit=record=>console.log(JSON.stringify(record)),onCapture}={}) {
  let current = {routes:[],messages:[],validationErrors:[]};
  let currentProbe = "source-load";
  let firstUserId = null;
  let restrictedFetch = null;
  const handlers = new Map();
  const textHandlers = [];
  let failureCount = 0;
  let messageId = 0;
  function capture(options = {}, text = "") {
    const keyboard = options?.reply_markup?.inline_keyboard ?? options?.reply_markup?.keyboard;
    const buttons = Array.isArray(keyboard) ? keyboard.flat() : [];
    if (typeof text !== "string") current.validationErrors.push({code:"invalid-message-text",errorType:"ValidationError"});
    if (String(text).length > 4096) current.validationErrors.push({code:"message-too-long",errorType:"ValidationError"});
    for (const button of buttons) {
      const buttonText = typeof button === "string" ? button : button?.text;
      if (typeof buttonText !== "string" || !buttonText) current.validationErrors.push({code:"invalid-button-text",errorType:"ValidationError"});
      if (button?.callback_data !== undefined && (typeof button.callback_data !== "string" || Buffer.byteLength(button.callback_data,"utf8") > 64)) {
        current.validationErrors.push({code:"invalid-callback-data",errorType:"ValidationError"});
      }
    }
    const renderedUserCount=buttons.filter(button=>typeof button?.callback_data === "string" && button.callback_data.startsWith("uview:")).length;
    let panel=classifyPanel(text);
    if (panel === "other") {
      if (renderedUserCount) panel="user-list";
      else if (buttons.some(button=>typeof button?.callback_data === "string" && button.callback_data.startsWith("users:"))) panel="user-management";
      else if (Array.isArray(options?.reply_markup?.keyboard)) panel="main-menu";
    }
    current.messages.push({buttons:buttons.length,panel,renderedUserCount});
    onCapture?.({probe:currentProbe,text,options});
    return {message_id:++messageId,chat:{id:1}};
  }
  class TelegramBotStub {
    on(event,handler) { handlers.set(event,handler); }
    onText(pattern,handler) { textHandlers.push({pattern,handler}); }
    async sendMessage(_chatId,text,options) { return capture(options,text); }
    async editMessageText(text,options) { return capture(options,text); }
    async answerCallbackQuery() { return true; }
    async deleteMessage() { return true; }
    async sendPhoto(_chatId,_photo,options) { return capture(options,options?.caption ?? ""); }
    async getMe() { return {id:0,username:"probe"}; }
    async getChat() { return {id:0}; }
    isPolling() { return false; }
    async startPolling() { return true; }
    async stopPolling() { return true; }
    async setMyCommands() { return true; }
  }
  const noOp = ()=>{};
  const safeFs = {readFile:async()=>"{}",writeFile:async()=>{},mkdir:async()=>{},rename:async()=>{},unlink:async()=>{},access:async()=>{}};
  const context = vm.createContext({
    TelegramBot:TelegramBotStub,fs:safeFs,path,crypto,fileURLToPath,Buffer,URL,URLSearchParams,
    Headers,Request,Response,AbortSignal,AbortController,performance,
    process:{env:{...environment},pid:0,argv:[],cwd:()=>path.dirname(path.resolve(sourcePath)),on:noOp,once:noOp,exit:()=>{throw new ProbePolicyError("source-exit-blocked");},stdout:{write:noOp},stderr:{write:noOp}},
    console:{log:noOp,info:noOp,warn:noOp,error:(...args)=>current.validationErrors.push(safeError(args.find(arg=>arg && typeof arg === "object" && typeof arg.name === "string"),"source-console-error"))},
    setTimeout:()=>0,clearTimeout:noOp,setInterval:()=>0,clearInterval:noOp,setImmediate:()=>0,clearImmediate:noOp,
    fetch:(...args)=>{if(!restrictedFetch) throw new ProbePolicyError("network-before-initialization"); return restrictedFetch(...args);}
  });
  new vm.Script(prepareSource(source,sourcePath),{filename:"bot-source-probe",importModuleDynamically:()=>{throw new ProbePolicyError("dynamic-import-blocked");}}).runInContext(context,{timeout:2000});
  const config = vm.runInContext("config",context);
  restrictedFetch = createRestrictedFetch({
    apiBaseUrl:config.flixifyApiBaseUrl,resellerBaseUrl:config.resellerApiBaseUrl,transport,
    onRoute:route=>current.routes.push(route),onUser:id=>{firstUserId ??= id;},onValidation:error=>current.validationErrors.push(error)
  });
  const adminId = [...(config.telegramAdminIds ?? [])][0] ?? "0";
  const chatId = Number(adminId) || 1;
  async function invoke(label,name,args,{callback=false,skip=false,messageHandler=false,command=null,inputAction=null}={}) {
    currentProbe=label;
    current = {routes:[],messages:[],validationErrors:[]};
    const started = performance.now();
    let status = "ok";
    try {
      if (skip) { status="skipped"; current.validationErrors.push({code:"no-user-available",errorType:"ProbeSkip"}); }
      else if (callback) {
        const handler = handlers.get("callback_query");
        if (!handler) status = "missing";
        else { context.__probeFunction=handler; context.__probeArguments=args; await bounded(vm.runInContext("__probeFunction(...__probeArguments)",context,{timeout:2000})); }
      } else if (messageHandler) {
        const handler = handlers.get("message");
        if (!handler && !command) status="missing";
        if (handler) { context.__probeFunction=handler; context.__probeArguments=args; await bounded(vm.runInContext("__probeFunction(...__probeArguments)",context,{timeout:2000})); }
        if (command) {
          let matched = false;
          for (const entry of textHandlers) {
            entry.pattern.lastIndex=0;
            const match=entry.pattern.exec(command);
            if (!match) continue;
            matched=true;
            context.__probeFunction=entry.handler;
            context.__probeArguments=[args[0],match];
            await bounded(vm.runInContext("__probeFunction(...__probeArguments)",context,{timeout:2000}));
          }
          if (!matched) status="missing";
        }
      } else if (vm.runInContext(`typeof ${name}`,context) !== "function") status="missing";
      else {
        context.__probeArguments=args;
        await bounded(vm.runInContext(`${name}(...__probeArguments)`,context,{timeout:2000}));
      }
    } catch (error) { status="error"; current.validationErrors.push(safeError(error)); }
    if (status === "error" || status === "missing" || current.validationErrors.length) failureCount+=1;
    emit({probe:label,status,durationMs:Math.round(performance.now()-started),routes:current.routes,messageCount:current.messages.length,buttons:current.messages.reduce((sum,item)=>sum+item.buttons,0),renderedUserCount:current.messages.reduce((sum,item)=>sum+item.renderedUserCount,0),panels:[...new Set(current.messages.map(item=>item.panel))],...(inputAction ? {inputAction}:{}),validationErrors:current.validationErrors});
  }
  await invoke("main-menu","showMainMenu",[chatId]);
  await invoke("user-management-menu","showUserManagementMenu",[chatId]);
  for (const filter of ["all","active","unassigned","blocked"]) await invoke(`user-list:${filter}`,"showUserList",[chatId,filter,1]);
  await invoke("user-detail","showUserDetailCard",[chatId,firstUserId,"all",1],{skip:!firstUserId});
  await invoke("analytics","showAnalyticsDashboard",[chatId]);
  await invoke("system-status","showSystemStatus",[chatId]);
  await invoke("reseller-balance","showResellerBalance",[chatId]);
  await invoke("callback:users:all:1",null,[{id:"probe-callback",data:"users:all:1",from:{id:adminId},message:{message_id:1,chat:{id:chatId}}}],{callback:true});
  if (vm.runInContext("typeof getMainMenuReplyMarkup",context) === "function") {
    const markup=vm.runInContext("getMainMenuReplyMarkup()",context,{timeout:2000});
    const keyboard=Array.isArray(markup?.keyboard) ? markup.keyboard.flat() : [];
    for (const [index,button] of keyboard.entries()) {
      const text=typeof button === "string" ? button : button?.text;
      if (typeof text !== "string") continue;
      await invoke(`main-keyboard:${index+1}`,null,[{text,from:{id:adminId},chat:{id:chatId},message_id:1}],{messageHandler:true,inputAction:classifyPanel(text)});
    }
  }
  for (const command of ["/kullanicilar","/bekleyenler"]) {
    await invoke(`command:${command}`,null,[{text:command,from:{id:adminId},chat:{id:chatId},message_id:1}],{messageHandler:true,command});
  }
  return {failureCount};
}

function classifyPanel(text) {
  const normalized=String(text).toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replaceAll("ı","i");
  if (normalized.includes("kullanici ara") || normalized.includes("arama") || (normalized.includes("kod") && normalized.includes("gonder"))) return "user-search";
  if (normalized.includes("kullanici yonetim")) return "user-management";
  if (normalized.includes("kullanicilar") || normalized.includes("bekleyen kayit") || normalized.includes("kullanici listesi")) return "user-list";
  if (normalized.includes("istatistik") || normalized.includes("analiz")) return "analytics";
  if ((normalized.includes("reseller") || normalized.includes("bakiye")) && (normalized.includes("kredi") || normalized.includes("bakiye"))) return "reseller-balance";
  if (normalized.includes("sistem durum") || normalized.includes("bot & sistem")) return "system-status";
  if (normalized.includes("kullanici detay") || normalized.includes("kullanici kart")) return "user-detail";
  if (normalized.includes("ana menu") || normalized.includes("kontrol merkezi")) return "main-menu";
  return "other";
}

async function bounded(promise) {
  let timer;
  try { return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ProbePolicyError("probe-invocation-timeout")),45_000);})]); }
  finally { clearTimeout(timer); }
}

async function selfTest() {
  const fixture = `
import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
const location = import.meta.url;
const config = { flixifyApiBaseUrl:"https://api.flixify.vip", resellerApiBaseUrl:"https://supplier.test/reseller", telegramAdminIds:new Set(["1"]) };
const bot = new TelegramBot("PRIVATE_FIXTURE", {polling:true});
const message = async (chatId) => bot.sendMessage(chatId,"PRIVATE_FIXTURE",{reply_markup:{inline_keyboard:[[{text:"Private",callback_data:"uview:synthetic-user-id:all:1"}]]}});
async function showMainMenu(chatId) { await Promise.resolve(); return message(chatId); }
async function showUserManagementMenu(chatId) { return message(chatId); }
async function showUserList(chatId,filter="all",page=1) { await fetch(config.flixifyApiBaseUrl+"/admin/users?private=PRIVATE_FIXTURE"); return message(chatId); }
async function showUserDetailCard(chatId,id) { await fetch(config.flixifyApiBaseUrl+"/admin/users/"+id); return message(chatId); }
async function showAnalyticsDashboard(chatId) { await fetch(config.flixifyApiBaseUrl+"/admin/dashboard"); return message(chatId); }
async function showSystemStatus(chatId) { await fetch(config.flixifyApiBaseUrl+"/admin/login",{method:"POST",body:"PRIVATE_FIXTURE"}); return message(chatId); }
async function showResellerBalance(chatId) { await fetch(config.resellerApiBaseUrl,{method:"POST",body:"action=user_info&api_key=PRIVATE_FIXTURE"}); return message(chatId); }
bot.on("callback_query",async q=>{await showUserList(q.message.chat.id,"all",1); await bot.answerCallbackQuery(q.id);});
function getMainMenuReplyMarkup() { return {keyboard:[[{text:"Kullanicilar"},{text:"Kullanici Ara / Paket"}]]}; }
bot.on("message",async m=>{if(m.text.startsWith("/"))return; await message(m.chat.id);});
bot.onText(/\\/kullanicilar$/,async m=>showUserList(m.chat.id,"all",1));
bot.onText(/\\/bekleyenler$/,async m=>showUserList(m.chat.id,"unassigned",1));
process.on("SIGTERM",()=>{throw new Error("must not execute");});
setInterval(()=>{throw new Error("timer must not execute");},1);
Promise.resolve().then(async()=>{throw new Error("bootstrap must not execute");}).catch(()=>{});
`;
  const prepared = prepareSource(fixture, "/tmp/synthetic-bot.mjs");
  assert.ok(prepared.includes("await Promise.resolve()"), "Only final bootstrap is removed");
  assert.ok(!prepared.includes("bootstrap must not execute"));
  const outbound = [];
  const transport = async (url, options) => {
    outbound.push({url, method:options.method,redirect:options.redirect});
    return new Response(JSON.stringify({items:[{id:"synthetic-user-id"}],total:1}), {status:200, headers:{"content-type":"application/json"}});
  };
  const results = [];
  const run=await runProbeSource(fixture,"/tmp/synthetic-bot.mjs",{transport, environment:{}, emit:r=>results.push(r)});
  assert.equal(run.failureCount,0);
  assert.equal(results.length,15);
  assert.ok(results.every(r=>r.messageCount===1));
  assert.ok(results.every(r=>r.validationErrors.length===0));
  assert.ok(results.every(r=>r.renderedUserCount===1));
  assert.ok(results.some(r=>r.routes.some(route=>route.route==="/admin/users/:id")));
  assert.ok(!JSON.stringify(results).includes("PRIVATE_FIXTURE"));
  assert.ok(!JSON.stringify(results).includes("synthetic-user-id"));
  const guarded = createRestrictedFetch({apiBaseUrl:"https://api.flixify.vip",resellerBaseUrl:"https://supplier.test/reseller",transport,onRoute:()=>{}});
  const before = outbound.length;
  for (const [url,options] of [
    ["https://api.flixify.vip/admin/users",{method:"POST"}],
    ["https://api.telegram.org/private",{}],
    ["https://supplier.test/reseller",{method:"POST",body:"action=create_line"}],
    ["https://api.flixify.vip/admin/login",{method:"POST",redirect:"follow"}]
  ].slice(0,3)) await assert.rejects(guarded(url,options), {name:"ProbePolicyError"});
  assert.equal(outbound.length,before,"Blocked mutations never reach transport");
  await guarded("https://api.flixify.vip/admin/login",{method:"POST",redirect:"follow"});
  assert.equal(outbound.at(-1).redirect,"manual");
  const redirects=createRestrictedFetch({apiBaseUrl:"https://api.flixify.vip",transport:async()=>new Response("",{status:302,headers:{location:"https://api.telegram.org/private"}}),onRoute:()=>{}});
  await assert.rejects(redirects("https://api.flixify.vip/admin/users"),{name:"ProbePolicyError"});
  const errorResults=[];
  const failed=await runProbeSource(fixture.replace('await fetch(config.flixifyApiBaseUrl+"/admin/dashboard"); return message(chatId);','throw new TypeError("PRIVATE_FIXTURE");'),"/tmp/synthetic-bot.mjs",{transport,environment:{},emit:r=>errorResults.push(r)});
  assert.ok(failed.failureCount>0);
  assert.equal(errorResults.find(r=>r.probe==="analytics").validationErrors[0].errorType,"TypeError");
  assert.ok(errorResults.find(r=>r.probe==="analytics").validationErrors[0].sourceLocation.line>0);
  assert.ok(!JSON.stringify(errorResults).includes("PRIVATE_FIXTURE"));
  console.log(JSON.stringify({selfTest:"passed",testCount:12}));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.includes("--self-test")) await selfTest();
    else {
      const sourcePath = process.argv.slice(2).find(arg=>!arg.startsWith("--"));
      if (!sourcePath) throw new ProbePolicyError("source-path-required");
      const source = await readFile(sourcePath,"utf8");
      const transport = process.argv.includes("--no-live") ? async()=>{throw new ProbePolicyError("live-network-disabled");} : globalThis.fetch;
      const result=await runProbeSource(source,sourcePath,{transport});
      process.exitCode=result.failureCount ? 1 : 0;
    }
  } catch (error) {
    console.log(JSON.stringify({status:"error",validationErrors:[safeError(error,"probe-initialization-failed")]}));
    process.exitCode=1;
  }
}
