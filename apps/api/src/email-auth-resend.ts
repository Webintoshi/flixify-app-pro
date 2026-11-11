import { EmailAuthError, normalizeEmail } from "./email-auth.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const MAX_RESPONSE_BYTES = 16_384;

async function readAcknowledgement(response: Response): Promise<unknown> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Email delivery was not acknowledged");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Email delivery response exceeded its size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export class ResendEmailSender {
  constructor(
    private readonly config: { from: string; apiKey: string },
    private readonly request: typeof fetch = fetch
  ) {}

  async send(email: string, code: string) {
    try {
      const recipient = normalizeEmail(email);
      if (!/^[0-9]{6}$/.test(code)) throw new Error("Invalid email delivery input");
      const response = await this.request(RESEND_EMAILS_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: `Flixify <${this.config.from}>`,
          to: [recipient],
          subject: "Doğrulama kodunuz",
          text: `Doğrulama kodunuz: ${code}. Kod 5 dakika geçerlidir.`
        })
      });
      const payload = await readAcknowledgement(response);
      if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string" || !/^[\x21-\x7e]{1,128}$/.test(payload.id) || "error" in payload) {
        throw new Error("Email delivery was not acknowledged");
      }
    } catch {
      throw new EmailAuthError(503, "delivery_unavailable");
    }
  }
}
