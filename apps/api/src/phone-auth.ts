import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { withTransaction } from './db.js';
export type PhoneTransaction=Parameters<Parameters<typeof withTransaction>[0]>[0];
export type OtpChannel = 'phone' | 'email';

export class PhoneAuthError extends Error {
  constructor(public statusCode:number,public reason:string,public retryAfterSeconds?:number){super(reason);}
}
export function normalizePhone(input:string){
  const value=input.trim().replace(/^00/,'+').replace(/[\s().-]/g,'');
  if(!/^\+[1-9][0-9]{7,14}$/.test(value))throw new PhoneAuthError(400,'invalid_phone');
  return value;
}
export type PhoneAuthOwner={userId:string;sessionId?:string;authMethod?:string};
export type PhoneRequest={phone:string;intent:'login'|'register';installationId:string;platform:'web'|'android_tv'|'android_phone'|'windows'|'macos';deviceName:string;existingCode?:string;referralCode?:string};
export type PhoneContext=Omit<PhoneRequest,'phone'|'existingCode'>&{requestIp:string;pendingUserId?:string;pendingSessionId?:string};
export type PhoneSession={accessToken:string;refreshToken:string;kryptoniteCode:null;user:{id:string;codeSuffix:string|null;kryptoniteCode:null}};
export type PhoneReservation={id:string;phoneHash:string;maskedPhone:string;otpHash:string;secretHash:string;installationHash:string;ipHash:string;context:string;rateKeys:{key:string;limit:number;windowSeconds:number}[]};
export type PhoneVerification={id:string;otpHash:string;secretHash:string;installationHash:string;ipHash:string};
export type PhoneConsumeResult={session:PhoneSession}|{reason:string;statusCode:number};
export interface PhoneAuthStore {
  readonly channel?: OtpChannel;
  reserve(input:PhoneReservation):Promise<void>;
  delivery(id:string,accepted:boolean):Promise<void>;
  rateVerify(key:string):Promise<void>;
  consume(input:PhoneVerification,finalize:(client:PhoneTransaction,context:string,phoneHash:string,maskedPhone:string,existingUserId:string|null)=>Promise<PhoneSession>):Promise<PhoneConsumeResult>;
}
export class PhoneAuthCrypto {
  private key:Buffer;
  constructor(private secret: string, readonly channel: OtpChannel = 'phone') {
    if (secret.length < 32) throw new Error('OTP authentication secret is not configured');
    this.key = createHmac('sha256', secret).update(`${channel}-auth:v1:encryption`).digest();
  }
  hash(purpose: string, value: string) {
    return createHmac('sha256', this.secret).update(`${this.channel}-auth:v1:${purpose}\0${value}`).digest('hex');
  }
  code(){return String(randomInt(0,1000000)).padStart(6,'0');}
  proof(){return randomBytes(32).toString('base64url');}
  seal(id:string,value:unknown){return this.encrypt(id,randomBytes(12),value);}
  private encrypt(id:string,iv:Buffer,value:unknown){const cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');}
  open(id:string,value:string):unknown{const data=Buffer.from(value,'base64url');if(data.length<29)throw new Error('Invalid phone challenge');const decipher=createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));}
}
export function phoneHashesMatch(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export type OtpAccountResolver = {
  prepare?(): Promise<void>;
  existingAccount(code: string | undefined, owner: PhoneAuthOwner | undefined): Promise<{ userId: string; sessionId?: string } | null>;
  resolve(client: PhoneTransaction, context: PhoneContext, contactHash: string, maskedContact: string, existingUserId: string | null): Promise<PhoneSession>;
};

export class OtpAuthService {
  constructor(
    private store: PhoneAuthStore,
    private crypto: PhoneAuthCrypto,
    private sender: { send(contact: string, code: string): Promise<void> },
    private accounts: OtpAccountResolver,
    channel: OtpChannel
  ) {
    if (crypto.channel !== channel || (store.channel && store.channel !== channel)) {
      throw new Error('OTP authentication namespace mismatch');
    }
  }

  protected async requestContact(contact: string, maskedContact: string, input: Omit<PhoneRequest, 'phone'>, requestIp: string, owner?: PhoneAuthOwner) {
    const id = randomUUID(), code = this.crypto.code(), challengeSecret = this.crypto.proof();
    await this.store.rateVerify(this.crypto.hash('request-ip', requestIp));
    const proof = await this.accounts.existingAccount(input.existingCode, owner);
    const context: PhoneContext = {
      intent: input.intent, installationId: input.installationId, platform: input.platform, deviceName: input.deviceName, requestIp,
      ...(input.intent === 'register' && !proof && input.referralCode && /^[A-Z2-9]{12}$/.test(input.referralCode) ? { referralCode: input.referralCode } : {}),
      ...(proof ? { pendingUserId: proof.userId, ...(proof.sessionId ? { pendingSessionId: proof.sessionId } : {}) } : {})
    };
    const channel = this.crypto.channel;
    await this.store.reserve({
      id, phoneHash: this.crypto.hash(channel, contact), maskedPhone: maskedContact,
      otpHash: this.crypto.hash('otp', `${id}:${code}`), secretHash: this.crypto.hash('challenge-secret', challengeSecret),
      installationHash: this.crypto.hash('installation', input.installationId), ipHash: this.crypto.hash('ip', requestIp),
      context: this.crypto.seal(id, context),
      rateKeys: [
        { key: this.crypto.hash(`rate-${channel}`, contact), limit: 6, windowSeconds: 3600 },
        { key: this.crypto.hash('rate-ip', requestIp), limit: 20, windowSeconds: 3600 },
        { key: this.crypto.hash('rate-installation', input.installationId), limit: 6, windowSeconds: 3600 },
        { key: this.crypto.hash('rate-global', 'request'), limit: 120, windowSeconds: 3600 }
      ]
    });
    try {
      await this.sender.send(contact, code);
      await this.store.delivery(id, true);
    } catch {
      await this.store.delivery(id, false).catch(() => {});
      throw new PhoneAuthError(503, 'delivery_unavailable');
    }
    return { challengeId: id, challengeSecret, expiresInSeconds: 300, resendAfterSeconds: 60, delivery: 'accepted' as const };
  }
  async verify(input:{challengeId:string;challengeSecret:string;code:string;installationId:string},requestIp:string){
    await this.store.rateVerify(this.crypto.hash('verify-ip',requestIp));
    await this.accounts.prepare?.();
    const result=await this.store.consume({id:input.challengeId,otpHash:this.crypto.hash('otp',`${input.challengeId}:${input.code}`),secretHash:this.crypto.hash('challenge-secret',input.challengeSecret),installationHash:this.crypto.hash('installation',input.installationId),ipHash:this.crypto.hash('ip',requestIp)},
      (client,sealed,phoneHash,maskedPhone,existingUserId)=>this.accounts.resolve(client,this.crypto.open(input.challengeId,sealed) as PhoneContext,phoneHash,maskedPhone,existingUserId));
    if('reason' in result)throw new PhoneAuthError(result.statusCode,result.reason);
    return result.session;
  }
}

export class PhoneAuthService extends OtpAuthService {
  constructor(store: PhoneAuthStore, crypto: PhoneAuthCrypto, sender: { send(phone: string, code: string): Promise<void> }, accounts: OtpAccountResolver) {
    super(store, crypto, sender, accounts, 'phone');
  }

  async request(input: PhoneRequest, requestIp: string, owner?: PhoneAuthOwner) {
    const phone = normalizePhone(input.phone);
    const maskedPhone = `${phone.slice(0, 3)}${'•'.repeat(Math.max(4, phone.length - 7))}${phone.slice(-4)}`;
    const challenge = await this.requestContact(phone, maskedPhone, input, requestIp, owner);
    return { ...challenge, maskedPhone };
  }
}
