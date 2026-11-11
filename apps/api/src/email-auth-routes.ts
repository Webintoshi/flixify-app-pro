import type { FastifyInstance } from "fastify";
import { errors as joseErrors } from "jose";
import { z } from "zod";
import { EMAIL_AUTH_WEB_ORIGINS } from "./email-auth-config.js";
import { EmailAuthError, type EmailAuthOwner, type EmailAuthService } from "./email-auth.js";
import { BlockedUserRouteError, UnauthorizedUserRouteError } from "./user-route-error.js";

const requestSchema = z.object({
  email: z.string().min(1).max(254),
  intent: z.enum(["login", "register"]),
  installationId: z.string().min(8).max(200),
  platform: z.literal("web"),
  deviceName: z.string().trim().min(1).max(80),
  existingCode: z.string().regex(/^[A-Z0-9]{16}$/).optional(),
  referralCode: z.string().regex(/^[A-Z2-9]{12}$/).optional()
}).strict();

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  challengeSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^[0-9]{6}$/),
  installationId: z.string().min(8).max(200)
}).strict();

const messages: Record<string, string> = {
  invalid_email: "E-posta adresinizi kontrol edip tekrar deneyin.",
  invalid_input: "Bilgileri kontrol edip tekrar deneyin.",
  invalid_referral_code: "Davet kodu geçersiz. Lütfen kontrol edin.",
  delivery_unavailable: "Doğrulama kodu şu anda gönderilemiyor. Biraz sonra tekrar deneyin.",
  temporarily_unavailable: "E-posta ile giriş şu anda kullanılamıyor.",
  origin_forbidden: "Bu adresten e-posta doğrulaması kullanılamıyor.",
  rate_limited: "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.",
  resend_cooldown: "Yeni kod istemeden önce bir dakika bekleyin.",
  invalid_or_expired: "Doğrulama kodu geçersiz veya süresi dolmuş.",
  registration_required: "Bu e-posta adresiyle hesap bulunamadı. Kayıt seçeneğiyle devam edebilirsiniz.",
  account_conflict: "E-posta adresi başka bir hesapla eşleşiyor. Destek ile iletişime geçin.",
  existing_account_unverified: "Mevcut hesabın giriş kodunu kontrol edin.",
  reauthentication_required: "Hesabınızı bağlamak için mevcut hesabınızla yeniden giriş yapın.",
  account_unavailable: "Bu hesaba şu anda giriş yapılamıyor.",
  installation_limit: "Bu cihazda daha önce hesap oluşturulmuş. Mevcut hesabınızla giriş yapın.",
  registration_ip_limit: "Bu internet bağlantısından en fazla iki hesap oluşturulabilir."
};

type Dependencies = {
  service: Pick<EmailAuthService, "request" | "verify"> | null;
  authenticate: (authorization?: string) => Promise<EmailAuthOwner>;
};

export function registerEmailAuthRoutes(app: FastifyInstance, { service, authenticate }: Dependencies) {
  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "no-store").header("pragma", "no-cache").header("referrer-policy", "no-referrer");
    });

    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof EmailAuthError && Object.hasOwn(messages, error.reason)) {
        if (error.retryAfterSeconds) reply.header("retry-after", error.retryAfterSeconds);
        return reply.code(error.statusCode).send({
          reason: error.reason,
          message: messages[error.reason],
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
        });
      }

      const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
      const malformed = error instanceof z.ZodError || statusCode === 400 || statusCode === 413;
      const reason = malformed ? "invalid_input" : "temporarily_unavailable";
      return reply.code(malformed ? 400 : 503).send({ reason, message: messages[reason] });
    });

    routes.get("/auth/email/status", async () => ({
      enabled: service !== null,
      deliveryChannel: "email",
      ...(service ? {} : { reason: "not_configured" })
    }));

    routes.addHook("preHandler", async request => {
      if (request.method !== "POST") return;
      if (!service) throw new EmailAuthError(503, "temporarily_unavailable");
      if (!EMAIL_AUTH_WEB_ORIGINS.includes(request.headers.origin ?? "")) throw new EmailAuthError(403, "origin_forbidden");
    });

    routes.post("/auth/email/request", { bodyLimit: 2048 }, async request => {
      const input = requestSchema.parse(request.body);
      if (input.intent === "login" && input.existingCode) throw new EmailAuthError(400, "invalid_input");
      let owner: EmailAuthOwner | undefined;
      if (input.intent === "register" && request.headers.authorization) {
        try {
          owner = await authenticate(request.headers.authorization);
        } catch (error) {
          if (error instanceof BlockedUserRouteError) throw new EmailAuthError(403, "account_unavailable");
          if (error instanceof UnauthorizedUserRouteError || error instanceof joseErrors.JOSEError) throw new EmailAuthError(401, "existing_account_unverified");
          throw new EmailAuthError(503, "temporarily_unavailable");
        }
      }
      return service!.request(input, request.ip, owner);
    });

    routes.post("/auth/email/verify", { bodyLimit: 2048 }, async request =>
      service!.verify(verifySchema.parse(request.body), request.ip)
    );
  });
}
