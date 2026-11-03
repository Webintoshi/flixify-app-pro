export type LinkedSession = {accessToken:string;refreshToken:string;user:{id:string;codeSuffix:string}};
export type DeviceDisplay = {phase:'idle'|'loading'|'pending'|'saving'|'adopted'|'expired'|'denied'|'cancelled'|'complete'|'error';code?:string;qr?:string;remaining?:number;message?:string};
type Challenge={requestId:string;deviceSecret:string;userCode:string;verificationUri:string;verificationUriComplete:string;qrPngBase64:string;expiresInSeconds:number;intervalSeconds:number};
type Call=(path:string,body:unknown,signal?:AbortSignal)=>Promise<any>;
export function deviceReturnPath(code:string):string|null {return /^[A-HJ-NP-Z]{4}-[A-HJ-NP-Z]{4}$/.test(code)?`/cihaz?code=${code}`:null;}
function validChallenge(value:Challenge) {
  if(!value || !/^[a-f0-9-]{36}$/i.test(value.requestId) || !/^[A-Za-z0-9_-]{43}$/.test(value.deviceSecret) || !deviceReturnPath(value.userCode))return false;
  if(value.verificationUri!=='https://flixify.vip/cihaz'||value.verificationUriComplete!==`https://flixify.vip${deviceReturnPath(value.userCode)}`||value.expiresInSeconds!==180||value.intervalSeconds<2||value.intervalSeconds>30)return false;
  if(typeof value.qrPngBase64!=='string'||value.qrPngBase64.length>200000||!/^[A-Za-z0-9+/]+=*$/.test(value.qrPngBase64))return false;
  try{const bytes=Uint8Array.from(atob(value.qrPngBase64),v=>v.charCodeAt(0));const view=new DataView(bytes.buffer);return bytes.length>=24&&view.getUint32(0)===0x89504e47&&view.getUint32(4)===0x0d0a1a0a&&view.getUint32(12)===0x49484452&&view.getUint32(16)>=128&&view.getUint32(16)<=1024&&view.getUint32(20)===view.getUint32(16);}catch{return false;}
}
function validSession(value:any):value is LinkedSession {return typeof value?.accessToken==='string'&&value.accessToken.length>0&&value.accessToken.length<16000&&typeof value?.refreshToken==='string'&&value.refreshToken.length>0&&value.refreshToken.length<1000&&typeof value?.user?.id==='string'&&typeof value.user.codeSuffix==='string'&&!('kryptoniteCode' in value)&&!('kryptoniteCode' in value.user);}

export class DeviceLoginClient {
  private epoch=0;private challenge?:Challenge;private adopted=false;private pendingSession?:LinkedSession;
  private timer?:ReturnType<typeof setTimeout>;private countdown?:ReturnType<typeof setInterval>;private inFlight=false;private abort?:AbortController;
  private startedAt=0;private interval=2;private display:DeviceDisplay={phase:'idle'};
  constructor(private call:Call,private save:(session:LinkedSession)=>void,private changed:(state:DeviceDisplay)=>void,private now:()=>number=()=>performance.now(),private maySave:()=>boolean=()=>true){}
  private emit(value:DeviceDisplay){this.display=value;this.changed(value);}
  private stopTimers(){clearTimeout(this.timer);clearInterval(this.countdown);this.timer=undefined;this.countdown=undefined;}
  private async request(path:string,body:unknown,signal?:AbortSignal){const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=setTimeout(abort,12000);try{return await this.call(path,body,controller.signal);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
  private proof(c:Challenge){return {requestId:c.requestId,deviceSecret:c.deviceSecret};}
  private discard(c:Challenge){void this.request('/auth/device/cancel',this.proof(c)).catch(()=>{});}
  async start(){
    this.cancel();const epoch=++this.epoch;this.adopted=false;this.pendingSession=undefined;this.abort=new AbortController();this.emit({phase:'loading'});
    try{const c=await this.request('/auth/device/start',{platform:'web',deviceName:'Flixify Web'},this.abort.signal) as Challenge;
      if(epoch!==this.epoch){if(validChallenge(c))this.discard(c);return;}
      if(!validChallenge(c))throw Error('invalid_challenge');this.challenge=c;this.startedAt=this.now();this.interval=c.intervalSeconds;
      this.emit({phase:'pending',code:c.userCode,qr:`data:image/png;base64,${c.qrPngBase64}`,remaining:180});
      this.countdown=setInterval(()=>{if(epoch!==this.epoch)return;const remaining=Math.max(0,Math.ceil((180000-(this.now()-this.startedAt))/1000));this.emit({...this.display,remaining});if(this.now()-this.startedAt>=240000){this.cancel();this.emit({phase:'expired'});}},1000);this.schedule(epoch);
    }catch{if(epoch===this.epoch)this.emit({phase:'error',message:'QR giriş şu anda hazırlanamadı. Tekrar deneyebilir veya kullanıcı kodunla giriş yapabilirsin.'});}
  }
  private schedule(epoch:number){this.timer=setTimeout(()=>void this.poll(epoch),this.interval*1000);}
  private async poll(epoch:number){
    const c=this.challenge;if(epoch!==this.epoch||this.adopted||!c||this.inFlight)return;
    if(this.now()-this.startedAt>=240000){this.cancel();this.emit({phase:'expired'});return;}
    this.inFlight=true;
    try{const result=await this.request('/auth/device/token',this.proof(c),this.abort?.signal);if(epoch!==this.epoch)return;
      if(result.status==='authorized'){if(!validSession(result.session))throw Error('invalid_session');this.pendingSession={accessToken:result.session.accessToken,refreshToken:result.session.refreshToken,user:{id:result.session.user.id,codeSuffix:result.session.user.codeSuffix}};this.stopTimers();this.retrySave();return;}
      if(['denied','cancelled','expired','complete'].includes(result.status)){this.stopTimers();this.emit({phase:result.status});return;}
      if(result.status!=='pending'&&result.status!=='slow_down')throw Error('invalid_status');
      this.interval=Math.min(60,Math.max(this.interval,result.intervalSeconds??(result.status==='slow_down'?this.interval+5:2)));this.schedule(epoch);
    }catch{if(epoch===this.epoch){this.interval=Math.min(60,this.interval+3);this.schedule(epoch);}}
    finally{if(epoch===this.epoch)this.inFlight=false;}
  }
  retrySave(){const c=this.challenge,session=this.pendingSession;if(!c||!session||this.adopted)return;
    if(!this.maySave()){this.cancel();this.emit({phase:'cancelled'});return;}
    if(this.now()-this.startedAt>=240000){this.cancel();this.emit({phase:'expired'});return;}
    this.adopted=true;
    try{this.save(session);}catch{this.adopted=false;this.emit({...this.display,phase:'saving',message:'Giriş bu tarayıcıya kaydedilemedi. Depolama iznini kontrol edip tekrar dene.'});return;}
    this.pendingSession=undefined;this.emit({phase:'adopted'});void this.request('/auth/device/ack',this.proof(c)).catch(()=>{});
  }
  cancel(){this.epoch++;this.stopTimers();this.abort?.abort();this.abort=undefined;const c=this.challenge;this.challenge=undefined;this.pendingSession=undefined;this.inFlight=false;if(c&&!this.adopted)this.discard(c);}
  pause(){const wasAdopted=this.adopted;this.cancel();if(!wasAdopted)this.emit({phase:'cancelled'});}
}
