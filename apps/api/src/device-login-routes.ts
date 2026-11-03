import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errors as joseErrors } from 'jose';
import { UnauthorizedUserRouteError, BlockedUserRouteError } from './user-route-error.js';
import { DeviceLoginError, type DeviceLoginService } from './device-login.js';
import type { PhoneIdentity } from './device-login-store.js';

const targetSchema = z.object({ requestId: z.string().uuid(), deviceSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const startSchema = z.object({ platform: z.enum(['android_tv','web','macos','windows']), deviceName: z.string().trim().min(1).max(80), installationId: z.string().min(8).max(200).optional() }).strict();
const codeSchema = z.string().min(8).max(9);
const lookupSchema = z.object({ code: codeSchema }).strict();
const decisionSchema = z.object({ requestId: z.string().uuid(), userCode: codeSchema, approvalNonce: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['approve','deny']) }).strict();
export function registerDeviceLoginRoutes(app: FastifyInstance, deps: {
  service: DeviceLoginService; authenticate: (authorization?: string) => Promise<PhoneIdentity>;
  enabled?: boolean; allowedOrigins?: readonly string[];
}) {
  app.register(async (routes) => {
    routes.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control','no-store').header('pragma','no-cache').header('referrer-policy','no-referrer');
    });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof DeviceLoginError) return reply.code(error.statusCode).send({ reason: error.reason, message: error.message });
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      const malformed = error instanceof z.ZodError || statusCode === 400 || statusCode === 413;
      return reply.code(malformed ? 400 : 503).send({ reason: malformed ? 'invalid_input' : 'temporarily_unavailable', message: 'Cihaz baglama islemi tamamlanamadi.' });
    });
    routes.addHook('preHandler', async () => { if (deps.enabled === false) throw new DeviceLoginError(503,'temporarily_unavailable'); });
    routes.post('/auth/device/start', { bodyLimit: 2048 }, async (request) => deps.service.start(startSchema.parse(request.body), request.ip));
    for (const operation of ['token','ack','cancel'] as const) {
      routes.post(`/auth/device/${operation}`, { bodyLimit: 2048 }, async (request) => deps.service.target(operation, targetSchema.parse(request.body)));
    }
    async function phone(headers: { origin?: string; authorization?: string }) {
      if (!(deps.allowedOrigins ?? ['https://flixify.vip']).includes(headers.origin ?? '')) throw new DeviceLoginError(403,'origin_forbidden');
      if (!/^Bearer\s+\S+$/i.test(headers.authorization ?? '')) throw new DeviceLoginError(401,'authentication_required');
      try { return await deps.authenticate(headers.authorization); }
      catch (error) {
        if (error instanceof DeviceLoginError) throw error;
        if (error instanceof BlockedUserRouteError) throw new DeviceLoginError(403,'account_unavailable');
        if (error instanceof UnauthorizedUserRouteError || error instanceof joseErrors.JOSEError) throw new DeviceLoginError(401,'authentication_required');
        throw error;
      }
    }
    routes.post('/auth/device/lookup', { bodyLimit: 2048 }, async (request) => {
      const auth = await phone(request.headers); return deps.service.lookup(lookupSchema.parse(request.body).code, auth, request.ip);
    });
    routes.post('/auth/device/decision', { bodyLimit: 2048 }, async (request) => {
      const auth = await phone(request.headers); return deps.service.decision(decisionSchema.parse(request.body), auth, request.ip);
    });
  });
}
