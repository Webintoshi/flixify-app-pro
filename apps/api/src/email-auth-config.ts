import { z } from "zod";

export const EMAIL_AUTH_WEB_ORIGINS: readonly string[] = ["https://flixify.vip", "https://www.flixify.vip"];
const senderAddressSchema = z.string().trim().max(254).email();

type EmailAuthEnvironment = {
  EMAIL_AUTH_ENABLED: boolean;
  APP_DEMO_MODE: boolean;
  EMAIL_AUTH_SECRET?: string;
  EMAIL_AUTH_FROM?: string;
  RESEND_API_KEY?: string;
  APP_JWT_SECRET: string;
  REGISTRATION_GUARD_SECRET: string;
  PHONE_AUTH_SECRET?: string;
};

export function resolveEmailAuthConfiguration(env: EmailAuthEnvironment) {
  if (!env.EMAIL_AUTH_ENABLED || env.APP_DEMO_MODE) return null;

  const secret = env.EMAIL_AUTH_SECRET;
  const from = senderAddressSchema.safeParse(env.EMAIL_AUTH_FROM);
  const apiKey = env.RESEND_API_KEY;
  if (!secret || secret.length < 32 || secret.length > 256 || !from.success || !apiKey || !/^[\x21-\x7e]{1,512}$/.test(apiKey)) return null;
  if ([env.APP_JWT_SECRET, env.REGISTRATION_GUARD_SECRET, env.PHONE_AUTH_SECRET].includes(secret)) return null;

  return { secret, from: from.data, apiKey };
}
