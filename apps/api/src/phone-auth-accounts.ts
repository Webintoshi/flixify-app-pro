import { randomUUID } from 'node:crypto';
import { createCodeLookup,generateKryptoniteCode,generateRefreshToken,hashSecret,signAccessToken,verifySecret } from './security.js';
import { createUserInTransaction,findUserByCodeLookup } from './repository.js';
import { AutoTrialRegistrationRateLimitError,RegistrationInstallationLimitError } from './registration-limits.js';
import { PhoneAuthError,type PhoneAuthOwner,type PhoneContext,type PhoneSession,type PhoneTransaction } from './phone-auth.js';

export const phoneAuthAccounts={
  async existingAccount(code:string|undefined,owner:PhoneAuthOwner|undefined){
    if(code){
      const user=await findUserByCodeLookup(createCodeLookup(code));
      if(!user||user.status==='blocked'||!await verifySecret(code,user.code_hash))throw new PhoneAuthError(401,'existing_account_unverified');
      if(owner&&owner.userId!==user.id)throw new PhoneAuthError(409,'account_conflict');
      return {userId:user.id};
    }
    if(owner){
      if(owner.authMethod!=='account_code'&&owner.authMethod!=='phone_otp')throw new PhoneAuthError(403,'reauthentication_required');
      return {userId:owner.userId,sessionId:owner.sessionId};
    }
    return null;
  },
  async resolve(client:PhoneTransaction,context:PhoneContext,phoneHash:string,maskedPhone:string,existingUserId:string|null):Promise<PhoneSession>{
    if(existingUserId&&context.pendingUserId&&existingUserId!==context.pendingUserId)throw new PhoneAuthError(409,'account_conflict');
    let userId=existingUserId??context.pendingUserId;
    if(context.pendingSessionId){
      const proof=await client.query(`select id from public.device_sessions where id=$1 and user_id=$2 and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()) and auth_method in('account_code','phone_otp')`,[context.pendingSessionId,context.pendingUserId]);
      if(!proof.rows[0])throw new PhoneAuthError(403,'reauthentication_required');
    }
    if(!userId){
      if(context.intent!=='register')throw new PhoneAuthError(409,'registration_required');
      let code='';
      for(let attempt=0;attempt<5;attempt++){const candidate=generateKryptoniteCode();const existing=await client.query('select id from public.users where code_lookup=$1',[createCodeLookup(candidate)]);if(!existing.rowCount){code=candidate;break;}}
      if(!code)throw new PhoneAuthError(503,'temporarily_unavailable');
      try{userId=await createUserInTransaction(client,createCodeLookup(code),await hashSecret(code),code.slice(-4),code,context.installationId,context.requestIp,context.referralCode);}
      catch(error){if(error instanceof RegistrationInstallationLimitError)throw new PhoneAuthError(409,'installation_limit');if(error instanceof AutoTrialRegistrationRateLimitError)throw new PhoneAuthError(429,'registration_ip_limit');throw error;}
    }
    if(!userId)throw new PhoneAuthError(503,'temporarily_unavailable');
    const users=await client.query(`select id,code_suffix from public.users where id=$1 and status<>'blocked' and deleted_at is null for update`,[userId]);
    const user=users.rows[0];if(!user)throw new PhoneAuthError(403,'account_unavailable');
    const bound=await client.query('select phone_hash from public.phone_auth_identities where user_id=$1',[userId]);
    if(bound.rows[0]&&bound.rows[0].phone_hash!==phoneHash)throw new PhoneAuthError(409,'account_conflict');
    await client.query(`insert into public.phone_auth_identities(phone_hash,user_id,masked_phone) values($1,$2,$3) on conflict(phone_hash) do nothing`,[phoneHash,userId,maskedPhone]);
    const check=await client.query('select user_id from public.phone_auth_identities where phone_hash=$1',[phoneHash]);if(check.rows[0]?.user_id!==userId)throw new PhoneAuthError(409,'account_conflict');
    const sessionId=randomUUID(),refreshSecret=generateRefreshToken(),refreshHash=await hashSecret(refreshSecret);
    await client.query(`insert into public.device_sessions(id,user_id,device_name,platform,refresh_token_hash,expires_at,auth_method) values($1,$2,$3,$4,$5,null,'phone_otp')`,[sessionId,userId,context.deviceName,context.platform,refreshHash]);
    await client.query('update public.users set last_login_at=clock_timestamp() where id=$1',[userId]);
    return {accessToken:await signAccessToken({userId,sessionId}),refreshToken:`${sessionId}.${refreshSecret}`,kryptoniteCode:null,user:{id:userId,codeSuffix:user.code_suffix??null,kryptoniteCode:null}};
  }
};
