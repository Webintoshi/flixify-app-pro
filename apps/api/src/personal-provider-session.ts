import { createHmac } from "node:crypto";
import { canUseClientIpPlayback } from "./client-playback-access.js";

type Credentials = { username: string; password: string };
type PersonalProviderContext = {
  summary: { id: string };
  canPlay: boolean;
  accessUntil: string | null;
  isThreeHourTrial: boolean;
  trialProviderExpiresAt?: string | null;
  playbackBaseUrl: string | null;
  iptvCredentials: Credentials | null;
  sharedReferenceCredentials: Credentials | null;
};

export type PersonalProviderSession = {
  accountId: string;
  sourceVersion: string;
  providerOrigin: string;
  username: string;
  password: string;
  expiresAt: string;
  moviePolicy: "general-audience-only";
};

/** Derives personal browser access from already verified account metadata; never contacts the provider. */
export function derivePersonalProviderSession(
  accountId: string,
  context: PersonalProviderContext,
  secret: string,
  now = Date.now()
): PersonalProviderSession | null {
  if (!accountId || context.summary.id !== accountId || !secret || !canUseClientIpPlayback(context, now)) return null;
  const personal = context.iptvCredentials;
  const shared = context.sharedReferenceCredentials;
  if (!personal?.username?.trim() || !personal.password?.trim() ||
      (personal.username === shared?.username && personal.password === shared?.password)) return null;

  let provider: URL;
  try {
    if (!context.playbackBaseUrl || !/^https:\/\/[^\s/?#@\\]+\/?$/i.test(context.playbackBaseUrl)) return null;
    provider = new URL(context.playbackBaseUrl);
    if (provider.protocol !== "https:" || provider.username || provider.password || provider.pathname !== "/") return null;
  } catch {
    return null;
  }

  // Use the verified provider deadline for trials; canUseClientIpPlayback ensures it is no later than app access.
  const expiresAt = new Date(Date.parse(context.isThreeHourTrial ? context.trialProviderExpiresAt! : context.accessUntil!)).toISOString();
  // Length-delimited JSON plus a domain tag avoids ambiguous identities; expiry and JWT refresh do not change a line.
  const sourceVersion = createHmac("sha256", secret)
    .update(JSON.stringify(["flixify-personal-provider-v1", accountId, provider.origin, personal.username, personal.password]))
    .digest("base64url");
  return { accountId, sourceVersion, providerOrigin: provider.origin, username: personal.username,
    password: personal.password, expiresAt, moviePolicy: "general-audience-only" };
}
