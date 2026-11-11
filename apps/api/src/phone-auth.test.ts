import { describe, expect, it, vi } from 'vitest';
import { normalizePhone, PhoneAuthCrypto, PhoneAuthError, PhoneAuthService, type PhoneAuthStore, type PhoneReservation } from './phone-auth.js';

const secret='local-test-phone-auth-key-0000000000000000';
describe('phone identity and OTP privacy',()=>{
  it('prepares registration dependencies before the consume transaction can acquire a client',async()=>{
    const order:string[]=[];const session={accessToken:'fixture',refreshToken:'fixture',kryptoniteCode:null,user:{id:'fixture',codeSuffix:null,kryptoniteCode:null}};
    const store={rateVerify:vi.fn(async()=>{order.push('rate');}),consume:vi.fn(async()=>{order.push('consume');return {session};})} as unknown as PhoneAuthStore;
    const service=new PhoneAuthService(store,new PhoneAuthCrypto(secret),{send:vi.fn()},{prepare:async()=>{order.push('prepare');},resolve:vi.fn(),existingAccount:vi.fn()} as never);
    await expect(service.verify({challengeId:'fixture',challengeSecret:'fixture',code:'123456',installationId:'fixture'},'127.0.0.1')).resolves.toEqual(session);
    expect(order).toEqual(['rate','prepare','consume']);
  });
  it('does not open the account transaction if dependency preparation fails',async()=>{
    const store={rateVerify:vi.fn(async()=>{}),consume:vi.fn()} as unknown as PhoneAuthStore;
    const service=new PhoneAuthService(store,new PhoneAuthCrypto(secret),{send:vi.fn()},{prepare:async()=>{throw new Error('fixture-preparation-unavailable');},resolve:vi.fn(),existingAccount:vi.fn()} as never);
    await expect(service.verify({challengeId:'fixture',challengeSecret:'fixture',code:'123456',installationId:'fixture'},'127.0.0.1')).rejects.toThrow('fixture-preparation-unavailable');
    expect(store.consume).not.toHaveBeenCalled();
  });
  it('normalizes the same E164 number before lookup and rejects ambiguous numbers',()=>{
    expect(normalizePhone('+90 (555) 000 11 22')).toBe('+905550001122');
    expect(normalizePhone('00905550001122')).toBe('+905550001122');
    for(const input of ['05550001122','5550001122','+00012345678','+90555bad001122'])expect(()=>normalizePhone(input)).toThrow(PhoneAuthError);
  });
  it('keeps phone/code hashes separate and seals request metadata against challenge swaps',()=>{
    const crypto=new PhoneAuthCrypto(secret);const id='fixture-a';
    expect(crypto.hash('phone','+905550001122')).not.toBe(crypto.hash('otp','+905550001122'));
    const value=crypto.seal(id,{requestIp:'127.0.0.1'});expect(crypto.open(id,value)).toEqual({requestIp:'127.0.0.1'});
    expect(()=>crypto.open('fixture-b',value)).toThrow();expect(value).not.toContain('127.0.0.1');
  });
  it('reserves send limits before the provider call and never reports a failed send as accepted',async()=>{
    const events:string[]=[];const store={rateVerify:vi.fn(async()=>{}),reserve:vi.fn(async()=>{events.push('reserve');}),delivery:vi.fn(async()=>{events.push('failed');})} as unknown as PhoneAuthStore;
    const sender={send:vi.fn(async()=>{events.push('provider');throw new Error('secret provider token');})};
    const service=new PhoneAuthService(store,new PhoneAuthCrypto(secret),sender,{resolve:vi.fn(),existingAccount:vi.fn()} as never);
    await expect(service.request({phone:'+905550001122',intent:'register',installationId:'fixture-installation',platform:'web',deviceName:'Fixture'},'127.0.0.1')).rejects.toMatchObject({reason:'delivery_unavailable'});
    expect(events).toEqual(['reserve','provider','failed']);
  });
  it('does not call a paid provider when the durable reservation is rate limited',async()=>{
    const store={rateVerify:vi.fn(async()=>{}),reserve:vi.fn(async()=>{throw new PhoneAuthError(429,'rate_limited');})} as unknown as PhoneAuthStore;const sender={send:vi.fn()};
    const service=new PhoneAuthService(store,new PhoneAuthCrypto(secret),sender,{resolve:vi.fn(),existingAccount:vi.fn()} as never);
    await expect(service.request({phone:'+905550001122',intent:'register',installationId:'fixture-installation',platform:'web',deviceName:'Fixture'},'127.0.0.1')).rejects.toMatchObject({reason:'rate_limited'});expect(sender.send).not.toHaveBeenCalled();
  });
  it.each(['register','login'] as const)('pins a referral only to a %s request',async intent=>{
    const crypto=new PhoneAuthCrypto(secret);const reserve=vi.fn(async(_input:PhoneReservation)=>{});
    const store={reserve,rateVerify:vi.fn(async()=>{}),delivery:vi.fn(async()=>{})} as unknown as PhoneAuthStore;
    const service=new PhoneAuthService(store,crypto,{send:vi.fn(async()=>{})},{resolve:vi.fn(),existingAccount:vi.fn(async()=>null)} as never);
    const challenge=await service.request({phone:'+905550001122',intent,installationId:'fixture-installation',platform:'web',deviceName:'Fixture',referralCode:'BCDFGHJKMNPQ'},'127.0.0.1');
    const input=reserve.mock.calls[0]?.[0] as unknown as {context:string};
    expect((crypto.open(challenge.challengeId,input.context) as {referralCode?:string}).referralCode).toBe(intent==='register'?'BCDFGHJKMNPQ':undefined);
  });
});

it('isolates email challenge hashes and ciphertext from the existing phone namespace', () => {
  const phone = new PhoneAuthCrypto(secret);
  const email = new PhoneAuthCrypto(secret, 'email');
  expect(email.hash('otp', 'challenge:123456')).not.toBe(phone.hash('otp', 'challenge:123456'));
  const sealed = email.seal('fixture-email-challenge', { intent: 'register' });
  expect(email.open('fixture-email-challenge', sealed)).toEqual({ intent: 'register' });
  expect(() => phone.open('fixture-email-challenge', sealed)).toThrow();
});
