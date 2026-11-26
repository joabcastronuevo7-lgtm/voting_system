"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getGuest, hashToken, sessionHash } from "@/lib/guest";
import { SESSION_COOKIE, cookieOptions, isToken, newToken } from "@/lib/session-cookie";
import { createSecretClient } from "@/lib/supabase/secret";

const GENERIC = "Something went wrong. Please try again.";
const RETRY =
  "Please tap Continue to Voting again. If this message returns, allow cookies in your browser.";

const REGISTER_ERRORS: Record<string, string> = {
  INVALID_NAME: "Enter your full name, using 2 to 80 characters.",
  DUPLICATE_NAME:
    "That name is already registered. If it is you, contact the host. If you are a different person, add your middle initial.",
  REGISTRATION_CLOSED: "Registration is closed. Please see the host.",
  GUEST_LIMIT_REACHED: "The guest list is full. Please see the host.",
  RATE_LIMITED: "Many guests are registering right now. Wait a minute, then try again.",
};

export type RegisterState = { name: string; error?: string };

export async function register(_: RegisterState, form: FormData): Promise<RegisterState> {
  const name = String(form.get("name") ?? "");
  if (await getGuest()) redirect("/me");

  const jar = await cookies();
  // Nothing is saved unless the browser already holds the token (see proxy.ts).
  const retryWithNewToken = () => {
    jar.set(SESSION_COOKIE, newToken(), cookieOptions());
    return { name, error: RETRY };
  };
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!isToken(token)) return retryWithNewToken();

  const { data, error } = await createSecretClient().rpc("register_guest", {
    p_name: name,
    p_token_hash: hashToken(token),
  });
  if (error) {
    // a second tap can arrive after the first one already registered this browser
    if (await getGuest()) redirect("/me");
    // 23505: this token belonged to an earlier session that is no longer valid
    if (error.code === "23505") return retryWithNewToken();
    const message = REGISTER_ERRORS[error.message];
    if (!message) console.error("register_guest failed:", error.message);
    return { name, error: message ?? GENERIC };
  }

  // from here the cookie expires with the database session; never extended afterwards
  const { expires_at } = data as { expires_at: string };
  jar.set(SESSION_COOKIE, token, cookieOptions(new Date(expires_at)));
  redirect("/me");
}

const BALLOT_ERRORS: Record<string, string> = {
  VOTING_NOT_OPEN: "Voting is not open right now. Your votes were not submitted.",
  INVALID_NOMINEE: "One of your choices is no longer available. Please choose again.",
};

/** Returns only on failure. The database validates every selection. */
export async function submitBallot(
  picks: Record<string, string>,
): Promise<{ error: string; reload: boolean }> {
  const hash = await sessionHash();
  if (!hash) redirect("/");

  const { error } = await createSecretClient().rpc("submit_ballot", {
    p_token_hash: hash,
    p_picks: picks,
  });
  if (!error) redirect("/thanks");
  if (error.message === "INVALID_SESSION") redirect("/");
  if (error.message === "ALREADY_VOTED") redirect("/me");

  const message = BALLOT_ERRORS[error.message];
  if (!message) console.error("submit_ballot failed:", error.message);
  // Reload only when the list is stale: a reload while paused would lose the choices.
  return { error: message ?? GENERIC, reload: error.message === "INVALID_NOMINEE" };
}
