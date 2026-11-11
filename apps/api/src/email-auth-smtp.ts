import MailComposer from "nodemailer/lib/mail-composer";
import SMTPConnection, { type SMTPConnectionOptions } from "nodemailer/lib/smtp-connection";
import type { EmailSmtpConfiguration } from "./email-auth-config.js";
import { EmailAuthError, normalizeEmail } from "./email-auth.js";

const SEND_TIMEOUT_MS = 12_000;
type OpenConnection = (options: SMTPConnectionOptions) => SMTPConnection;

export class SmtpEmailSender {
  constructor(
    private readonly config: EmailSmtpConfiguration,
    private readonly openConnection: OpenConnection = options => new SMTPConnection(options)
  ) {}

  async send(email: string, code: string) {
    try {
      const recipient = normalizeEmail(email);
      if (!/^[0-9]{6}$/.test(code)) throw new Error("Invalid email delivery input");
      const message = await new MailComposer({
        from: { name: "Flixify", address: this.config.from },
        to: [{ address: recipient }],
        subject: "Doğrulama kodunuz",
        text: `Doğrulama kodunuz: ${code}. Kod 5 dakika geçerlidir.`,
        disableFileAccess: true,
        disableUrlAccess: true
      }).compile().build();
      await this.deliver(recipient, message);
    } catch {
      throw new EmailAuthError(503, "delivery_unavailable");
    }
  }

  private deliver(recipient: string, message: Buffer) {
    const { host, port, from, user, password } = this.config;
    const secure = port === 465;
    const connection = this.openConnection({
      host,
      port,
      secure,
      requireTLS: !secure,
      tls: { servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 8_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
      dnsTimeout: 4_000,
      maxResponseSize: 16_384,
      logger: false,
      debug: false,
      transactionLog: false
    });

    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (accepted: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        connection.close();
        if (accepted) resolve();
        else reject(new Error("SMTP delivery was not acknowledged"));
      };
      const deadline = setTimeout(() => finish(false), SEND_TIMEOUT_MS);
      deadline.unref();
      connection.on("error", () => finish(false));
      connection.once("end", () => finish(false));

      try {
        connection.connect(() => {
          if (finished) return;
          if (!connection.secure) return finish(false);
          connection.login({ user, pass: password }, error => {
            if (finished) return;
            if (error || !connection.authenticated) return finish(false);
            connection.send({ from, to: [recipient] }, message, (sendError, result) => {
              finish(!sendError && result?.accepted.length === 1 && result.accepted[0] === recipient);
            });
          });
        });
      } catch {
        finish(false);
      }
    });
  }
}
