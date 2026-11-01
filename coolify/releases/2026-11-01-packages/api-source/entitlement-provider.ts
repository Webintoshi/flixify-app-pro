type Options={baseUrl:string;apiKey:string;fetcher?:typeof fetch};
export type ProviderLine={id:string;username:string;password:string;expiresAt:number;isTrial:boolean;enabled:boolean;maxConnections:number};
export type ProviderLineWithBouquets={id:string;username:string;isAdult:boolean;bouquetIds:string[]};
export type ProviderPackage={id:number;name:string;isTrial:boolean;duration:number;unit:'hours'|'days'|'months'|'years';credits:number;maxConnections:number};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const positive=(v:unknown)=>/^[1-9]\d{0,14}$/.test(String(v))&&Number.isSafeInteger(Number(v));
const flag=(v:unknown)=>v===0||v===1||v==='0'||v==='1';
function lineFrom(v:unknown):ProviderLine {
 const r=object(v);
 if(!positive(r.id)||!positive(r.exp_date)||!positive(r.max_connections)||!flag(r.is_trial)||!flag(r.enabled)||!flag(r.admin_enabled)||typeof r.username!=='string'||!r.username||typeof r.password!=='string'||!r.password||!Number.isSafeInteger(Number(r.exp_date)*1000))throw Error('provider_invalid_line');
 return {id:String(r.id),username:r.username,password:r.password,expiresAt:Number(r.exp_date)*1000,isTrial:String(r.is_trial)==='1',enabled:String(r.enabled)==='1'&&String(r.admin_enabled)==='1',maxConnections:Number(r.max_connections)};
}
function adultLineFrom(v:unknown,id:string):ProviderLineWithBouquets {
 const r=object(v);
 if(!positive(id)||String(r.id)!==id||typeof r.username!=='string'||!r.username||!flag(r.is_adult))throw Error('provider_invalid_line');
 const raw=r.bouquets_selected??r.bouquets??r.bouquet;
 let values:unknown[]=[];
 if(Array.isArray(raw))values=raw;
 else if(typeof raw==='string') {
  const trimmed=raw.trim();
  if(trimmed.startsWith('[')||trimmed.endsWith(']')) {
   if(!/^\[\s*(?:[1-9]\d{0,14}(?:\s*,\s*[1-9]\d{0,14})*)?\s*\]$/.test(trimmed))throw Error('provider_invalid_line');
   const inner=trimmed.slice(1,-1).trim();
   values=inner?inner.split(','):[];
  } else values=trimmed?trimmed.split(','):[];
 }
 if(!Array.isArray(raw)&&typeof raw!=='string')throw Error('provider_invalid_line');
 const ids=values.map(value=>String(value).trim());
 if(ids.some(value=>!positive(value)))throw Error('provider_invalid_line');
 return {id,username:r.username,isAdult:String(r.is_adult)==='1',bouquetIds:[...new Set(ids)].sort((a,b)=>Number(a)-Number(b))};
}
export class ResellerProvider {
 private readonly options:Options;
 constructor(options:Options) {
  const url=new URL(options.baseUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!options.apiKey)throw Error('invalid_provider_configuration');
  this.options=options;
 }
 private async request(action:string,payload:Record<string,string|number|readonly string[]>={},readGet=false,strictWarnings=false):Promise<unknown> {
  const body=new URLSearchParams({api_key:this.options.apiKey,action});
  for(const [key,value] of Object.entries(payload)) {
   if(Array.isArray(value))for(const item of value)body.append(key,item);
   else body.append(key,String(value));
  }
  const url=new URL(this.options.baseUrl);if(readGet)url.search=body.toString();
  let response:Response;
  try{response=await (this.options.fetcher??fetch)(url,{method:readGet?'GET':'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},...(readGet?{}:{body:body.toString()}),signal:AbortSignal.timeout(15000)});}
  catch{throw Error('provider_unavailable');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('provider_rejected');}
  let parsed:Record<string,unknown>;
  try{
   const reader=response.body?.getReader();if(!reader)throw Error();
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error();chunks.push(value);}}
   finally{await reader.cancel().catch(()=>{});}
   parsed=object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }catch{throw Error('provider_invalid_response');}
  if(parsed.status!=='STATUS_SUCCESS')throw Error('provider_rejected');
  if(strictWarnings && (parsed.warnings!==undefined && (!Array.isArray(parsed.warnings)||parsed.warnings.length>0)))throw Error('provider_warning');
  return parsed.data;
 }
 private requestStrict(action:string,payload:Record<string,string|number|readonly string[]>={},readGet=false) {
  return this.request(action,payload,readGet,true);
 }
 async findLine(username:string):Promise<ProviderLine|null> {
  if(!username||username.length>128)throw Error('invalid_provider_request');
  const result=await this.request('get_lines',{search:username},true);
  if(!Array.isArray(result))throw Error('provider_invalid_response');
  const matches=result.filter(r=>object(r).username===username);
  if(matches.length>1)throw Error('provider_ambiguous_line');
  return matches.length?lineFrom(matches[0]):null;
 }
 async getLine(lineId:string):Promise<ProviderLineWithBouquets> {
  if(!positive(lineId))throw Error('invalid_provider_request');
  return adultLineFrom(await this.requestStrict('get_line',{id:lineId},true),lineId);
 }
 async previewAdultBouquets(lineId:string):Promise<ProviderLineWithBouquets> {
  if(!positive(lineId))throw Error('invalid_provider_request');
  return adultLineFrom(await this.requestStrict('edit_line',{id:lineId,add_special_bouquets:1,dry_run:1}),lineId);
 }
 async addAdultBouquets(lineId:string):Promise<ProviderLineWithBouquets> {
  if(!positive(lineId))throw Error('invalid_provider_request');
  return adultLineFrom(await this.requestStrict('edit_line',{id:lineId,add_special_bouquets:1}),lineId);
 }
 async previewBouquetRestore(lineId:string,originalBouquetIds:string[],originalIsAdult:boolean):Promise<ProviderLineWithBouquets> {
  if(!positive(lineId)||originalBouquetIds.some(id=>!positive(id)))throw Error('invalid_provider_request');
  const result=adultLineFrom(await this.requestStrict('edit_line',{
   id:lineId,'bouquets_selected[]':originalBouquetIds,dry_run:1,
   ...(originalIsAdult?{}:{add_special_bouquets:0})
  }),lineId);
  const expected=[...new Set(originalBouquetIds)].sort((a,b)=>Number(a)-Number(b));
  if(result.isAdult!==originalIsAdult||result.bouquetIds.join(',')!==expected.join(','))throw Error('provider_restore_unverified');
  return result;
 }
 async listPackages():Promise<ProviderPackage[]> {
  const result=await this.request('packages');if(!Array.isArray(result))throw Error('provider_invalid_response');
  return result.map(value=>{
   const p=object(value),trial=String(p.is_trial)==='1';
   const duration=p[trial?'trial_duration':'official_duration'],unit=String(p[trial?'trial_duration_in':'official_duration_in']).toLowerCase(),credits=p[trial?'trial_credits':'official_credits'];
   if(!positive(p.id)||!flag(p.is_trial)||!positive(duration)||!positive(p.max_connections)||!['hours','days','months','years'].includes(unit)||!/^\d+(\.\d+)?$/.test(String(credits))||!Number.isFinite(Number(credits))||typeof p.package_name!=='string'||!p.package_name)throw Error('provider_invalid_package');
   return {id:Number(p.id),name:p.package_name,isTrial:trial,duration:Number(duration),unit:unit as ProviderPackage['unit'],credits:Number(credits),maxConnections:Number(p.max_connections)};
  });
 }
 async createTrial(input:{username:string;password:string;operationId:string}):Promise<void> {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(input.username)||!input.password||input.password.length>128||!/^[-a-zA-Z0-9]{1,80}$/.test(input.operationId))throw Error('invalid_provider_request');
  // Fixed server-side mapping, verified against the account's package list.
  await this.request('create_line',{package:7,trial:1,private_cdn:1,username:input.username,password:input.password,reseller_notes:`Flixify operation:${input.operationId}`});
 }
 async extendLine(input:{lineId:string;packageId:number}):Promise<void> {
  if(!positive(input.lineId)||![8,9,10,11,13,15,16].includes(input.packageId))throw Error('invalid_provider_request');
  await this.request('extend_line',{id:input.lineId,package:input.packageId});
 }
 async createPaidLine(input:{username:string;password:string;packageId:number;operationId:string}):Promise<void> {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(input.username)||!input.password||input.password.length>128||
     ![8,9,10,11,13,15,16].includes(input.packageId)||!/^[-_a-zA-Z0-9]{1,80}$/.test(input.operationId))throw Error('invalid_provider_request');
  await this.request('create_line',{
   package:input.packageId,trial:0,private_cdn:1,allow_epg:1,username:input.username,password:input.password,
   reseller_notes:`Flixify invoice:${input.operationId}`
  });
 }
}
