import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { GuestState } from "./contracts";
import { SESSION_COOKIE } from "./session-cookie";
import { createSecretClient } from "./supabase/secret";

/** Only the hash ever leaves this server; the raw token lives in the HttpOnly cookie. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Hash of the visitor's session cookie. Not yet validated. */
export async function sessionHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

/** The signed-in guest, or null when there is no valid session. */
export async function getGuest() {
  const hash = await sessionHash();
  return hash ? guestBySession(hash) : null;
}

export async function guestBySession(hash: string) {
  const { data, error } = await createSecretClient().rpc("guest_me", { p_token_hash: hash });
  if (error?.message === "INVALID_SESSION") return null;
  if (error) throw new Error(`guest_me failed: ${error.message}`);
  return { hash, ...(data as GuestState) };
}
