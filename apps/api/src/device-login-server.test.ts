import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('dotenv',()=>({config:()=>({})}));
vi.hoisted(()=>{
  Object.assign(process.env,{DATABASE_URL:'postgresql://127.0.0.1:1/dummy',APP_JWT_SECRET:'dummy-device-login-test-secret-at-least-32',REGISTRATION_GUARD_SECRET:'dummy-registration-secret-at-least-32',ADMIN_EMAILS:'dummy@example.test',SUPABASE_URL:'http://localhost',SUPABASE_JWKS_URL:'http://localhost/jwks',APP_DEMO_MODE:'false'});
});
import * as repo from './repository.js';
import * as security from './security.js';
import { DeviceLoginStore } from './device-login-store.js';
import { buildServer } from './server.js';

describe('linked viewer authentication integration',()=>{
  const app=buildServer();let bearer:string;
  const userId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222',familyId='33333333-3333-4333-8333-333333333333';
  const session={id:sessionId,user_id:userId,refresh_token_hash:'dummy-hash',device_name:'Fixture',platform:'web',auth_method:'device_link',family_id:familyId,revoked_at:null,expires_at:new Date(Date.now()+60_000).toISOString()};
  beforeAll(async()=>{await app.ready();bearer=`Bearer ${await security.signAccessToken({userId,sessionId})}`;});
  beforeEach(()=>{
    vi.spyOn(repo,'getSessionById').mockResolvedValue(session as never);
    vi.spyOn(repo,'getUserStatus').mockResolvedValue('active');
    vi.spyOn(repo,'touchDeviceSession').mockResolvedValue(undefined);
    vi.spyOn(repo,'getUserContext').mockResolvedValue({summary:{id:userId,status:'active',kryptoniteCode:'MASTER-ACCOUNT-CODE',codeSuffix:'CODE'}} as never);
    vi.spyOn(repo,'getAppSettings').mockResolvedValue({supportWhatsappUrl:null,supportTelegramUrl:null} as never);
    vi.spyOn(DeviceLoginStore.prototype,'activate').mockResolvedValue(true);
    vi.spyOn(DeviceLoginStore.prototype,'refresh').mockResolvedValue(true);
    vi.spyOn(security,'verifySecret').mockResolvedValue(true);
    vi.spyOn(security,'hashSecret').mockResolvedValue('dummy-new-hash');
  });
  afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await app.close();});
  it('activates authenticated first use and redacts /me but retains the owner response',async()=>{
    const linked=await app.inject({method:'GET',url:'/me',headers:{authorization:bearer}});
    expect(linked.statusCode).toBe(200);expect(linked.json().user.kryptoniteCode).toBeNull();expect(linked.body).not.toContain('MASTER-ACCOUNT-CODE');
    expect(DeviceLoginStore.prototype.activate).toHaveBeenCalledWith(userId,sessionId,familyId);
    vi.mocked(repo.getSessionById).mockResolvedValue({...session,auth_method:'account_code',family_id:null} as never);
    const owner=await app.inject({method:'GET',url:'/me',headers:{authorization:bearer}});
    expect(owner.json().user.kryptoniteCode).toBe('MASTER-ACCOUNT-CODE');
  });
  it('uses atomic linked refresh and redacts both code projections',async()=>{
    const legacy=vi.spyOn(repo,'revokeSession');
    const response=await app.inject({method:'POST',url:'/auth/refresh',payload:{refreshToken:`${sessionId}.dummy-secret`}});
    expect(response.statusCode).toBe(200);expect(response.json().user.kryptoniteCode).toBeNull();expect(response.json().kryptoniteCode).toBeNull();
    expect(response.body).not.toContain('MASTER-ACCOUNT-CODE');expect(legacy).not.toHaveBeenCalled();expect(DeviceLoginStore.prototype.refresh).toHaveBeenCalledWith(userId,sessionId,familyId,expect.objectContaining({refreshHash:'dummy-new-hash'}));
  });
  it('fails closed when cancellation won before first use or refresh',async()=>{
    vi.mocked(DeviceLoginStore.prototype.activate).mockResolvedValue(false);
    expect((await app.inject({method:'GET',url:'/me',headers:{authorization:bearer}})).statusCode).toBe(401);
    vi.mocked(DeviceLoginStore.prototype.refresh).mockResolvedValue(false);
    expect((await app.inject({method:'POST',url:'/auth/refresh',payload:{refreshToken:`${sessionId}.dummy-secret`}})).statusCode).toBe(401);
  });
});
