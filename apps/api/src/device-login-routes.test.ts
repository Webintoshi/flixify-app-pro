import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerDeviceLoginRoutes } from './device-login-routes.js';
import { DeviceLoginError } from './device-login.js';

function fixture() {
  const service = { start: vi.fn(async () => ({ expiresInSeconds:180 })), target: vi.fn(async () => ({status:'pending'})), lookup: vi.fn(async () => ({state:'pending'})), decision: vi.fn(async () => ({status:'approved'})) };
  const authenticate = vi.fn(async () => ({userId:'dummy',sessionId:'dummy',authMethod:'account_code'}));
  const app = Fastify(); registerDeviceLoginRoutes(app,{service:service as never,authenticate});
  return {app,service,authenticate};
}
describe('device HTTP boundary', () => {
  it('requires first-party Origin and bearer auth before lookup or decision',async()=>{
    const {app,service,authenticate}=fixture();
    for (const origin of [undefined,'https://evil.test','https://flixify.vip.evil.test','null']) {
      const result=await app.inject({method:'POST',url:'/auth/device/lookup',headers:{authorization:'Bearer dummy',...(origin?{origin}:{})},payload:{code:'BCDF-GHJK'}});
      expect(result.statusCode).toBe(403); expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['referrer-policy']).toBe('no-referrer');
    }
    expect(authenticate).not.toHaveBeenCalled(); expect(service.lookup).not.toHaveBeenCalled(); await app.close();
  });
  it('sanitizes malformed and infrastructure errors with private response headers',async()=>{
    const {app,service}=fixture();
    const malformed=await app.inject({method:'POST',url:'/auth/device/start',payload:{platform:'fridge',deviceName:'secret-material'}});
    expect(malformed.statusCode).toBe(400); expect(malformed.body).not.toContain('secret-material');
    service.start.mockRejectedValueOnce(new Error('postgres password=secret'));
    const unavailable=await app.inject({method:'POST',url:'/auth/device/start',payload:{platform:'web',deviceName:'Browser'}});
    expect(unavailable.statusCode).toBe(503); expect(unavailable.body).not.toContain('postgres'); expect(unavailable.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });
  it('rejects invalid private proofs and maps owner reauthentication and throttling',async()=>{
    const {app,service}=fixture();
    expect((await app.inject({method:'POST',url:'/auth/device/token',payload:{requestId:'bad',deviceSecret:'bad'}})).statusCode).toBe(400);
    service.lookup.mockRejectedValueOnce(new DeviceLoginError(403,'reauthentication_required'));
    const response=await app.inject({method:'POST',url:'/auth/device/lookup',headers:{origin:'https://flixify.vip',authorization:'Bearer dummy'},payload:{code:'BCDF-GHJK'}});
    expect(response.statusCode).toBe(403); expect(response.json().reason).toBe('reauthentication_required');
    service.start.mockRejectedValueOnce(new DeviceLoginError(429,'rate_limited'));
    expect((await app.inject({method:'POST',url:'/auth/device/start',payload:{platform:'web',deviceName:'Browser'}})).statusCode).toBe(429); await app.close();
  });
});

it('keeps phone authentication infrastructure failures distinct from invalid credentials',async()=>{
  const {app,authenticate}=fixture();authenticate.mockRejectedValueOnce(new Error('dummy database offline'));
  const response=await app.inject({method:'POST',url:'/auth/device/lookup',headers:{origin:'https://flixify.vip',authorization:'Bearer dummy'},payload:{code:'BCDF-GHJK'}});
  expect(response.statusCode).toBe(503);expect(response.body).not.toContain('database');await app.close();
});
