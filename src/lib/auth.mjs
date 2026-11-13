// MIT. Owner session auth for a single-owner independent studio.
// The passphrase is a server secret; only an HMAC cookie reaches the browser.

import { constantTimeEqual, HttpError, now, text } from "./util.mjs";

const COOKIE = "studio_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function encode(value) {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
}

async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(secret, payload) {
  const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(env, actor = "owner") {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new HttpError(500, "Studio session secret is not configured", "not_configured");
  const payload = encode({ actor, issued: now(), expires: now() + SESSION_MS });
  return `${payload}.${await sign(env.SESSION_SECRET, payload)}`;
}

export async function readSession(env, request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature) return null;
  if (!env.SESSION_SECRET) return null;
  const expected = await sign(env.SESSION_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const session = decode(payload);
    if (!session || session.expires < now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** A short-lived handoff from App Composer's authenticated owner session.
 * The browser never holds the Oyster owner key or this studio's passphrase. */
export async function readBridgeToken(env, token) {
  if (!env.BRIDGE_SECRET || env.BRIDGE_SECRET.length < 32) return null;
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(env.BRIDGE_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const claim = decode(payload);
    if (!claim || claim.aud !== "media-studio" || claim.sub !== "owner") return null;
    if (typeof claim.exp !== "number" || claim.exp < now()) return null;
    return claim;
  } catch {
    return null;
  }
}

export async function requireOwner(env, request) {
  const session = await readSession(env, request);
  if (!session || session.actor !== "owner")
    throw new HttpError(401, "Sign in to open the studio", "unauthorized");
  return session;
}

/** Bounded per-IP login attempts. D1 is the shared authority, not the isolate. */
export async function checkLoginRate(env, ip) {
  const timestamp = now();
  const resetAt = timestamp + 15 * 60 * 1000;
  await env.DB.prepare(
    "INSERT INTO login_attempts(ip,count,reset_at) VALUES(?1,0,?2) ON CONFLICT(ip) DO NOTHING",
  )
    .bind(ip, resetAt)
    .run();
  const row = await env.DB.prepare("SELECT count,reset_at FROM login_attempts WHERE ip=?1")
    .bind(ip)
    .first();
  if (row && row.reset_at < timestamp) {
    await env.DB.prepare("UPDATE login_attempts SET count=0, reset_at=?2 WHERE ip=?1")
      .bind(ip, resetAt)
      .run();
    return { allowed: true };
  }
  if (row && row.count >= 10)
    throw new HttpError(429, "Too many attempts. Try again in a few minutes.", "rate_limited");
  return { allowed: true };
}

export async function recordLoginFailure(env, ip) {
  await env.DB.prepare(
    "UPDATE login_attempts SET count=count+1 WHERE ip=?1",
  )
    .bind(ip)
    .run();
}

export async function verifyPassphrase(env, input) {
  if (!env.OWNER_PASSPHRASE || env.OWNER_PASSPHRASE.length < 16)
    throw new HttpError(500, "Owner passphrase is not configured", "not_configured");
  const supplied = text(input, 200, "Passphrase");
  return constantTimeEqual(supplied, env.OWNER_PASSPHRASE);
}
