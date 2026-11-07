import type { pool as sharedPool } from './db.js';
import { PhoneAuthError, phoneHashesMatch, type PhoneAuthStore, type PhoneConsumeResult, type PhoneReservation, type PhoneSession, type PhoneVerification,type PhoneTransaction } from './phone-auth.js';

export class PostgresPhoneAuthStore implements PhoneAuthStore {
  constructor(private pool:typeof sharedPool){}
  private async transaction<T>(run:(client:PhoneTransaction)=>Promise<T>){const client=await this.pool.connect();try{await client.query('begin');const result=await run(client);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}finally{client.release();}}
  private async rate(client:PhoneTransaction,key:string,limit:number,windowSeconds:number){
    const result=await client.query(`insert into public.phone_auth_rates as r(key_hash,window_start,hits) values($1,clock_timestamp(),1)
      on conflict(key_hash) do update set hits=case when r.window_start<=clock_timestamp()-make_interval(secs=>$2::integer) then 1 else r.hits+1 end,
      window_start=case when r.window_start<=clock_timestamp()-make_interval(secs=>$2::integer) then clock_timestamp() else r.window_start end,updated_at=clock_timestamp() returning hits`,[key,windowSeconds]);
    return result.rows[0].hits<=limit;
  }
  async reserve(input:PhoneReservation){
    const outcome=await this.transaction(async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-auth:${input.phoneHash}`]);
      let allowed=true;
      for(const row of [...input.rateKeys].sort((a,b)=>a.key.localeCompare(b.key)))if(!await this.rate(client,row.key,row.limit,row.windowSeconds))allowed=false;
      if(!allowed)return 'rate_limited';
      const recent=await client.query(`select 1 from public.phone_auth_challenges where phone_hash=$1 and created_at>clock_timestamp()-interval '60 seconds' limit 1`,[input.phoneHash]);
      if(recent.rowCount)return 'resend_cooldown';
      await client.query(`update public.phone_auth_challenges set state='superseded',context_ciphertext=null where phone_hash=$1 and state in('pending','accepted')`,[input.phoneHash]);
      await client.query(`insert into public.phone_auth_challenges(id,phone_hash,masked_phone,otp_hash,secret_hash,installation_hash,ip_hash,context_ciphertext) values($1,$2,$3,$4,$5,$6,$7,$8)`,[input.id,input.phoneHash,input.maskedPhone,input.otpHash,input.secretHash,input.installationHash,input.ipHash,input.context]);
      return null;
    });
    if(outcome)throw new PhoneAuthError(429,outcome,60);
  }
  async delivery(id:string,accepted:boolean){await this.pool.query(`update public.phone_auth_challenges set state=$2,context_ciphertext=case when $2='failed' then null else context_ciphertext end where id=$1 and state='pending'`,[id,accepted?'accepted':'failed']);}
  async rateVerify(key:string){const allowed=await this.transaction(client=>this.rate(client,key,30,60));if(!allowed)throw new PhoneAuthError(429,'rate_limited',60);}
  async consume(input:PhoneVerification,finalize:(client:PhoneTransaction,context:string,phoneHash:string,maskedPhone:string,existingUserId:string|null)=>Promise<PhoneSession>):Promise<PhoneConsumeResult>{
    return this.transaction(async(client)=>{
      const selected=await client.query('select phone_hash from public.phone_auth_challenges where id=$1',[input.id]);
      if(!selected.rows[0])return {reason:'invalid_or_expired',statusCode:400};
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-auth:${selected.rows[0].phone_hash}`]);
      const response=await client.query('select * from public.phone_auth_challenges where id=$1 for update',[input.id]);const row=response.rows[0];
      const clock=await client.query('select clock_timestamp() as now');const now=clock.rows[0].now;
      if(!row||row.state!=='accepted'||row.attempts>=5||row.expires_at<=now||!row.context_ciphertext)return {reason:'invalid_or_expired',statusCode:400};
      const valid=phoneHashesMatch(input.secretHash,row.secret_hash)&&phoneHashesMatch(input.installationHash,row.installation_hash)&&phoneHashesMatch(input.ipHash,row.ip_hash)&&phoneHashesMatch(input.otpHash,row.otp_hash);
      if(!valid){await client.query(`update public.phone_auth_challenges set attempts=attempts+1,state=case when attempts+1>=5 then 'consumed' else state end,context_ciphertext=case when attempts+1>=5 then null else context_ciphertext end where id=$1`,[input.id]);return {reason:'invalid_or_expired',statusCode:400};}
      const identity=await client.query('select user_id from public.phone_auth_identities where phone_hash=$1',[row.phone_hash]);
      await client.query('savepoint phone_account_resolution');
      try{
        const session=await finalize(client,row.context_ciphertext,row.phone_hash,row.masked_phone,identity.rows[0]?.user_id??null);
        await client.query(`update public.phone_auth_challenges set state='consumed',context_ciphertext=null,consumed_at=clock_timestamp() where id=$1`,[input.id]);
        await client.query('release savepoint phone_account_resolution');return {session};
      }catch(error){
        if(!(error instanceof PhoneAuthError))throw error;
        await client.query('rollback to savepoint phone_account_resolution');
        await client.query(`update public.phone_auth_challenges set state='consumed',context_ciphertext=null,consumed_at=clock_timestamp() where id=$1`,[input.id]);
        return {reason:error.reason,statusCode:error.statusCode};
      }
    });
  }
  async cleanup(){
    await this.transaction(async(client)=>{
      await client.query(`update public.phone_auth_challenges set context_ciphertext=null where id in(select id from public.phone_auth_challenges where expires_at<=clock_timestamp() and context_ciphertext is not null limit 100 for update skip locked)`);
      await client.query(`delete from public.phone_auth_challenges where id in(select id from public.phone_auth_challenges where created_at<clock_timestamp()-interval '1 day' limit 100 for update skip locked)`);
      await client.query(`delete from public.phone_auth_rates where key_hash in(select key_hash from public.phone_auth_rates where updated_at<clock_timestamp()-interval '1 day' limit 100 for update skip locked)`);
    });
  }
}
