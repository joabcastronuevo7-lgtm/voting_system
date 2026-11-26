// Shared by proxy.ts and server code.
import { createHmac, randomBytes } from "node:crypto";

// The __Host- prefix stops another site or subdomain from planting a token here.
export const SESSION_COOKIE = "__Host-guest_session";

export const newToken = () => randomBytes(32).toString("base64url");
/**
 * The token for a browser whose own token already belongs to a session, when it claims a
 * link. Only that browser and link produce it, and every repeat produces the same one, so a
 * double tap or a lost reply can still be answered.
 */
export const claimSessionToken = (browserToken: string, linkToken: string) =>
  createHmac("sha256", browserToken).update(linkToken).digest("base64url");
export const isToken = (value: string | undefined): value is string =>
  /^[A-Za-z0-9_-]{43}$/.test(value ?? "");

/** After registration, pass the database expiry. Before it, 30 days from now. */
export const cookieOptions = (expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) => ({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  expires,
});
