import { describe, expect, it } from 'vitest';
import { DeviceLoginCrypto, redactDeviceLinkedPayload, normalizeUserCode } from './device-login.js';

describe('device linking primitives', () => {
  it('separates public code, private proof and authenticated encrypted delivery', () => {
    const crypto = new DeviceLoginCrypto('fixture-key-not-a-real-secret');
    const secret = crypto.secret();
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    expect(crypto.verifier(secret)).not.toBe(secret);
    const envelope = crypto.seal({ refreshToken: 'dummy', user: { id: 'one', codeSuffix: 'ABCD' } });
    expect(envelope).not.toContain('dummy');
    expect(crypto.open(envelope)).toEqual({ refreshToken: 'dummy', user: { id: 'one', codeSuffix: 'ABCD' } });
    expect(() => new DeviceLoginCrypto('different').open(envelope)).toThrow();
    expect(crypto.nonce('request', 'account')).not.toBe(crypto.nonce('request', 'other'));
  });
  it('redacts nested and top-level reusable codes without mutating owner responses', () => {
    const input = { kryptoniteCode: 'MASTER', user: { kryptoniteCode: 'MASTER', codeSuffix: 'STER' }, items: [{ kryptonite_code: 'MASTER' }] };
    expect(redactDeviceLinkedPayload(input)).toEqual({ kryptoniteCode: null, user: { kryptoniteCode: null, codeSuffix: 'STER' }, items: [{ kryptonite_code: null }] });
    expect(input.user.kryptoniteCode).toBe('MASTER');
  });
  it('normalizes only eight unambiguous letters', () => {
    expect(normalizeUserCode('bcdf-ghjk')).toBe('BCDF-GHJK');
    expect(() => normalizeUserCode('1234-5678')).toThrow();
  });
});

it('keeps large non-code payloads unchanged and fails closed for cyclic responses', () => {
  const items = Array.from({length: 29_000}, (_, id) => ({id, title: `Movie ${id}`}));
  const catalog = {items};
  expect(redactDeviceLinkedPayload(catalog)).toBe(catalog);
  const cycle: any = {kryptoniteCode:'MASTER'}; cycle.self = cycle;
  expect(() => redactDeviceLinkedPayload(cycle)).toThrow('Cyclic');
});
