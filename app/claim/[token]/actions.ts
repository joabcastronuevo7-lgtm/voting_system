"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { guestBySession, hashToken } from "@/lib/guest";
import {
  SESSION_COOKIE,
  claimSessionToken,
  cookieOptions,
  isToken,
  newToken,
} from "@/lib/session-cookie";
import type { ClaimResult } from "@/lib/contracts";
import { createSecretClient } from "@/lib/supabase/secret";

const GENERIC = "Something went wrong. Please try again.";
const RETRY = "Please tap Confirm again. If this message returns, allow cookies in your browser.";
const UNUSABLE = "This link cannot be used. Please ask the host for a new one.";

export type ClaimState = { error?: string };

export async function claim(_: ClaimState, form: FormData): Promise<ClaimState> {
  const link = String(form.get("token") ?? "");
  if (!isToken(link)) return { error: UNUSABLE };

  const jar = await cookies();
  // As in registration: the link is used only for a token the browser already holds.
  const browserToken = jar.get(SESSION_COOKIE)?.value;
  if (!isToken(browserToken)) {
    jar.set(SESSION_COOKIE, newToken(), cookieOptions());
    return { error: RETRY };
  }

  const claimWith = (session: string) =>
    createSecretClient().rpc("claim_guest", {
      p_claim_hash: hashToken(link),
      p_session_hash: hashToken(session),
    });

  const derived = claimSessionToken(browserToken, link);
  let session = browserToken;
  let { data, error } = await claimWith(session);
  // 23505: this browser's token already belongs to a session; the link stays unused
  if (error?.code === "23505") {
    session = derived;
    ({ data, error } = await claimWith(session));
  }
  if (error) {
    console.error("claim_guest failed:", error.message);
    return { error: GENERIC };
  }

  const result = data as ClaimResult;
  if (result.ok) {
    jar.set(SESSION_COOKIE, session, cookieOptions(new Date(result.expires_at)));
  } else {
    // a repeat of a confirm that already worked, whose reply this browser never got
    if (!(await guestBySession(hashToken(derived)))) return { error: UNUSABLE };
    // shortcut: the cookie gets a fresh 30 days and may outlive the database session by
    // the time since the first tap; that session still expires on its own
    jar.set(SESSION_COOKIE, derived, cookieOptions());
  }
  redirect("/me");
}
