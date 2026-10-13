import { InvalidProviderLineError, type ResellerClient, type VerifiedProviderLine } from "./reseller.js";

export type AutoTrialJob = {
  id: string;
  userId: string;
  username: string;
  password: string;
  createAttemptedAt: string | null;
  providerLineId: string | null;
  providerExpiresAt: string | null;
};

export class AutoTrialConflictError extends Error {}

export type AutoTrialStore = {
  isEligible(jobId: string, userId: string): Promise<boolean>;
  markCreateAttempted(jobId: string): Promise<void>;
  markVerified(jobId: string, line: VerifiedProviderLine): Promise<void>;
  complete(jobId: string, line: VerifiedProviderLine): Promise<void>;
  deferReconciliation(jobId: string, reason: string): Promise<void>;
  requireReview(jobId: string, reason: string): Promise<void>;
};

export function computeTrialEndsAt(providerExpiresAt: string, startedAt = Date.now()): string {
  const providerExpiry = new Date(providerExpiresAt).getTime();
  if (!Number.isFinite(providerExpiry) || providerExpiry <= startedAt) {
    throw new InvalidProviderLineError("Provider trial expiry is invalid.");
  }
  return new Date(Math.min(providerExpiry, startedAt + 3 * 60 * 60 * 1000)).toISOString();
}

export async function runAutoTrialProvisioning(
  job: AutoTrialJob,
  store: AutoTrialStore,
  provider: Pick<ResellerClient, "findExactLine" | "createThreeHourTrial">
): Promise<"complete" | "reconcile" | "review"> {
  try {
    if (!(await store.isEligible(job.id, job.userId))) {
      await store.requireReview(job.id, "User received access before automatic trial provisioning.");
      return "review";
    }
    let line = await provider.findExactLine(job.username, job.password, job.userId);
    if (!line && !job.createAttemptedAt) {
      await store.markCreateAttempted(job.id);
      try {
        await provider.createThreeHourTrial({
          userId: job.userId,
          username: job.username,
          password: job.password
        });
      } catch {
        await store.deferReconciliation(job.id, "Provider create result was not confirmed.");
        return "reconcile";
      }
      line = await provider.findExactLine(job.username, job.password, job.userId);
    }
    if (!line) {
      await store.deferReconciliation(job.id, "Provider line is not visible yet.");
      return "reconcile";
    }
    await store.markVerified(job.id, line);
    await store.complete(job.id, line);
    return "complete";
  } catch (error) {
    if (error instanceof InvalidProviderLineError || error instanceof AutoTrialConflictError) {
      await store.requireReview(job.id, error.message);
      return "review";
    }
    await store.deferReconciliation(job.id, "Provider or database operation could not be confirmed.");
    return "reconcile";
  }
}
