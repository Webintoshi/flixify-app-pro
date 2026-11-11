import { z } from "zod";
import { isIP } from "node:net";

export const EMAIL_AUTH_WEB_ORIGINS: readonly string[] = ["https://flixify.vip", "https://www.flixify.vip"];
const senderAddressSchema = z.string().trim().max(254).email();

type EmailAuthEnvironment = {
  EMAIL_AUTH_ENABLED: boolean;
  APP_DEMO_MODE: boolean;
  EMAIL_AUTH_SECRET?: string;
  EMAIL_AUTH_FROM?: string;
  EMAIL_AUTH_TRANSPORT?: "resend" | "smtp";
  RESEND_API_KEY?: string;
  EMAIL_SMTP_HOST?: string;
  EMAIL_SMTP_PORT?: string;
  EMAIL_SMTP_USER?: string;
  EMAIL_SMTP_PASSWORD?: string;
  APP_JWT_SECRET: string;
  REGISTRATION_GUARD_SECRET: string;
  PHONE_AUTH_SECRET?: string;
};

export type EmailSmtpConfiguration = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

function resolveSmtpConfiguration(env: EmailAuthEnvironment, from: string): EmailSmtpConfiguration | null {
  const host = env.EMAIL_SMTP_HOST?.trim().toLowerCase();
  const portText = env.EMAIL_SMTP_PORT ?? "587";
  const port = Number(portText);
  const user = env.EMAIL_SMTP_USER;
  const password = env.EMAIL_SMTP_PASSWORD;
  if (!host || host.length > 253 || isIP(host)) return null;
  if (host.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  if (!/^[0-9]{1,5}$/.test(portText) || port < 1 || port > 65_535) return null;
  if (!user || !/^[\x21-\x7e]{1,254}$/.test(user) || !password || password.length > 512) return null;
  return { host, port, user, password, from };
}

export function resolveEmailAuthConfiguration(env: EmailAuthEnvironment) {
  if (!env.EMAIL_AUTH_ENABLED || env.APP_DEMO_MODE) return null;

  const secret = env.EMAIL_AUTH_SECRET;
  const from = senderAddressSchema.safeParse(env.EMAIL_AUTH_FROM);
  if (!secret || secret.length < 32 || secret.length > 256 || !from.success) return null;
  if ([env.APP_JWT_SECRET, env.REGISTRATION_GUARD_SECRET, env.PHONE_AUTH_SECRET].includes(secret)) return null;

  if (env.EMAIL_AUTH_TRANSPORT === "smtp") {
    const smtp = resolveSmtpConfiguration(env, from.data);
    return smtp ? { ...smtp, secret, transport: "smtp" as const } : null;
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !/^[\x21-\x7e]{1,512}$/.test(apiKey)) return null;
  return { secret, from: from.data, apiKey, transport: "resend" as const };
}
