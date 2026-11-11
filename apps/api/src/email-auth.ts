import { OtpAuthService, PhoneAuthError, type OtpAccountResolver, type PhoneAuthCrypto, type PhoneAuthOwner, type PhoneAuthStore, type PhoneRequest } from './phone-auth.js';

export { PhoneAuthError as EmailAuthError } from './phone-auth.js';
export type EmailAuthOwner = PhoneAuthOwner;
export type EmailRequest = Omit<PhoneRequest, 'phone' | 'platform'> & { email: string; platform: 'web' };

export function normalizeEmail(input: string) {
  const email = input.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined
      || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    throw new PhoneAuthError(400, 'invalid_email');
  }
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new PhoneAuthError(400, 'invalid_email');
  }
  return email;
}

export class EmailAuthService extends OtpAuthService {
  constructor(store: PhoneAuthStore, crypto: PhoneAuthCrypto, sender: { send(email: string, code: string): Promise<void> }, accounts: OtpAccountResolver) {
    super(store, crypto, sender, accounts, 'email');
  }

  async request(input: EmailRequest, requestIp: string, owner?: EmailAuthOwner) {
    if (input.intent === 'login' && input.existingCode !== undefined) throw new PhoneAuthError(400, 'invalid_input');
    const email = normalizeEmail(input.email);
    const [local, domain] = email.split('@');
    const maskedEmail = `${local[0]}•••@${domain[0]}•••.${domain.split('.').at(-1)}`;
    const challenge = await this.requestContact(email, maskedEmail, input, requestIp, input.intent === 'register' ? owner : undefined);
    return { ...challenge, maskedEmail };
  }
}
