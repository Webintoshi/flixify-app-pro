import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const PERMANENT_IP_LIMIT = 2;
export class AutoTrialRegistrationRateLimitError extends Error {}
export class RegistrationInstallationLimitError extends Error {}

export const CLAIM_INSTALLATION_SQL = `
  insert into public.registration_installation_claims (installation_hash)
  values ($1)
  on conflict (installation_hash) do nothing
  returning installation_hash
`;

export const CLAIM_IP_SQL = `
  insert into public.registration_ip_lifetime_quota (ip_hash, count)
  values ($1, 1)
  on conflict (ip_hash) do update
  set count = registration_ip_lifetime_quota.count + 1,
      updated_at = now()
  where registration_ip_lifetime_quota.count < $2::integer
  returning count
`;

function identityHash(namespace: string, identity: string, secret: string) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Stable registration guard secret is required.");
  return createHmac("sha256", secret).update(namespace + identity.trim()).digest("hex");
}

export function registrationIpHash(address: string, secret: string) {
  if (typeof address !== "string" || !isIP(address.trim())) throw new Error("Verified client address is required.");
  // Retain the old namespace so known historical IP counters can be seeded.
  return identityHash("auto-trial-registration-ip:v1:", address, secret);
}

export function registrationInstallationHash(installation: string, secret: string) {
  if (typeof installation !== "string" || !installation.trim()) throw new Error("Registration installation identity is required.");
  return identityHash("auto-registration-installation:v1:", installation, secret);
}

type Transaction = { query(text: string, values: unknown[]): Promise<{ rowCount: number | null }> };
type RegistrationIdentity = { installationId: string | null | undefined; requestIp: string; guardSecret: string; ipLimit?: number };

/** Both claims must share the surrounding user-and-trial-job transaction. */
export async function claimRegistrationSlots(client: Transaction, identity: RegistrationIdentity) {
  const limit = identity.ipLimit ?? PERMANENT_IP_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > PERMANENT_IP_LIMIT) throw new Error("Permanent registration IP limit is invalid.");
  const installationHash = registrationInstallationHash(identity.installationId as string, identity.guardSecret);
  const ipHash = registrationIpHash(identity.requestIp, identity.guardSecret);
  const installation = await client.query(CLAIM_INSTALLATION_SQL, [installationHash]);
  if (installation.rowCount !== 1) throw new RegistrationInstallationLimitError("This installation already registered an account.");
  const quota = await client.query(CLAIM_IP_SQL, [ipHash, limit]);
  if (quota.rowCount !== 1) throw new AutoTrialRegistrationRateLimitError("Permanent IP account limit reached.");
}
