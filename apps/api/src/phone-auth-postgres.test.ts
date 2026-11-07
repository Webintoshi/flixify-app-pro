import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
vi.mock('dotenv',()=>({config:()=>({})}));
vi.mock('./env.js',()=>{
  let database='postgresql://127.0.0.1:1/unused';
  try{const u=new URL(process.env.DATABASE_URL??'');if(u.hostname==='127.0.0.1'&&u.port==='55441'&&u.pathname==='/flixify_phone_preview')database=u.href;}catch{}
  return {env:{DATABASE_URL:database,APP_JWT_SECRET:'fixture-jwt-key-0000000000000000000000000000',REGISTRATION_GUARD_SECRET:'fixture-registration-key-000000000000000000',AUTO_TRIAL_DAILY_IP_LIMIT:2}};
});
import { randomInt,randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { PhoneAuthCrypto,PhoneAuthService,type PhoneContext,type PhoneRequest } from './phone-auth.js';
import { PostgresPhoneAuthStore } from './phone-auth-store.js';
import { phoneAuthAccounts } from './phone-auth-accounts.js';
import { createCodeLookup,hashSecret } from './security.js';
import { registrationIpHash,registrationInstallationHash } from './registration-limits.js';
import { DeviceLoginStore } from './device-login-store.js';
import { getAdminUserDetail } from './repository.js';

const url=new URL(process.env.DATABASE_URL??'http://unconfigured.invalid');
const local=url.hostname==='127.0.0.1'&&url.port==='55441'&&url.pathname==='/flixify_phone_preview'&&process.env.PHONE_AUTH_TEST_DATABASE==='owned-local-only';
const cases=local?describe:describe.skip;
const registrationGuardSecret='fixture-registration-key-000000000000000000';
const madeUsers:string[]=[],madeRequests:string[]=[],requestIps:string[]=[],installations:string[]=[];const prefix=`fixture-${randomUUID()}`;let sequence=0;
const crypto=new PhoneAuthCrypto(`fixture-phone-auth-secret-${randomUUID()}`);
function fixture(ip?:string){
  const n=++sequence;const requestIp=ip??`198.18.${n}.2`;const phone=`+1999${String(randomInt(1000000,9999999))}`;let code='';
  const store=new PostgresPhoneAuthStore(pool);const service=new PhoneAuthService(store,crypto,{send:async(_phone,value)=>{code=value;}},phoneAuthAccounts);
  const request:PhoneRequest={phone,intent:'register',installationId:`${prefix}-${n}`,platform:'web',deviceName:'Fixture Browser'};
  requestIps.push(requestIp);installations.push(request.installationId);
  return {store,service,request,ip:requestIp,code:()=>code,phoneHash:crypto.hash('phone',phone)};
}
async function verify(f:ReturnType<typeof fixture>,challenge:Awaited<ReturnType<PhoneAuthService['request']>>,code=f.code()){
  const session=await f.service.verify({challengeId:challenge.challengeId,challengeSecret:challenge.challengeSecret,code,installationId:f.request.installationId},f.ip);madeUsers.push(session.user.id);return session;
}
cases('owned isolated PostgreSQL phone authentication',()=>{
  beforeAll(async()=>{
    await pool.query(`create table if not exists public.welcome_offer_accounts(user_id uuid primary key references public.users(id) on delete cascade,campaign text not null,created_at timestamptz not null default now());
      create table if not exists public.referral_codes(user_id uuid primary key references public.users(id),code text unique not null,created_at timestamptz not null default now());
      create table if not exists public.referral_attributions(invitee_user_id uuid primary key references public.users(id),referrer_user_id uuid not null references public.users(id),created_at timestamptz not null default now())`);
  });
  afterAll(async()=>{
    const ids=[...new Set(madeUsers)];
    await pool.query('delete from public.device_login_requests where id=any($1::uuid[])',[madeRequests]);
    if(ids.length){await pool.query('delete from public.referral_attributions where invitee_user_id=any($1::uuid[]) or referrer_user_id=any($1::uuid[])',[ids]);await pool.query('delete from public.referral_codes where user_id=any($1::uuid[])',[ids]);await pool.query('delete from public.phone_auth_identities where user_id=any($1::uuid[])',[ids]);await pool.query('delete from public.users where id=any($1::uuid[])',[ids]);}
    await pool.query('delete from public.phone_auth_challenges where phone_hash=any($1::text[])',[phones]);
    await pool.query('delete from public.registration_ip_lifetime_quota where ip_hash=any($1::text[])',[requestIps.map(ip=>registrationIpHash(ip,registrationGuardSecret))]);
    await pool.query('delete from public.registration_installation_claims where installation_hash=any($1::text[])',[installations.map(id=>registrationInstallationHash(id,registrationGuardSecret))]);await pool.end();
  });
  const phones:string[]=[];
  it('creates one account/trial job and authenticates the same phone without another trial',async()=>{
    const f=fixture();phones.push(f.phoneHash);const c=await f.service.request(f.request,f.ip);const first=await verify(f,c);
    expect(first.kryptoniteCode).toBeNull();expect(first.user.kryptoniteCode).toBeNull();
    await pool.query("update public.phone_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1",[c.challengeId]);
    const second=await verify(f,await f.service.request({...f.request,intent:'register'},f.ip));expect(second.user.id).toBe(first.user.id);
    expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=$1',[first.user.id])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int as n from public.welcome_offer_accounts where user_id=$1 and campaign='welcome-monthly-50-v1'",[first.user.id])).rows[0].n).toBe(1);
    expect((await pool.query('select auth_method from public.device_sessions where user_id=$1',[first.user.id])).rows.every((r:{auth_method:string})=>r.auth_method==='phone_otp')).toBe(true);
  });
  it.each(['web','android_tv','android_phone','macos','windows'] as const)('records the original verified registration platform %s without changing it on later login',async platform=>{
    const f=fixture();f.request.platform=platform;phones.push(f.phoneHash);const challenge=await f.service.request(f.request,f.ip);const session=await verify(f,challenge);
    const metadata=async()=>(await pool.query("select to_jsonb(u)->>'registration_method' as method,to_jsonb(u)->>'registration_platform' as platform from public.users u where id=$1",[session.user.id])).rows[0];
    expect(await metadata()).toEqual({method:'phone_otp',platform});
    const detail=await getAdminUserDetail(session.user.id);expect(detail.registration).toEqual({method:'phone_otp',platform,createdAt:expect.anything()});
    await pool.query("update public.phone_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1",[challenge.challengeId]);
    const next=await verify(f,await f.service.request({...f.request,intent:'login',platform:platform==='web'?'android_tv':'web'},f.ip));
    expect(next.user.id).toBe(session.user.id);expect(await metadata()).toEqual({method:'phone_otp',platform});
  });
  it('reports historical registration as unknown instead of inferring the most recent login',async()=>{
    const owner=(await pool.query("insert into public.users(code_lookup,code_hash,code_suffix,status) values($1,'fixture','OLD','active') returning id,created_at",[`${prefix}-historical-metadata`])).rows[0];madeUsers.push(owner.id);
    await pool.query("insert into public.device_sessions(user_id,platform,refresh_token_hash,expires_at,auth_method) values($1,'android_tv','fixture',null,'account_code')",[owner.id]);
    const detail=await getAdminUserDetail(owner.id);expect(detail.registration).toEqual({method:null,platform:null,createdAt:owner.created_at});
  });
  it('pins a new phone registration to its referral without changing attribution on a later login',async()=>{
    const referrers:string[]=[];const codes=['BCDFGHJKMNPQ','BCDFGHJKMNPR'];
    for(const code of codes){const id=(await pool.query("insert into public.users(code_lookup,code_hash,code_suffix,status) values($1,'fixture','REF','active') returning id",[`${prefix}-${code}`])).rows[0].id;madeUsers.push(id);referrers.push(id);await pool.query('insert into public.referral_codes(user_id,code) values($1,$2)',[id,code]);}
    const f=fixture();phones.push(f.phoneHash);const challenge=await f.service.request({...f.request,referralCode:codes[0]},f.ip);const session=await verify(f,challenge);
    expect((await pool.query('select referrer_user_id from public.referral_attributions where invitee_user_id=$1',[session.user.id])).rows).toEqual([{referrer_user_id:referrers[0]}]);
    await pool.query("update public.phone_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1",[challenge.challengeId]);
    const again=await verify(f,await f.service.request({...f.request,intent:'register',referralCode:codes[1]},f.ip));expect(again.user.id).toBe(session.user.id);
    expect((await pool.query('select referrer_user_id from public.referral_attributions where invitee_user_id=$1',[session.user.id])).rows).toEqual([{referrer_user_id:referrers[0]}]);
    expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=$1',[session.user.id])).rows[0].n).toBe(1);
  });
  it.each(['missing','blocked','deleted'] as const)('rejects a %s referral without creating a trial or leaving the verified challenge reusable',async state=>{
    const referralCode={missing:'BCDFGHJKMNPT',blocked:'BCDFGHJKMNPU',deleted:'BCDFGHJKMNPV'}[state];
    if(state!=='missing'){
      const id=(await pool.query("insert into public.users(code_lookup,code_hash,code_suffix,status,deleted_at) values($1,'fixture','REF',$2,$3) returning id",[`${prefix}-${state}`,state==='blocked'?'blocked':'active',state==='deleted'?new Date():null])).rows[0].id;madeUsers.push(id);
      await pool.query('insert into public.referral_codes(user_id,code) values($1,$2)',[id,referralCode]);
    }
    const f=fixture();phones.push(f.phoneHash);const challenge=await f.service.request({...f.request,referralCode},f.ip);
    await expect(verify(f,challenge)).rejects.toMatchObject({statusCode:400,reason:'invalid_referral_code'});
    expect((await pool.query('select count(*)::int as n from public.users where registration_installation_id=$1',[f.request.installationId])).rows[0].n).toBe(0);
    expect((await pool.query('select state from public.phone_auth_challenges where id=$1',[challenge.challengeId])).rows[0].state).toBe('consumed');
    await pool.query('delete from public.referral_codes where code=$1',[referralCode]);
  });
  it('commits bad-code attempts even though the service rejects after the transaction',async()=>{
    const f=fixture();phones.push(f.phoneHash);const c=await f.service.request(f.request,f.ip);const wrong=f.code()==='000000'?'111111':'000000';
    for(let i=0;i<5;i++)await expect(verify(f,c,wrong)).rejects.toMatchObject({reason:'invalid_or_expired'});
    const row=(await pool.query('select attempts,state,context_ciphertext from public.phone_auth_challenges where id=$1',[c.challengeId])).rows[0];expect(row).toMatchObject({attempts:5,state:'consumed',context_ciphertext:null});
    await expect(verify(f,c)).rejects.toMatchObject({reason:'invalid_or_expired'});
  });
  it('lets exactly one concurrent verification create the account and session',async()=>{
    const f=fixture();phones.push(f.phoneHash);const c=await f.service.request(f.request,f.ip);const results=await Promise.allSettled([verify(f,c),verify(f,c)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    const row=(await pool.query('select user_id from public.phone_auth_identities where phone_hash=$1',[f.phoneHash])).rows[0];expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=$1',[row.user_id])).rows[0].n).toBe(1);
  });
  it('expires old challenges, binds installation/IP, and invalidates old codes on resend',async()=>{
    const f=fixture();phones.push(f.phoneHash);const c=await f.service.request(f.request,f.ip);const old=f.code();
    await expect(f.service.verify({challengeId:c.challengeId,challengeSecret:c.challengeSecret,code:old,installationId:'different-installation'},f.ip)).rejects.toMatchObject({reason:'invalid_or_expired'});
    await expect(f.service.verify({challengeId:c.challengeId,challengeSecret:c.challengeSecret,code:old,installationId:f.request.installationId},'198.18.255.2')).rejects.toMatchObject({reason:'invalid_or_expired'});
    await pool.query("update public.phone_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1",[c.challengeId]);const next=await f.service.request(f.request,f.ip);
    await expect(verify(f,c,old)).rejects.toMatchObject({reason:'invalid_or_expired'});
    await pool.query("update public.phone_auth_challenges set expires_at=clock_timestamp()-interval '1 second' where id=$1",[next.challengeId]);await expect(verify(f,next)).rejects.toMatchObject({reason:'invalid_or_expired'});
  });
  it('consumes an authenticated unknown login without silently registering a free trial',async()=>{
    const f=fixture();phones.push(f.phoneHash);const c=await f.service.request({...f.request,intent:'login'},f.ip);await expect(verify(f,c)).rejects.toMatchObject({reason:'registration_required'});
    expect((await pool.query('select count(*)::int as n from public.phone_auth_identities where phone_hash=$1',[f.phoneHash])).rows[0].n).toBe(0);
    expect((await pool.query('select state from public.phone_auth_challenges where id=$1',[c.challengeId])).rows[0].state).toBe('consumed');
  });
  it('preserves a paid existing account while binding its phone and refuses cross-account merges',async()=>{
    const code='TESTPAIDCODE1234';const owner=(await pool.query("insert into public.users(code_lookup,code_hash,code_suffix,kryptonite_code,status) values($1,$2,'1234',$3,'active') returning id",[createCodeLookup(code),await hashSecret(code),code])).rows[0].id;madeUsers.push(owner);
    const pkg=(await pool.query("select id from public.packages where slug='1-ay'")).rows[0].id;
    await pool.query("insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id) values($1,$2,'active',now(),now()+interval '31 days','fixture')",[owner,pkg]);
    const before=(await pool.query('select id,ends_at,status from public.subscriptions where user_id=$1',[owner])).rows;
    const f=fixture();phones.push(f.phoneHash);const c=await f.service.request({...f.request,existingCode:code},f.ip);const session=await verify(f,c);expect(session.user.id).toBe(owner);expect((await pool.query("select to_jsonb(u)->>'registration_method' as method,to_jsonb(u)->>'registration_platform' as platform from public.users u where id=$1",[owner])).rows[0]).toEqual({method:null,platform:null});expect((await pool.query('select id,ends_at,status from public.subscriptions where user_id=$1',[owner])).rows).toEqual(before);expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=$1',[owner])).rows[0].n).toBe(0);
    expect((await pool.query('select count(*)::int as n from public.welcome_offer_accounts where user_id=$1',[owner])).rows[0].n).toBe(0);
    const other=fixture();phones.push(other.phoneHash);const otherSession=await verify(other,await other.service.request(other.request,other.ip));
    await pool.query("update public.phone_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where phone_hash=$1",[other.phoneHash]);
    const conflict=await other.service.request({...other.request,existingCode:code},other.ip);await expect(verify(other,conflict)).rejects.toMatchObject({reason:'account_conflict'});
    expect((await pool.query('select user_id from public.phone_auth_identities where phone_hash=$1',[other.phoneHash])).rows[0].user_id).toBe(otherSession.user.id);
  });
  it('retains the permanent two-account IP limit inside phone registration',async()=>{
    const ip='198.19.254.99';
    for(let i=0;i<2;i++){const f=fixture(ip);phones.push(f.phoneHash);await verify(f,await f.service.request(f.request,ip));}
    const third=fixture(ip);phones.push(third.phoneHash);const c=await third.service.request(third.request,ip);await expect(verify(third,c)).rejects.toMatchObject({reason:'registration_ip_limit'});expect((await pool.query('select count(*)::int as n from public.phone_auth_identities where phone_hash=$1',[third.phoneHash])).rows[0].n).toBe(0);
  });
  it('does not grant another trial to a different phone on a previously registered installation',async()=>{
    const first=fixture();phones.push(first.phoneHash);await verify(first,await first.service.request(first.request,first.ip));
    const second=fixture();phones.push(second.phoneHash);second.request.installationId=first.request.installationId;
    const challenge=await second.service.request(second.request,second.ip);await expect(verify(second,challenge)).rejects.toMatchObject({reason:'installation_limit'});
    expect((await pool.query('select count(*)::int as n from public.phone_auth_identities where phone_hash=$1',[second.phoneHash])).rows[0].n).toBe(0);
    expect((await pool.query('select state from public.phone_auth_challenges where id=$1',[challenge.challengeId])).rows[0].state).toBe('consumed');
  });
  it('lets a verified phone session approve QR pairing but keeps linked-viewer sessions untrusted',async()=>{
    const f=fixture();phones.push(f.phoneHash);const session=await verify(f,await f.service.request(f.request,f.ip));const userId=session.user.id,sessionId=session.refreshToken.split('.')[0];
    const store=new DeviceLoginStore(pool);const requestId=randomUUID(),code=randomUUID().replace(/-/g,'').toUpperCase().slice(0,8);madeRequests.push(requestId);
    await store.start({id:requestId,code,verifier:'fixture-proof',installationHash:null,deviceName:'Fixture TV',platform:'android_tv'});
    expect((await store.lookup(code,{userId,sessionId,authMethod:'phone_otp'})).id).toBe(requestId);
    const linkedId=(await pool.query("insert into public.device_sessions(user_id,device_name,platform,refresh_token_hash,expires_at,auth_method) values($1,'Fixture linked','web','fixture',now()+interval '1 day','device_link') returning id",[userId])).rows[0].id;
    await expect(store.lookup(code,{userId,sessionId:linkedId,authMethod:'phone_otp'})).rejects.toMatchObject({reason:'reauthentication_required'});
  });
});
