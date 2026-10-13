const THREE_HOUR_TRIAL_PACKAGE_ID = "4";
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const MINIMUM_TRIAL_REMAINING_MS = 2 * 60 * 60 * 1000 + 55 * 60 * 1000;
const PROVIDER_EXPIRY_SKEW_MS = 5 * 60 * 1000;

export type VerifiedProviderLine = {
  id: string;
  username: string;
  password: string;
  expiresAt: string;
};

type ResellerClientOptions = {
  url: string;
  apiKey: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

type ProviderEnvelope = { status?: string; data?: unknown };

export class InvalidProviderLineError extends Error {}

function parseProviderLine(value: unknown, expectedUsername: string, expectedPassword: string, userId: string, now: number): VerifiedProviderLine {
  if (!value || typeof value !== "object") {
    throw new InvalidProviderLineError("Provider line is invalid.");
  }
  const line = value as Record<string, unknown>;
  const id = String(line.id ?? "").trim();
  const username = String(line.username ?? "").trim();
  const password = String(line.password ?? "").trim();
  const expirySeconds = Number(line.exp_date);
  if (!/^\d+$/.test(id)) {
    throw new InvalidProviderLineError("Provider line ID is invalid.");
  }
  if (username !== expectedUsername) {
    throw new InvalidProviderLineError("Provider username mismatch.");
  }
  if (password !== expectedPassword) {
    throw new InvalidProviderLineError("Provider password mismatch.");
  }
  if (String(line.reseller_notes ?? "").trim() !== `Flixify auto trial user:${userId}`) {
    throw new InvalidProviderLineError("Provider line ownership note mismatch.");
  }
  if (String(line.is_trial ?? "") !== "1") {
    throw new InvalidProviderLineError("Provider line is not a trial.");
  }
  if (String(line.enabled ?? "") !== "1" || String(line.admin_enabled ?? "") !== "1") {
    throw new InvalidProviderLineError("Provider trial line is disabled.");
  }
  if (
    !Number.isSafeInteger(expirySeconds) ||
    expirySeconds * 1000 < now + MINIMUM_TRIAL_REMAINING_MS ||
    expirySeconds * 1000 > now + THREE_HOURS_MS + PROVIDER_EXPIRY_SKEW_MS
  ) {
    throw new InvalidProviderLineError("Provider trial expiry is invalid.");
  }
  return { id, username, password, expiresAt: new Date(expirySeconds * 1000).toISOString() };
}

export function createResellerClient(options: ResellerClientOptions) {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(action: string, params: Record<string, string>): Promise<unknown> {
    const body = new URLSearchParams({ api_key: options.apiKey, action, ...params });
    const response = await fetchImpl(options.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(20_000)
    });
    let envelope: ProviderEnvelope;
    try {
      envelope = await response.json() as ProviderEnvelope;
    } catch {
      throw new Error(`Provider ${action} response is not JSON.`);
    }
    if (!response.ok || envelope.status !== "STATUS_SUCCESS") {
      throw new Error(`Provider ${action} request failed (HTTP ${response.status}).`);
    }
    return envelope.data;
  }

  return {
    async findExactLine(username: string, password: string, userId: string): Promise<VerifiedProviderLine | null> {
      const data = await request("get_lines", { line_username: username, start: "0", limit: "20" });
      if (!Array.isArray(data)) {
        throw new Error("Provider get_lines response has no line list.");
      }
      const matches = data.filter((value) =>
        value && typeof value === "object" && String((value as Record<string, unknown>).username ?? "").trim() === username
      );
      if (matches.length > 1) {
        throw new InvalidProviderLineError("Provider returned duplicate exact usernames.");
      }
      return matches.length ? parseProviderLine(matches[0], username, password, userId, now()) : null;
    },

    async createThreeHourTrial(input: { userId: string; username: string; password: string }): Promise<void> {
      if (!/^[A-Z0-9]{16}$/.test(input.username) || !/^[A-Z0-9]{16}$/.test(input.password) || input.password === input.username) {
        throw new Error("Trial provider credentials are invalid.");
      }
      await request("create_line", {
        package: THREE_HOUR_TRIAL_PACKAGE_ID,
        trial: "1",
        username: input.username,
        password: input.password,
        reseller_notes: `Flixify auto trial user:${input.userId}`
      });
    }
  };
}

export type ResellerClient = ReturnType<typeof createResellerClient>;
