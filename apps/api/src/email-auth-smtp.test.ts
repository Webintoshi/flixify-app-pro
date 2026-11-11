import { EventEmitter } from "node:events";
import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type SMTPConnection from "nodemailer/lib/smtp-connection";
import type { SMTPConnectionOptions } from "nodemailer/lib/smtp-connection";
import { describe, expect, it, vi } from "vitest";
import { resolveEmailAuthConfiguration } from "./email-auth-config.js";
import { SmtpEmailSender } from "./email-auth-smtp.js";

const config = {
  host: "mail.example.com",
  port: 587,
  from: "verify@example.com",
  user: "verify@example.com",
  password: "fixture-password"
};
const env = {
  EMAIL_AUTH_ENABLED: true,
  APP_DEMO_MODE: false,
  EMAIL_AUTH_TRANSPORT: "smtp" as const,
  EMAIL_AUTH_SECRET: "e".repeat(32),
  EMAIL_AUTH_FROM: config.from,
  EMAIL_SMTP_HOST: config.host,
  EMAIL_SMTP_USER: config.user,
  EMAIL_SMTP_PASSWORD: config.password,
  APP_JWT_SECRET: "j".repeat(32),
  REGISTRATION_GUARD_SECRET: "r".repeat(32)
};

class FakeConnection extends EventEmitter {
  secure = true;
  authenticated = false;
  connect = vi.fn((ready: () => void) => ready());
  login = vi.fn((_credentials: unknown, done: (error: Error | null) => void) => {
    this.authenticated = true;
    done(null);
  });
  send = vi.fn((_envelope: unknown, _message: Buffer, done: (error: Error | null, result: { accepted: string[] }) => void) => {
    done(null, { accepted: ["viewer@example.com"] });
  });
  close = vi.fn();
}

describe("authenticated SMTP OTP delivery", () => {
  it("requires an explicit SMTP account and validates its hostname and port", () => {
    expect(resolveEmailAuthConfiguration(env)).toEqual({ ...config, secret: env.EMAIL_AUTH_SECRET, transport: "smtp" });
    expect(resolveEmailAuthConfiguration({ ...env, EMAIL_SMTP_PORT: "465" })).toMatchObject({ port: 465, transport: "smtp" });
    expect(resolveEmailAuthConfiguration({ ...env, EMAIL_SMTP_PASSWORD: undefined, RESEND_API_KEY: "re_fixture" })).toBeNull();
    expect(resolveEmailAuthConfiguration({ ...env, EMAIL_SMTP_HOST: "https://mail.example.com" })).toBeNull();
    expect(resolveEmailAuthConfiguration({ ...env, EMAIL_SMTP_PORT: "65536" })).toBeNull();
  });

  it.each([465, 587])("sends the code over authenticated TLS on port %d", async port => {
    const connection = new FakeConnection();
    const open = vi.fn((_options: SMTPConnectionOptions) => connection as unknown as SMTPConnection);
    await new SmtpEmailSender({ ...config, port }, open).send("viewer@example.com", "012345");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      host: config.host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      tls: { servername: config.host, rejectUnauthorized: true, minVersion: "TLSv1.2" }
    }));
    expect(connection.login).toHaveBeenCalledWith({ user: config.user, pass: config.password }, expect.any(Function));
    expect(connection.send.mock.calls[0][0]).toEqual({ from: config.from, to: ["viewer@example.com"] });
    expect(connection.send.mock.calls[0][1].toString()).toContain("012345");
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("closes a stalled connection before any late authentication or delivery", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const connection = new FakeConnection();
      const connected = new Promise<void>(resolve => {
        connection.connect.mockImplementation(() => resolve());
      });
      const sender = new SmtpEmailSender(config, () => connection as unknown as SMTPConnection);
      const rejection = expect(sender.send("viewer@example.com", "012345")).rejects.toMatchObject({ reason: "delivery_unavailable" });
      await connected;
      await vi.advanceTimersByTimeAsync(12_001);
      await rejection;
      expect(connection.close).toHaveBeenCalledOnce();
      connection.connect.mock.calls[0][0]();
      expect(connection.login).not.toHaveBeenCalled();
      expect(connection.send).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("refuses SMTP when a local server offers authentication without STARTTLS", async () => {
    const commands: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
      sockets.add(socket);
      let remainder = "";
      socket.write("220 localhost ESMTP test fixture\r\n");
      socket.on("data", chunk => {
        const lines = (remainder + chunk.toString()).split("\r\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          commands.push(line);
          if (line.startsWith("EHLO ")) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          else socket.write("454 TLS unavailable\r\n");
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const sender = new SmtpEmailSender({ ...config, host: "localhost", port });
      await expect(sender.send("viewer@example.com", "012345")).rejects.toMatchObject({ statusCode: 503, reason: "delivery_unavailable", message: "delivery_unavailable" });
      expect(commands).toContain("STARTTLS");
      expect(commands.some(command => /^(AUTH|MAIL FROM|RCPT TO|DATA)\b/.test(command))).toBe(false);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
