import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// Server-only. Never import this from a "use client" component.
//
// Having profiles.role === 'admin' is necessary but NOT sufficient to use
// admin features. A session must also carry this signed cookie, which is
// only ever issued by signInAdmin() after it verifies role === 'admin' for
// a login that went through /admin/login. This stops an admin's own account
// from silently gaining admin UI/access just because it happened to
// authenticate through the student OTP screen (same email, wrong door).

export const ADMIN_SESSION_COOKIE = "admin_mode_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function getSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function createAdminSession(userId: string) {
  const secret = getSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET 환경변수가 설정되지 않았습니다.");
  }

  const issuedAt = Date.now().toString();
  const payload = `${userId}.${issuedAt}`;
  const token = `${payload}.${sign(payload, secret)}`;

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

// Fail-closed: any missing secret, missing cookie, malformed token, user
// mismatch, expiry, or signature mismatch returns false. Never throws.
export async function verifyAdminSession(userId: string | undefined | null): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const secret = getSecret();
  if (!secret) {
    return false;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const [tokenUserId, issuedAt, signature] = parts;

  if (tokenUserId !== userId) {
    return false;
  }

  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) {
    return false;
  }
  if (Date.now() - issuedAtMs > ADMIN_SESSION_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  const expected = sign(`${tokenUserId}.${issuedAt}`, secret);
  const actualBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(actualBuf, expectedBuf);
}
