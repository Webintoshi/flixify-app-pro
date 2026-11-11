import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';
import type { DeviceLoginStore, DeviceLoginRow, PhoneIdentity } from './device-login-store.js';

export const DEVICE_VERIFICATION_URI = 'https://flixify.vip/cihaz';
function verificationUri(localOrigin?:string){
  if(localOrigin===undefined)return DEVICE_VERIFICATION_URI;
  if(!['http://127.0.0.1:3192','http://localhost:3192'].includes(localOrigin))throw new Error('Invalid local verification origin');
  return `${localOrigin}/cihaz`;
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export class DeviceLoginError extends Error {
  constructor(public statusCode: number, public reason: string) { super('Cihaz baglama islemi tamamlanamadi.'); }
}
export function normalizeUserCode(value: string) {
  const code = value.replace(/-/g, '').toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) throw new DeviceLoginError(400, 'invalid_input');
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
export function redactDeviceLinkedPayload<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const active = new WeakSet<object>();
  let visited = 0;
  function project(input: unknown, depth: number): unknown {
    if (!input || typeof input !== 'object' || input instanceof Date || Buffer.isBuffer(input)) return input;
    if (depth > 100 || ++visited > 1_000_000) throw new Error('Viewer response exceeds projection bounds');
    if (active.has(input)) throw new Error('Cyclic viewer response');
    if (seen.has(input)) return seen.get(input);
    active.add(input);
    // Only modified paths are copied; catalog pages with no master-code fields retain their objects.
    let output: any = input;
    seen.set(input, input);
    for (const [key, item] of Object.entries(input)) {
      const next = ['kryptoniteCode', 'kryptonite_code'].includes(key) ? null : project(item, depth + 1);
      if (next !== item) {
        if (output === input) { output = Array.isArray(input) ? input.slice() : { ...input }; seen.set(input, output); }
        output[key] = next;
      }
    }
    active.delete(input);
    return output;
  }
  return project(value, 0) as T;
}
export class DeviceLoginCrypto {
  private key: Buffer;
  constructor(private secretKey: string) { this.key = this.hashBytes('encryption', 'v1'); }
  private hashBytes(purpose: string, value: string) { return createHmac('sha256', this.secretKey).update(`device-login:v1:${purpose}\0${value}`).digest(); }
  hash(purpose: string, value: string) { return this.hashBytes(purpose, value).toString('hex'); }
  secret() { return randomBytes(32).toString('base64url'); }
  code() { return normalizeUserCode(Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')); }
  verifier(value: string) { return this.hash('target-proof', value); }
  nonce(id: string, userId: string) { return this.hash('phone-nonce', `${id}:${userId}`); }
  matches(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
  seal(value: unknown) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }
  open(value: string) {
    const bytes = Buffer.from(value, 'base64url'); const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  }
}
export async function deviceLoginQr(url: string,localOrigin?:string) {
  const prefix=`${verificationUri(localOrigin)}?code=`;
  if (!url.startsWith(prefix)||!/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(url.slice(prefix.length))) throw new Error('Invalid verification URL');
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const scale = 6; const modules = qr.getModuleCount(); const width = (modules + 8) * scale;
  const pixels = Buffer.alloc(width * width, 255);
  for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) if (qr.isDark(y, x)) {
    for (let dy = 0; dy < scale; dy++) pixels.fill(0, ((y + 4) * scale + dy) * width + (x + 4) * scale, ((y + 4) * scale + dy) * width + (x + 5) * scale);
  }
  return (await sharp(pixels, { raw: { width, height: width, channels: 1 } }).png().toBuffer()).toString('base64');
}
export type PreparedDeviceSession = { id: string; refreshHash: string; accessToken: string; refreshToken: string };
export class DeviceLoginService {
  private verificationUri:string;
  constructor(public store: DeviceLoginStore, private crypto: DeviceLoginCrypto,
    private prepare: (userId: string) => Promise<PreparedDeviceSession>,private options:{localVerificationOrigin?:string}={}) {this.verificationUri=verificationUri(options.localVerificationOrigin);}
  async rate(kind: string, identity: string, limit: number) {
    await this.store.rate(this.crypto.hash('rate', `${kind}:${identity}`), limit);
  }
  async start(input: { platform: string; deviceName: string; installationId?: string }, ip: string) {
    await this.rate('start', ip, 60);
    await this.store.cleanup();
    const deviceSecret = this.crypto.secret(); const requestId = randomUUID(); const userCode = this.crypto.code();
    const verificationUriComplete = `${this.verificationUri}?code=${userCode}`;
    const qrPngBase64 = await deviceLoginQr(verificationUriComplete,this.options.localVerificationOrigin);
    const row = await this.store.start({ id: requestId, code: userCode, verifier: this.crypto.verifier(deviceSecret),
      installationHash: input.installationId ? this.crypto.hash('installation', input.installationId) : null, ...input });
    return { requestId, deviceSecret, userCode, verificationUri: this.verificationUri, verificationUriComplete,
      qrPngBase64, expiresAt: new Date(row.expires_at).toISOString(), expiresInSeconds: 180, intervalSeconds: 2 };
  }
  async target(operation: 'token' | 'ack' | 'cancel', input: { requestId: string; deviceSecret: string }) {
    await this.rate('target', input.requestId, 90);
    const result = await this.store.target(input.requestId, this.crypto.verifier(input.deviceSecret), operation);
    if (result.envelope) return { status: 'authorized', session: this.crypto.open(result.envelope) };
    return { status: result.status, ...(result.intervalSeconds ? { intervalSeconds: result.intervalSeconds } : {}) };
  }
  private owner(auth: PhoneIdentity) {
    if (auth.authMethod !== "account_code" && auth.authMethod !== "phone_otp" && auth.authMethod !== "email_otp") {
      throw new DeviceLoginError(403, "reauthentication_required");
    }
  }
  async lookup(code: string, auth: PhoneIdentity, ip: string) {
    this.owner(auth); await this.rate('phone', ip, 30);
    const row = await this.store.lookup(normalizeUserCode(code), auth);
    return { requestId: row.id, userCode: row.user_code, deviceName: row.device_name, platform: row.platform,
      expiresAt: new Date(row.expires_at).toISOString(), accountSuffix: row.account_suffix,
      state: row.state, ...(row.state === 'pending' ? { approvalNonce: this.crypto.nonce(row.id, auth.userId) } : {}) };
  }
  async decision(input: { requestId: string; userCode: string; approvalNonce: string; action: 'approve' | 'deny' }, auth: PhoneIdentity, ip: string) {
    this.owner(auth); await this.rate('phone', ip, 30); await this.rate('decision-account', auth.userId, 30);
    if (!this.crypto.matches(input.approvalNonce, this.crypto.nonce(input.requestId, auth.userId))) throw new DeviceLoginError(403, 'invalid_nonce');
    const code = normalizeUserCode(input.userCode);
    await this.store.validateDecision(input.requestId, code, auth);
    const prepared = input.action === 'approve' ? await this.prepare(auth.userId) : null;
    return this.store.decision(input.requestId, code, auth, input.action, prepared,
      (suffix) => this.crypto.seal({ accessToken: prepared!.accessToken, refreshToken: prepared!.refreshToken, user: { id: auth.userId, codeSuffix: suffix } }));
  }
}
