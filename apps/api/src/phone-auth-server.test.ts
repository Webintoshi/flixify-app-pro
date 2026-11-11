import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('dotenv',()=>({config:()=>({})}));
vi.hoisted(()=>Object.assign(process.env,{DATABASE_URL:'postgresql://127.0.0.1:1/dummy',APP_JWT_SECRET:'fixture-phone-server-jwt-key-000000000000000',REGISTRATION_GUARD_SECRET:'fixture-phone-server-registration-key-00000',ADMIN_EMAILS:'fixture@example.invalid',SUPABASE_URL:'http://127.0.0.1',SUPABASE_JWKS_URL:'http://127.0.0.1/jwks',APP_DEMO_MODE:'false',PHONE_AUTH_ENABLED:'false',EMAIL_AUTH_ENABLED:'false'}));
import * as repo from './repository.js';
import * as security from './security.js';
import { DeviceLoginStore } from './device-login-store.js';
import {RememberedSessionStore} from './remembered-session.js';
import { buildServer } from './server.js';
describe('phone session integration preserves credentials and trust',()=>{
 const app=buildServer();const userId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222',nextId='33333333-3333-4333-8333-333333333333';let bearer:string;
 const session={id:sessionId,user_id:userId,refresh_token_hash:'fixture-hash',device_name:'Fixture',platform:'web',auth_method:'phone_otp',family_id:null,revoked_at:null,expires_at:new Date(Date.now()+60000).toISOString()};
 beforeAll(async()=>{await app.ready();bearer=`Bearer ${await security.signAccessToken({userId,sessionId})}`;});
 beforeEach(()=>{
  vi.spyOn(repo,'getSessionById').mockResolvedValue(session as never);vi.spyOn(repo,'getUserStatus').mockResolvedValue('active');vi.spyOn(repo,'touchDeviceSession').mockResolvedValue(undefined);
  vi.spyOn(repo,'getUserContext').mockResolvedValue({summary:{id:userId,status:'active',kryptoniteCode:'PRIVATE-MASTER-SECRET',codeSuffix:'CRET'},isThreeHourTrial:false,accessUntil:null} as never);
  vi.spyOn(repo,'getAppSettings').mockResolvedValue({supportWhatsappUrl:null,supportTelegramUrl:null} as never);vi.spyOn(DeviceLoginStore.prototype,'activate').mockResolvedValue(true);
  vi.spyOn(repo,'createDeviceSession').mockResolvedValue(nextId);vi.spyOn(repo,'revokeSession').mockResolvedValue(undefined);vi.spyOn(security,'verifySecret').mockResolvedValue(true);vi.spyOn(security,'hashSecret').mockResolvedValue('fixture-new-hash');
  vi.spyOn(RememberedSessionStore.prototype,'rotate').mockImplementation(async(_input,prepared)=>({sessionId:prepared.id,userId,authMethod:'phone_otp',familyId:null,accessToken:prepared.accessToken,refreshToken:prepared.refreshToken}));
 });
 afterEach(()=>vi.restoreAllMocks());afterAll(async()=>app.close());
 it.each(['phone_otp','email_otp'] as const)('redacts the master code for %s without activating a QR session',async(authMethod)=>{
  vi.mocked(repo.getSessionById).mockResolvedValue({...session,auth_method:authMethod});
  const result=await app.inject({url:'/me',headers:{authorization:bearer}});expect(result.statusCode).toBe(200);expect(result.json().user.kryptoniteCode).toBeNull();expect(result.body).not.toContain('PRIVATE-MASTER-SECRET');expect(DeviceLoginStore.prototype.activate).not.toHaveBeenCalled();
 });
 it('preserves phone_otp after refresh and explicitly clears both old credential projections',async()=>{
  const result=await app.inject({method:'POST',url:'/auth/refresh',payload:{refreshToken:`${sessionId}.fixture-secret`}});expect(result.statusCode).toBe(200);expect(RememberedSessionStore.prototype.rotate).toHaveBeenCalledWith({id:sessionId,userId,refreshHash:'fixture-hash'},expect.objectContaining({refreshHash:'fixture-new-hash'}));expect(repo.createDeviceSession).not.toHaveBeenCalled();expect(result.json().kryptoniteCode).toBeNull();expect(result.json().user.kryptoniteCode).toBeNull();expect(result.body).not.toContain('PRIVATE-MASTER-SECRET');
 });
 it('keeps the phone feature unavailable until deliberately enabled',async()=>{
  const result=await app.inject({url:'/auth/phone/status'});expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({enabled:false,deliveryChannel:'whatsapp',reason:'not_configured'});
 });
 it('keeps email delivery unavailable until configured', async () => {
  const result = await app.inject({ url: '/auth/email/status' });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({ enabled: false, deliveryChannel: 'email', reason: 'not_configured' });
 });
});
