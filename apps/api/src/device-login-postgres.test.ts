import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { DeviceLoginStore, type PhoneIdentity } from './device-login-store.js';
import { DeviceLoginCrypto, DeviceLoginService, type PreparedDeviceSession } from './device-login.js';

const url = process.env.DEVICE_LOGIN_TEST_DATABASE_URL;
const schema = `device_login_test_${randomUUID().replaceAll('-','')}`;
describe.skipIf(!url)('device linking real PostgreSQL authority', () => {
  let pool: Pool; let store: DeviceLoginStore; let service: DeviceLoginService; let owner: PhoneIdentity;
  const crypto = new DeviceLoginCrypto('dummy-postgres-test-key');
  const table = (name: string) => `"${schema}".${name}`;
  const prepare = async (): Promise<PreparedDeviceSession> => { const id=randomUUID();return {id,refreshHash:'dummy-scrypt-hash',accessToken:`dummy-access-${id}`,refreshToken:`${id}.dummy-refresh`}; };
  async function account() {
    const userId=randomUUID(),sessionId=randomUUID();
    await pool.query(`insert into ${table('users')} (id,status,code_suffix) values ($1,'active','ABCD')`,[userId]);
    await pool.query(`insert into ${table('device_sessions')} (id,user_id,refresh_token_hash,expires_at) values ($1,$2,'dummy',clock_timestamp()+interval '1 day')`,[sessionId,userId]);
    return {userId,sessionId,authMethod:'account_code'};
  }
  async function start() { return service.start({platform:'web',deviceName:'Fixture browser',installationId:randomUUID()},'dummy-ip'); }
  async function issue() {
    const challenge=await start(); const phone=await service.lookup(challenge.userCode,owner,'dummy-phone');
    await service.decision({requestId:challenge.requestId,userCode:challenge.userCode,approvalNonce:phone.approvalNonce!,action:'approve'},owner,'dummy-phone');
    const delivery=await service.target('token',challenge);
    return {challenge,session:(delivery as any).session};
  }
  const rows = async (id: string) => (await pool.query(`select * from ${table('device_sessions')} where family_id=$1`,[id])).rows;
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:12});
    await pool.query(`create schema "${schema}"`);
    await pool.query(`create table ${table('users')} (id uuid primary key,status text not null,deleted_at timestamptz,code_suffix text);
      create table ${table('device_sessions')} (id uuid primary key,user_id uuid references ${table('users')}(id) on delete cascade,
      device_name text,platform text,refresh_token_hash text not null,expires_at timestamptz not null,revoked_at timestamptz,
      created_at timestamptz default clock_timestamp(),last_seen_at timestamptz default clock_timestamp());`);
    const migration=await readFile(new URL('../../../supabase/migrations/202611030001_device_login.sql',import.meta.url),'utf8');
    await pool.query(migration.replaceAll('public.',`"${schema}".`));
    store=new DeviceLoginStore(pool,schema); service=new DeviceLoginService(store,crypto,prepare);
  });
  beforeEach(async()=>{ await pool.query(`truncate ${table('device_login_requests')},${table('device_login_rates')},${table('device_sessions')},${table('users')} cascade`);owner=await account(); });
  afterAll(async()=>{ if(pool){await pool.query(`drop schema if exists "${schema}" cascade`);await pool.end();} });
  it('issues exactly one family under simultaneous approvals and replays identical delivery',async()=>{
    const challenge=await start(); const phone=await service.lookup(challenge.userCode,owner,'phone');
    const input={requestId:challenge.requestId,userCode:challenge.userCode,approvalNonce:phone.approvalNonce!,action:'approve' as const};
    const decisions=await Promise.allSettled([service.decision(input,owner,'phone'),service.decision(input,owner,'phone')]);
    expect(decisions.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await rows(challenge.requestId)).toHaveLength(1);
    const first=await service.target('token',challenge);
    await pool.query(`update ${table('device_login_requests')} set next_poll_at=null where id=$1`,[challenge.requestId]);
    expect(await service.target('token',challenge)).toEqual(first);
    expect((first as any).session.user).toEqual({id:owner.userId,codeSuffix:'ABCD'});
  });
  it('rolls back the issued session when envelope persistence fails',async()=>{
    const challenge=await start();
    await expect(store.decision(challenge.requestId,challenge.userCode,owner,'approve',await prepare(),()=>{throw new Error('dummy failure');})).rejects.toThrow('dummy failure');
    expect(await rows(challenge.requestId)).toHaveLength(0);
    expect((await store.lookup(challenge.userCode,owner)).state).toBe('pending');
  });
  it('rejects wrong proof, nonce, account and linked approvers',async()=>{
    const {challenge}=await issue();
    await expect(service.target('token',{...challenge,deviceSecret:crypto.secret()})).rejects.toMatchObject({statusCode:404});
    await expect(service.lookup(challenge.userCode,await account(),'other')).rejects.toMatchObject({statusCode:409});
    await expect(service.lookup(challenge.userCode,{...owner,authMethod:'device_link'},'other')).rejects.toMatchObject({reason:'reauthentication_required'});
    await expect(service.decision({requestId:challenge.requestId,userCode:challenge.userCode,approvalNonce:'bad',action:'approve'},owner,'phone')).rejects.toMatchObject({reason:'invalid_nonce'});
  });
  it('preserves an approved delivery through phone refresh and public expiry, then expires undelivered issuance',async()=>{
    const {challenge}=await issue();
    await pool.query(`update ${table('device_sessions')} set revoked_at=clock_timestamp() where id=$1`,[owner.sessionId]);
    await pool.query(`update ${table('device_login_requests')} set expires_at=clock_timestamp()-interval '1 second',next_poll_at=null where id=$1`,[challenge.requestId]);
    expect((await service.target('token',challenge)).status).toBe('authorized');
    await pool.query(`update ${table('device_login_requests')} set delivery_expires_at=clock_timestamp()-interval '1 second' where id=$1`,[challenge.requestId]);
    await store.cleanup();
    expect((await service.target('token',challenge)).status).toBe('expired');
    expect((await rows(challenge.requestId)).every((r:any)=>r.revoked_at)).toBe(true);
  });
  it('first authenticated use recovers lost ACK and survives cleanup and late cancel',async()=>{
    const {challenge,session}=await issue(); const sid=session.refreshToken.split('.')[0];
    expect(await store.activate(owner.userId,sid,challenge.requestId)).toBe(true);
    await pool.query(`update ${table('device_login_requests')} set delivery_expires_at=clock_timestamp()-interval '1 day' where id=$1`,[challenge.requestId]);
    await store.cleanup();
    expect(await service.target('ack',challenge)).toEqual({status:'complete'});
    expect(await service.target('cancel',challenge)).toEqual({status:'complete'});
    expect((await rows(challenge.requestId))[0].revoked_at).toBeNull();
    expect((await pool.query(`select envelope from ${table('device_login_requests')} where id=$1`,[challenge.requestId])).rows[0].envelope).toBeNull();
  });
  it('serializes concurrent refresh and preserves provenance/family while revocation reaches descendants',async()=>{
    const {challenge,session}=await issue(); const sid=session.refreshToken.split('.')[0];
    const results=await Promise.all([store.refresh(owner.userId,sid,challenge.requestId,await prepare()),store.refresh(owner.userId,sid,challenge.requestId,await prepare())]);
    expect(results.sort()).toEqual([false,true]);
    const family=await rows(challenge.requestId);expect(family).toHaveLength(2);
    expect(family.every((r:any)=>r.auth_method==='device_link'&&r.family_id===challenge.requestId)).toBe(true);
    await store.revokeLinkedSession(owner.userId,sid,challenge.requestId);
    expect((await rows(challenge.requestId)).every((r:any)=>r.revoked_at)).toBe(true);
  });
  it('a refresh waiting behind cancellation cannot mint an active descendant',async()=>{
    const {challenge,session}=await issue(); const sid=session.refreshToken.split('.')[0];
    const blocker=await pool.connect();await blocker.query('begin');
    await blocker.query(`select id from ${table('device_login_requests')} where id=$1 for update`,[challenge.requestId]);
    const refresh=store.refresh(owner.userId,sid,challenge.requestId,await prepare());
    await blocker.query(`update ${table('device_login_requests')} set state='cancelled',envelope=null where id=$1`,[challenge.requestId]);
    await blocker.query(`update ${table('device_sessions')} set revoked_at=clock_timestamp() where family_id=$1`,[challenge.requestId]);
    await blocker.query('commit');blocker.release();
    expect(await refresh).toBe(false);expect(await rows(challenge.requestId)).toHaveLength(1);
  });
  it('cancel versus authenticated activation has one consistent winner',async()=>{
    const {challenge,session}=await issue(); const sid=session.refreshToken.split('.')[0];
    const [cancel,activated]=await Promise.all([service.target('cancel',challenge),store.activate(owner.userId,sid,challenge.requestId)]);
    expect(activated).toBe(cancel.status==='complete');
    expect(Boolean((await rows(challenge.requestId))[0].revoked_at)).toBe(!activated);
  });
  it('rejects blocked/deleted owners after precomputation and enforces the user lock before issuance',async()=>{
    const challenge=await start();await store.validateDecision(challenge.requestId,challenge.userCode,owner);
    const blocker=await pool.connect();await blocker.query('begin');
    await blocker.query(`update ${table('users')} set status='blocked',deleted_at=clock_timestamp() where id=$1`,[owner.userId]);
    const approval=store.decision(challenge.requestId,challenge.userCode,owner,'approve',await prepare(),()=> 'dummy');
    const observed=approval.then(()=> 'unexpected', (error:any)=>error.statusCode);
    await blocker.query('commit');blocker.release();
    expect(await observed).toBe(403);expect(await rows(challenge.requestId)).toHaveLength(0);
  });
  it('expires pending requests and applies shared installation and polling limits',async()=>{
    const challenge=await start(); expect((await service.target('token',challenge)).status).toBe('pending');
    expect(await service.target('token',challenge)).toMatchObject({status:'slow_down',intervalSeconds:7});
    await pool.query(`update ${table('device_login_requests')} set expires_at=clock_timestamp()-interval '1 second' where id=$1`,[challenge.requestId]);
    expect((await service.target('token',challenge)).status).toBe('expired');
    const installationId=randomUUID();
    const starts=await Promise.allSettled(Array.from({length:6},()=>service.start({platform:'web',deviceName:'dummy',installationId},'same-ip')));
    expect(starts.filter(r=>r.status==='fulfilled')).toHaveLength(5);
  });
  it('keeps the phone nonce valid across ordinary owner session rotation',async()=>{
    const challenge=await start();const phone=await service.lookup(challenge.userCode,owner,'phone');
    const replacement=randomUUID();
    await pool.query(`update ${table('device_sessions')} set revoked_at=clock_timestamp() where id=$1`,[owner.sessionId]);
    await pool.query(`insert into ${table('device_sessions')} (id,user_id,refresh_token_hash,expires_at) values ($1,$2,'dummy',clock_timestamp()+interval '1 day')`,[replacement,owner.userId]);
    const refreshed={...owner,sessionId:replacement};
    expect(await service.decision({requestId:challenge.requestId,userCode:challenge.userCode,approvalNonce:phone.approvalNonce!,action:'approve'},refreshed,'phone')).toEqual({status:'approved'});
  });
  it('cancel racing approval leaves no active unacknowledged session',async()=>{
    const challenge=await start();const phone=await service.lookup(challenge.userCode,owner,'phone');
    await Promise.allSettled([
      service.decision({requestId:challenge.requestId,userCode:challenge.userCode,approvalNonce:phone.approvalNonce!,action:'approve'},owner,'phone'),
      service.target('cancel',challenge)
    ]);
    expect((await service.target('token',challenge)).status).toBe('cancelled');
    expect((await rows(challenge.requestId)).every((r:any)=>r.revoked_at)).toBe(true);
  });
  it('shares rate buckets across independent store instances',async()=>{
    const second=new DeviceLoginStore(pool,schema);
    const results=await Promise.allSettled([store.rate('dummy-rate',1),second.rate('dummy-rate',1)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
});
