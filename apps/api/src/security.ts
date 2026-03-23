import crypto from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import type { JWTPayload } from "jose";
import { env } from "./env.js";

const textEncoder = new TextEncoder();
const jwtKey = textEncoder.encode(env.APP_JWT_SECRET);

export async function hashSecret(secret: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(secret, salt, 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key as Buffer);
    });
  });

  return `${salt}:${derivedKey.toString("hex")}`;
}

export function createCodeLookup(secret: string) {
  return crypto.createHmac("sha256", env.APP_JWT_SECRET).update(secret).digest("hex");
}

export async function verifySecret(secret: string, digest: string) {
  const [salt, storedKey] = digest.split(":");
  if (!salt || !storedKey) {
    return false;
  }

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(secret, salt, 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key as Buffer);
    });
  });

  return crypto.timingSafeEqual(Buffer.from(storedKey, "hex"), derivedKey);
}

export function generateKryptoniteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 16 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join("");
}

export function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

export async function signAccessToken(payload: { userId: string; sessionId: string }) {
  return new SignJWT({
    sub: payload.userId,
    sid: payload.sessionId,
    typ: "access"
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(jwtKey);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, jwtKey);
  return payload as JWTPayload & { sub: string; sid: string };
}

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function verifyAdminToken(token: string) {
  if (!env.SUPABASE_JWKS_URL || !env.SUPABASE_URL) {
    throw new Error("Supabase admin auth is not configured.");
  }

  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL));
  }

  const { payload } = await jwtVerify(token, remoteJwks, {
    issuer: `${env.SUPABASE_URL}/auth/v1`
  });

  const email = payload.email ? String(payload.email).toLowerCase() : null;
  if (!email || !env.adminEmails.includes(email)) {
    throw new Error("Admin email is not allowed.");
  }

  return {
    adminId: String(payload.sub),
    email
  };
}
