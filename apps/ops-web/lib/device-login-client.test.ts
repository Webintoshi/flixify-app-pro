import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeviceLoginClient, deviceReturnPath, type DeviceDisplay } from './device-login-client';

const challenge = {requestId:'ae752a4e-98b5-44c4-8093-56ac3c6b8e46',deviceSecret:'x'.repeat(43),userCode:'BCDF-GHJK',verificationUri:'https://flixify.vip/cihaz',verificationUriComplete:'https://flixify.vip/cihaz?code=BCDF-GHJK',qrPngBase64:'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAA==',expiresInSeconds:180,intervalSeconds:2};
const session = {accessToken:'dummy-access',refreshToken:'dummy-refresh',user:{id:'dummy-account',codeSuffix:'ABCD'}};
function deferred<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
afterEach(()=>vi.useRealTimers());
describe('phone approved browser login',()=>{
  it('accepts only a public short-code return path',()=>{
    expect(deviceReturnPath('BCDF-GHJK')).toBe('/cihaz?code=BCDF-GHJK');
    expect(deviceReturnPath('https://evil.test')).toBe(null);
  });
  it('shows only public presentation and serializes polls',async()=>{
    vi.useFakeTimers();const pending=deferred<any>();const seen:DeviceDisplay[]=[];
    const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:pending.promise);
    const client=new DeviceLoginClient(call,()=>{},s=>seen.push(s));await client.start();
    expect(JSON.stringify(seen)).not.toContain(challenge.deviceSecret);expect(JSON.stringify(seen)).not.toContain(challenge.requestId);
    await vi.advanceTimersByTimeAsync(20_000);expect(call.mock.calls.filter(c=>c[0].endsWith('token'))).toHaveLength(1);
    client.cancel();pending.resolve({status:'authorized',session});await Promise.resolve();
  });
  it('fences late authorization after cancel or manual login',async()=>{
    vi.useFakeTimers();const pending=deferred<any>();const save=vi.fn();
    const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:path.endsWith('token')?pending.promise:{status:'cancelled'});
    const client=new DeviceLoginClient(call,save,()=>{});await client.start();await vi.advanceTimersByTimeAsync(2000);client.cancel();pending.resolve({status:'authorized',session});await Promise.resolve();await Promise.resolve();expect(save).not.toHaveBeenCalled();expect(call.mock.calls.some(c=>c[0].endsWith('cancel'))).toBe(true);
  });
  it('does not revoke a successfully saved session when navigation disposes the view',async()=>{
    vi.useFakeTimers();const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:path.endsWith('token')?{status:'authorized',session}:{status:'complete'});
    let client:DeviceLoginClient;client=new DeviceLoginClient(call,()=>client.cancel(),()=>{});await client.start();await vi.advanceTimersByTimeAsync(2000);
    expect(call.mock.calls.some(c=>c[0].endsWith('ack'))).toBe(true);expect(call.mock.calls.some(c=>c[0].endsWith('cancel'))).toBe(false);
  });
  it('does not ACK failed persistent storage and can retry the same delivery',async()=>{
    vi.useFakeTimers();let fail=true;const save=vi.fn(()=>{if(fail)throw Error('storage');});
    const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:path.endsWith('token')?{status:'authorized',session}:{status:'complete'});
    const client=new DeviceLoginClient(call,save,()=>{});await client.start();await vi.advanceTimersByTimeAsync(2000);expect(call.mock.calls.some(c=>c[0].endsWith('ack'))).toBe(false);
    fail=false;client.retrySave();await Promise.resolve();expect(save).toHaveBeenCalledTimes(2);expect(call.mock.calls.filter(c=>c[0].endsWith('start'))).toHaveLength(1);expect(call.mock.calls.some(c=>c[0].endsWith('ack'))).toBe(true);
  });
  it('allows the final delivery grace and stops on a server terminal response',async()=>{
    vi.useFakeTimers();let status='pending';let latest:DeviceDisplay|undefined;
    const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:path.endsWith('token')?{status,...(status==='authorized'?{session}:{})}:{status:'complete'});
    const client=new DeviceLoginClient(call,()=>{},s=>latest=s);await client.start();await vi.advanceTimersByTimeAsync(181_000);expect(latest?.phase).toBe('pending');status='authorized';await vi.advanceTimersByTimeAsync(2000);expect(latest?.phase).toBe('adopted');
  });
  it('rejects a foreign QR URL before displaying it',async()=>{
    let latest:DeviceDisplay|undefined;const call=vi.fn(async()=>({...challenge,verificationUriComplete:'https://evil.test'}));const client=new DeviceLoginClient(call,()=>{},s=>latest=s);await client.start();expect(latest?.phase).toBe('error');expect(latest?.qr).toBeUndefined();
  });
  it('honors a 60 second server slowdown without polling early',async()=>{
    vi.useFakeTimers();let calls=0;const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:path.endsWith('token')?(calls++,{status:'slow_down',intervalSeconds:60}):{status:'complete'});
    const client=new DeviceLoginClient(call,()=>{},()=>{});await client.start();await vi.advanceTimersByTimeAsync(2000);expect(calls).toBe(1);await vi.advanceTimersByTimeAsync(59000);expect(calls).toBe(1);await vi.advanceTimersByTimeAsync(1000);expect(calls).toBe(2);client.cancel();
  });
  it('checks the storage owner immediately before adoption',async()=>{
    vi.useFakeTimers();const save=vi.fn();let allowed=true;const call=vi.fn(async(path:string)=>path.endsWith('start')?challenge:path.endsWith('token')?{status:'authorized',session}:{status:'cancelled'});
    const client=new DeviceLoginClient(call,save,()=>{},()=>performance.now(),()=>allowed);await client.start();allowed=false;await vi.advanceTimersByTimeAsync(2000);expect(save).not.toHaveBeenCalled();expect(call.mock.calls.some(c=>c[0].endsWith('cancel'))).toBe(true);
  });
  it('does not save a late response after the final grace expires',async()=>{
    vi.useFakeTimers();const pending=deferred<any>();const save=vi.fn();const client=new DeviceLoginClient(async path=>path.endsWith('start')?challenge:pending.promise,save,()=>{});await client.start();await vi.advanceTimersByTimeAsync(241000);pending.resolve({status:'authorized',session});await Promise.resolve();await Promise.resolve();expect(save).not.toHaveBeenCalled();
  });
});
