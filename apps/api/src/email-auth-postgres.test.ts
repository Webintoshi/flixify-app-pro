import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('dotenv', () => ({ config: () => ({}) }));
vi.mock('./env.js', () => {
  let database = 'postgresql://127.0.0.1:1/unused';
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname === '127.0.0.1' && url.port === '55441' && url.pathname === '/flixify_phone_preview') database = url.href;
  } catch {}
  return { env: {
    DATABASE_URL: database,
    APP_JWT_SECRET: 'fixture-jwt-key-0000000000000000000000000000',
    REGISTRATION_GUARD_SECRET: 'fixture-registration-key-000000000000000000',
    AUTO_TRIAL_DAILY_IP_LIMIT: 2
  } };
});
import { randomInt, randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { EmailAuthService, type EmailRequest } from './email-auth.js';
import { PhoneAuthCrypto, PhoneAuthService, type PhoneRequest, type PhoneSession } from './phone-auth.js';
import { emailAuthAccounts, phoneAuthAccounts } from './phone-auth-accounts.js';
import { PostgresOtpAuthStore } from './phone-auth-store.js';
import { createCodeLookup, hashSecret } from './security.js';
import { registrationInstallationHash, registrationIpHash } from './registration-limits.js';
import { RememberedRefreshCrypto, RememberedSessionStore } from './remembered-session.js';

const url = new URL(process.env.DATABASE_URL ?? 'http://unconfigured.invalid');
const owned = url.hostname === '127.0.0.1' && url.port === '55441' && url.pathname === '/flixify_phone_preview'
  && process.env.EMAIL_AUTH_TEST_DATABASE === 'owned-local-only';
const cases = owned ? describe : describe.skip;
const guardSecret = 'fixture-registration-key-000000000000000000';
const phoneCrypto = new PhoneAuthCrypto(`fixture-phone-key-${randomUUID()}`);
const emailCrypto = new PhoneAuthCrypto(`fixture-email-key-${randomUUID()}`, 'email');
const ips = new Set<string>(), installations = new Set<string>(), users = new Set<string>();
const phones: string[] = [], emails: string[] = [];

function fixtureIp() {
  const value = `198.19.${randomInt(1, 255)}.${randomInt(2, 255)}`;
  ips.add(value);
  return value;
}
function metadata(installationId = `email-fixture-${randomUUID()}`) {
  installations.add(installationId);
  return { intent: 'register' as const, installationId, platform: 'web' as const, deviceName: 'Fixture' };
}
function phoneFixture(installationId?: string) {
  const phone = `+1999${randomInt(1000000, 9999999)}`;
  phones.push(phoneCrypto.hash('phone', phone));
  let code = '';
  const service = new PhoneAuthService(new PostgresOtpAuthStore(pool), phoneCrypto, { send: async (_phone, value) => { code = value; } }, phoneAuthAccounts);
  return { service, request: { ...metadata(installationId), phone } satisfies PhoneRequest, code: () => code };
}
function emailFixture(installationId?: string) {
  const email = `fixture+${randomUUID()}@example.invalid`;
  const hash = emailCrypto.hash('email', email);
  emails.push(hash);
  let code = '';
  const service = new EmailAuthService(new PostgresOtpAuthStore(pool, 'email'), emailCrypto, { send: async (_email, value) => { code = value; } }, emailAuthAccounts);
  return { service, request: { ...metadata(installationId), email } satisfies EmailRequest, hash, code: () => code };
}
function verification(fixture: { request: { installationId: string }; code(): string }, challenge: { challengeId: string; challengeSecret: string }) {
  return { challengeId: challenge.challengeId, challengeSecret: challenge.challengeSecret, code: fixture.code(), installationId: fixture.request.installationId };
}
function remember(session: PhoneSession) { users.add(session.user.id); return session; }

cases('email OTP through owned PostgreSQL transactions', () => {
  afterAll(async () => {
    await pool.query('delete from public.email_auth_identities where email_hash=any($1::text[])', [emails]);
    await pool.query('delete from public.phone_auth_identities where phone_hash=any($1::text[])', [phones]);
    await pool.query('delete from public.email_auth_challenges where email_hash=any($1::text[])', [emails]);
    await pool.query('delete from public.phone_auth_challenges where phone_hash=any($1::text[])', [phones]);
    const ids = [...users];
    await pool.query('delete from public.welcome_offer_accounts where user_id=any($1::uuid[])', [ids]);
    await pool.query('delete from public.users where id=any($1::uuid[])', [ids]);
    await pool.query('delete from public.registration_ip_lifetime_quota where ip_hash=any($1::text[])', [[...ips].map(ip => registrationIpHash(ip, guardSecret))]);
    await pool.query('delete from public.registration_installation_claims where installation_hash=any($1::text[])', [[...installations].map(id => registrationInstallationHash(id, guardSecret))]);
    await pool.end();
  });

  it('shares installation and two-account IP limits across WhatsApp and email', async () => {
    const ip = fixtureIp(), phone = phoneFixture();
    const phoneChallenge = await phone.service.request(phone.request, ip);
    const first = remember(await phone.service.verify(verification(phone, phoneChallenge), ip));
    const sameDevice = emailFixture(phone.request.installationId);
    const deviceChallenge = await sameDevice.service.request(sameDevice.request, ip);
    await expect(sameDevice.service.verify(verification(sameDevice, deviceChallenge), ip)).rejects.toMatchObject({ reason: 'installation_limit' });
    await expect(sameDevice.service.verify(verification(sameDevice, deviceChallenge), ip)).rejects.toMatchObject({ reason: 'invalid_or_expired' });

    const secondDevice = emailFixture(), emailChallenge = await secondDevice.service.request(secondDevice.request, ip);
    const second = remember(await secondDevice.service.verify(verification(secondDevice, emailChallenge), ip));
    const third = emailFixture(), thirdChallenge = await third.service.request(third.request, ip);
    await expect(third.service.verify(verification(third, thirdChallenge), ip)).rejects.toMatchObject({ reason: 'registration_ip_limit' });
    expect((await pool.query('select count(*)::int as n from public.registration_installation_claims where installation_hash=$1', [registrationInstallationHash(third.request.installationId, guardSecret)])).rows[0].n).toBe(0);
    expect((await pool.query('select registration_method from public.users where id=any($1::uuid[]) order by registration_method', [[first.user.id, second.user.id]])).rows).toEqual([{ registration_method: 'email_otp' }, { registration_method: 'phone_otp' }]);
    expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=any($1::uuid[])', [[first.user.id, second.user.id]])).rows[0].n).toBe(2);
  });

  it('requires explicit signup and consumes successful email codes exactly once', async () => {
    const ip = fixtureIp(), f = emailFixture();
    const login = await f.service.request({ ...f.request, intent: 'login' }, ip);
    await expect(f.service.verify(verification(f, login), ip)).rejects.toMatchObject({ reason: 'registration_required' });
    expect((await pool.query('select user_id from public.email_auth_identities where email_hash=$1', [f.hash])).rowCount).toBe(0);
    await pool.query("update public.email_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1", [login.challengeId]);
    const signup = await f.service.request(f.request, ip), input = verification(f, signup);
    const results = await Promise.allSettled([f.service.verify(input, ip), f.service.verify(input, ip)]);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    for (const result of fulfilled) remember(result.value);
    expect(fulfilled).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { reason: 'invalid_or_expired' } });
    const session = fulfilled[0].value;
    expect(session.kryptoniteCode).toBeNull();
    expect((await pool.query('select state,context_ciphertext from public.email_auth_challenges where id=$1', [signup.challengeId])).rows).toEqual([{ state: 'consumed', context_ciphertext: null }]);
    await pool.query("update public.email_auth_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1", [signup.challengeId]);
    const again = await f.service.request({ ...f.request, intent: 'login' }, ip);
    const repeated = await f.service.verify(verification(f, again), ip);
    expect(repeated.user.id).toBe(session.user.id);
    expect((await pool.query('select auth_method from public.device_sessions where user_id=$1', [session.user.id])).rows).toEqual([{ auth_method: 'email_otp' }, { auth_method: 'email_otp' }]);
    expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=$1', [session.user.id])).rows[0].n).toBe(1);

    const predecessor = repeated.refreshToken.split('.')[0];
    const refreshHash = (await pool.query('select refresh_token_hash from public.device_sessions where id=$1', [predecessor])).rows[0].refresh_token_hash;
    const refreshInput = { id: predecessor, userId: session.user.id, refreshHash };
    const nextId = randomUUID();
    const next = { id: nextId, accessToken: 'fixture-next-access', refreshToken: `${nextId}.fixture-next-refresh`, refreshHash: 'fixture-next-hash' };
    const remembered = new RememberedSessionStore(pool, new RememberedRefreshCrypto('fixture-remembered-refresh-secret-000000'));
    const rotated = await remembered.rotate(refreshInput, next);
    expect(rotated).toMatchObject({ userId: session.user.id, sessionId: nextId, authMethod: 'email_otp', familyId: null });
    expect(await remembered.rotate(refreshInput, next)).toEqual(rotated);
  });

  it('binds an existing account using proof and preserves its original registration and trial state', async () => {
    const ip = fixtureIp(), f = emailFixture(), code = 'AB12CD34EF56GH78';
    const existing = (await pool.query("insert into public.users(code_lookup,code_hash,code_suffix,status) values($1,$2,$3,'active') returning id", [createCodeLookup(code), await hashSecret(code), code.slice(-4)])).rows[0].id;
    users.add(existing);
    await expect(f.service.request(f.request, ip, { userId: existing, authMethod: 'device_link' })).rejects.toMatchObject({ reason: 'reauthentication_required' });
    const bind = await f.service.request({ ...f.request, existingCode: code }, ip);
    const session = await f.service.verify(verification(f, bind), ip);
    expect(session.user.id).toBe(existing);
    const phone = phoneFixture();
    const phoneChallenge = await phone.service.request(phone.request, ip, { userId: existing, sessionId: session.refreshToken.split('.')[0], authMethod: 'email_otp' });
    expect((await phone.service.verify(verification(phone, phoneChallenge), ip)).user.id).toBe(existing);
    expect((await pool.query('select registration_method,registration_platform from public.users where id=$1', [existing])).rows).toEqual([{ registration_method: null, registration_platform: null }]);
    expect((await pool.query('select count(*)::int as n from public.auto_trial_provision_jobs where user_id=$1', [existing])).rows[0].n).toBe(0);
    const alternate = emailFixture();
    const conflict = await alternate.service.request({ ...alternate.request, existingCode: code }, ip);
    await expect(alternate.service.verify(verification(alternate, conflict), ip)).rejects.toMatchObject({ reason: 'account_conflict' });
  });
});
