import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import type {pool as sharedPool,withTransaction} from './db.js';
import {DeviceLoginStore} from './device-login-store.js';
import type {PreparedDeviceSession} from './device-login.js';

type Transaction=Parameters<Parameters<typeof withTransaction>[0]>[0];
type AuthenticationMethod='account_code'|'phone_otp'|'device_link';
type RefreshContext={userId:string;predecessorId:string;successorId:string;authMethod:string;familyId:string|null};
type Credentials={accessToken:string;refreshToken:string};
type RefreshReason='invalid-refresh'|'revoked'|'expired'|'account-blocked'|'account-deleted';
export type RememberedRefresh={sessionId:string;userId:string;authMethod:AuthenticationMethod;familyId:string|null}&Credentials;
type Outcome=RememberedRefresh|{reason:RefreshReason;statusCode:401|403};
export class RememberedSessionError extends Error{
  constructor(public statusCode:401|403,public reason:RefreshReason){super('Oturum yenilenemedi.');}
}
export function sessionHasExpired(value:string|Date|null,now=Date.now()){
  if(value===null)return false;
  const expiresAt=value instanceof Date?value.getTime():new Date(value).getTime();
  return !Number.isFinite(expiresAt)||expiresAt<=now;
}
export class RememberedRefreshCrypto{
  private key:Buffer;
  constructor(secret:string){this.key=createHmac('sha256',secret).update('remembered-session-refresh:v1:encryption').digest();}
  private aad(context:RefreshContext){return Buffer.from(JSON.stringify([context.userId,context.predecessorId,context.successorId,context.authMethod,context.familyId]));}
  seal(context:RefreshContext,value:Credentials){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(this.aad(context));
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
  }
  open(context:RefreshContext,value:string):Credentials{
    const data=Buffer.from(value,'base64url');if(data.length<29)throw new Error('Invalid refresh recovery envelope');
    const decipher=createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));decipher.setAAD(this.aad(context));decipher.setAuthTag(data.subarray(12,28));
    const result=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
    if(typeof result?.accessToken!=='string'||result.accessToken.length>16000||typeof result?.refreshToken!=='string'||!result.refreshToken.startsWith(`${context.successorId}.`)||result.refreshToken.length>1000)throw new Error('Invalid refresh recovery credentials');
    return {accessToken:result.accessToken,refreshToken:result.refreshToken};
  }
}
export class RememberedSessionStore{
  private linked:DeviceLoginStore;
  constructor(private pool:typeof sharedPool,private crypto:RememberedRefreshCrypto,private schema='public'){
    if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw new Error('Invalid schema');this.linked=new DeviceLoginStore(pool,schema);
  }
  private table(name:string){return `"${this.schema}".${name}`;}
  private async transaction<T>(run:(client:Transaction)=>Promise<T>){
    const client=await this.pool.connect();try{await client.query('begin');const result=await run(client);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}finally{client.release();}
  }
  async rotate(input:{id:string;userId:string;refreshHash:string},prepared:PreparedDeviceSession):Promise<RememberedRefresh>{
    const outcome=await this.transaction<Outcome>(async client=>{
      const users=await client.query(`select status,deleted_at from ${this.table('users')} where id=$1 for share`,[input.userId]);const user=users.rows[0];
      if(!user||user.deleted_at)return {statusCode:403,reason:'account-deleted'};
      if(user.status==='blocked')return {statusCode:403,reason:'account-blocked'};
      const selected=await client.query(`select auth_method,family_id from ${this.table('device_sessions')} where id=$1 and user_id=$2`,[input.id,input.userId]);const metadata=selected.rows[0];
      if(!metadata)return {statusCode:401,reason:'invalid-refresh'};
      if(metadata.auth_method==='device_link'&&(!metadata.family_id||!await this.linked.guardRememberedRefresh(client,input.userId,metadata.family_id)))return {statusCode:401,reason:'revoked'};
      const rows=await client.query(`select * from ${this.table('device_sessions')} where id=$1 and user_id=$2 for update`,[input.id,input.userId]);const old=rows.rows[0];
      const clock=await client.query('select clock_timestamp() as now');const now=clock.rows[0].now as Date;
      if(!old||old.refresh_token_hash!==input.refreshHash||!['account_code','phone_otp','device_link'].includes(old.auth_method))return {statusCode:401,reason:'invalid-refresh'};
      if(sessionHasExpired(old.expires_at,now.getTime()))return {statusCode:401,reason:'expired'};
      if(old.revoked_at){
        const recovery=await client.query(`select r.*,r.predecessor_revoked_at=s.revoked_at as same_revocation from ${this.table('session_refresh_rotations')} r join ${this.table('device_sessions')} s on s.id=r.predecessor_id where r.predecessor_id=$1`,[old.id]);const retry=recovery.rows[0];
        if(!retry||retry.revoked_at||!retry.same_revocation)return {statusCode:401,reason:'revoked'};
        if(retry.adopted_at&&retry.expires_at<=now||!retry.response_ciphertext)return {statusCode:401,reason:'invalid-refresh'};
        const successors=await client.query(`select s.*,exists(select 1 from ${this.table('session_refresh_rotations')} r where r.predecessor_id=s.id) as rotated from ${this.table('device_sessions')} s where s.id=$1 for update`,[retry.successor_id]);const child=successors.rows[0];
        const current=(await client.query(`select adopted_at,expires_at,revoked_at,response_ciphertext from ${this.table('session_refresh_rotations')} where predecessor_id=$1 for share`,[old.id])).rows[0];
        const finalClock=(await client.query('select clock_timestamp() as now')).rows[0].now as Date;
        if(!current||current.revoked_at)return {statusCode:401,reason:'revoked'};
        if(current.adopted_at&&current.expires_at<=finalClock||!current.response_ciphertext)return {statusCode:401,reason:'invalid-refresh'};
        if(!child||child.revoked_at||child.user_id!==input.userId||child.auth_method!==old.auth_method||child.family_id!==old.family_id||sessionHasExpired(child.expires_at,finalClock.getTime()))return {statusCode:401,reason:child?.rotated?'invalid-refresh':'revoked'};
        if(child.rotated)return {statusCode:401,reason:'invalid-refresh'};
        const credentials=this.crypto.open({userId:input.userId,predecessorId:old.id,successorId:child.id,authMethod:old.auth_method,familyId:old.family_id},current.response_ciphertext);
        return {sessionId:child.id,userId:input.userId,authMethod:child.auth_method,familyId:child.family_id,...credentials};
      }
      await this.markAdopted(client,old.id);
      await client.query(`update ${this.table('device_sessions')} set revoked_at=clock_timestamp() where id=$1`,[old.id]);
      await client.query(`insert into ${this.table('device_sessions')}(id,user_id,device_name,platform,refresh_token_hash,expires_at,auth_method,family_id) values($1,$2,$3,$4,$5,null,$6,$7)`,[prepared.id,input.userId,old.device_name,old.platform,prepared.refreshHash,old.auth_method,old.family_id]);
      const response=this.crypto.seal({userId:input.userId,predecessorId:old.id,successorId:prepared.id,authMethod:old.auth_method,familyId:old.family_id},{accessToken:prepared.accessToken,refreshToken:prepared.refreshToken});
      await client.query(`insert into ${this.table('session_refresh_rotations')}(predecessor_id,successor_id,predecessor_revoked_at,response_ciphertext) select id,$2,revoked_at,$3 from ${this.table('device_sessions')} where id=$1`,[old.id,prepared.id,response]);
      return {sessionId:prepared.id,userId:input.userId,authMethod:old.auth_method,familyId:old.family_id,accessToken:prepared.accessToken,refreshToken:prepared.refreshToken};
    });
    if('reason' in outcome)throw new RememberedSessionError(outcome.statusCode,outcome.reason);return outcome;
  }
  private async markAdopted(client:Pick<Transaction,'query'>,sessionId:string){
    await client.query(`update ${this.table('session_refresh_rotations')} r set adopted_at=clock_timestamp(),expires_at=clock_timestamp()+interval '60 seconds' where successor_id=$1 and adopted_at is null and response_ciphertext is not null and revoked_at is null and exists(select 1 from ${this.table('device_sessions')} s join ${this.table('users')} u on u.id=s.user_id where s.id=$1 and s.revoked_at is null and (s.expires_at is null or s.expires_at>clock_timestamp()) and u.deleted_at is null and u.status<>'blocked')`,[sessionId]);
  }
  async adopt(sessionId:string){await this.markAdopted(this.pool,sessionId);}
  async revoke(userId:string,sessionId:string){
    return this.transaction(async client=>{
      await client.query(`select id from ${this.table('users')} where id=$1 for update`,[userId]);
      const sessions=await client.query(`with recursive descendants as(select id from ${this.table('device_sessions')} where id=$1 and user_id=$2 union select r.successor_id from ${this.table('session_refresh_rotations')} r join descendants d on r.predecessor_id=d.id) select id from descendants`,[sessionId,userId]);
      const ids=sessions.rows.map((row:{id:string})=>row.id);if(!ids.length)throw new Error('Session not found');
      await client.query(`update ${this.table('device_sessions')} set revoked_at=coalesce(revoked_at,clock_timestamp()) where user_id=$1 and id=any($2::uuid[])`,[userId,ids]);
      await client.query(`update ${this.table('session_refresh_rotations')} set revoked_at=coalesce(revoked_at,clock_timestamp()),response_ciphertext=null where predecessor_id=any($1::uuid[]) or successor_id=any($1::uuid[])`,[ids]);
    });
  }
  async cleanup(){await this.pool.query(`update ${this.table('session_refresh_rotations')} r set response_ciphertext=null where predecessor_id in(select r.predecessor_id from ${this.table('session_refresh_rotations')} r join ${this.table('device_sessions')} child on child.id=r.successor_id where r.response_ciphertext is not null and ((r.adopted_at is not null and r.expires_at<=clock_timestamp()) or r.revoked_at is not null or child.revoked_at is not null or exists(select 1 from ${this.table('session_refresh_rotations')} next where next.predecessor_id=child.id)) limit 100 for update of r skip locked)`);}
}
