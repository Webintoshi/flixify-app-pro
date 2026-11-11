import { describe, expect, it, vi } from 'vitest';
import { EmailAuthService, normalizeEmail } from './email-auth.js';
import { PhoneAuthCrypto, type OtpAccountResolver, type PhoneAuthStore, type PhoneReservation } from './phone-auth.js';

const fixtureSecret = 'fixture-only-email-auth-key-000000000000000';
const email = 'user.name+trial@example.invalid';
const request = { email, intent: 'register' as const, installationId: 'fixture-installation', platform: 'web' as const, deviceName: 'Fixture' };
const ip = '198.18.30.2';

function fixture() {
  const crypto = new PhoneAuthCrypto(fixtureSecret, 'email');
  const reserve = vi.fn(async (_input: PhoneReservation) => {});
  const store = { channel: 'email', reserve, rateVerify: vi.fn(async () => {}), delivery: vi.fn(async () => {}) } as unknown as PhoneAuthStore;
  const send = vi.fn(async (_contact: string, _code: string) => {});
  const accounts = { existingAccount: vi.fn(async () => null), resolve: vi.fn() } as OtpAccountResolver;
  return { crypto, reserve, store, send, accounts, service: new EmailAuthService(store, crypto, { send }, accounts) };
}

describe('email OTP request', () => {
  it('normalizes case and whitespace while preserving dots and plus aliases', () => {
    expect(normalizeEmail('  User.Name+Trial@Example.Invalid  ')).toBe(email);
    for (const input of ['a@local', 'a@-test.invalid', 'a..b@example.invalid', 'a@b@example.invalid', 'a\r\nb@example.invalid']) {
      expect(() => normalizeEmail(input)).toThrow('invalid_email');
    }
  });

  it('sends only through the injected sender and keeps the raw address and code out of storage', async () => {
    const f = fixture();
    const response = await f.service.request(request, ip);
    expect(response).toMatchObject({ delivery: 'accepted', expiresInSeconds: 300, resendAfterSeconds: 60, maskedEmail: 'u•••@e•••.invalid' });
    expect(response).not.toHaveProperty('maskedPhone');
    expect(f.send).toHaveBeenCalledOnce();
    const [recipient, code] = f.send.mock.calls[0];
    expect(recipient).toBe(email); expect(code).toMatch(/^[0-9]{6}$/);
    const stored = f.reserve.mock.calls[0][0];
    expect(stored.phoneHash).toBe(f.crypto.hash('email', email));
    expect(stored.otpHash).toBe(f.crypto.hash('otp', `${response.challengeId}:${code}`));
    expect(stored.secretHash).not.toBe(response.challengeSecret);
    expect(JSON.stringify(stored)).not.toContain(email);
    const context = f.crypto.open(response.challengeId, stored.context);
    expect(context).toMatchObject({ intent: 'register', installationId: request.installationId, requestIp: ip });
    expect(JSON.stringify(context)).not.toContain(email);
    expect(context).not.toHaveProperty('code');
  });

  it('refuses to issue an email challenge with a phone namespace or phone store', () => {
    const f = fixture();
    expect(() => new EmailAuthService(f.store, new PhoneAuthCrypto(fixtureSecret), { send: f.send }, f.accounts)).toThrow('namespace mismatch');
    expect(() => new EmailAuthService({ ...f.store, channel: 'phone' }, f.crypto, { send: f.send }, f.accounts)).toThrow('namespace mismatch');
  });

  it('consumes no send when a durable rate check rejects a request', async () => {
    const f = fixture(); f.reserve.mockRejectedValueOnce(new Error('fixture_rate_limit'));
    await expect(f.service.request(request, ip)).rejects.toThrow('fixture_rate_limit');
    expect(f.send).not.toHaveBeenCalled();
  });
});

it('keeps email login separate from explicit account binding', async () => {
  const f = fixture();
  await expect(f.service.request({ ...request, intent: 'login', existingCode: 'AB12CD34EF56GH78' }, ip)).rejects.toMatchObject({ reason: 'invalid_input' });
  expect(f.send).not.toHaveBeenCalled();
  const owner = { userId: 'fixture-user', sessionId: 'fixture-session', authMethod: 'account_code' };
  const challenge = await f.service.request({ ...request, intent: 'login' }, ip, owner);
  expect(f.accounts.existingAccount).toHaveBeenCalledWith(undefined, undefined);
  expect(f.crypto.open(challenge.challengeId, f.reserve.mock.calls[0][0].context)).not.toHaveProperty('pendingUserId');
});
