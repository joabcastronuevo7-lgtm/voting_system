"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { hashToken } from "@/lib/guest";
import { newToken } from "@/lib/session-cookie";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/supabase/env";

const GENERIC = "Something went wrong. Please try again.";

const ERRORS: Record<string, string> = {
  INVALID_NAME: "Enter a full name, using 2 to 80 characters.",
  DUPLICATE_NAME: "That name is already on the list. Add a middle initial to tell them apart.",
  GUEST_LIMIT_REACHED: "The guest list is full.",
  REASON_REQUIRED: "Enter a reason, up to 500 characters.",
  CONFIRM_CLOSE_REQUIRED: "Tick the box to confirm closing the vote.",
  CONFIRM_REOPEN_REQUIRED: "Voting is closed. Reload this page before changing it.",
  GUEST_NOT_FOUND: "That guest no longer exists. Reload this page.",
  GUEST_REMOVED: "That guest has already been removed. Reload this page.",
  GUEST_NOT_REMOVED: "That guest is already on the list. Reload this page.",
  CONFIRM_RESET_REQUIRED: "Type RESET, in capital letters, to confirm.",
  RESET_BLOCKED: "Close registration and voting before resetting.",
};

export type AdminState = { error?: string; link?: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function failure(name: string, message: string): AdminState {
  const known = ERRORS[message];
  if (!known) console.error(`${name} failed:`, message);
  return { error: known ?? GENERIC };
}

/** Runs one admin database function as the signed-in organizer, then reloads the page data. */
async function run(name: string, args: Record<string, unknown>): Promise<AdminState> {
  const db = await requireAdmin();
  const { error } = await db.rpc(name, args);
  if (error) return failure(name, error.message);
  refresh();
  return {};
}

export type LoginState = { email: string; error?: string };

export async function signIn(_: LoginState, form: FormData): Promise<LoginState> {
  const email = text(form, "email").trim();
  const db = await createAdminClient();
  const { error } = await db.auth.signInWithPassword({ email, password: text(form, "password") });
  if (error) {
    if (error.status === 400) return { email, error: "Email or password is not correct." };
    if (error.status === 429) return { email, error: "Too many attempts. Wait a few minutes." };
    console.error("admin sign-in failed:", error.message);
    return { email, error: GENERIC };
  }
  const admin = await db.rpc("is_admin");
  if (admin.data !== true) {
    await db.auth.signOut({ scope: "local" });
    if (admin.error) console.error("is_admin failed:", admin.error.message);
    return { email, error: admin.error ? GENERIC : "This account is not an organizer." };
  }
  redirect("/admin");
}

export async function signOut() {
  const db = await createAdminClient();
  await db.auth.signOut({ scope: "local" }); // other organizer devices stay signed in
  redirect("/admin/login");
}

export async function updateSettings(_: AdminState, form: FormData) {
  const registration = text(form, "registration");
  return run("admin_update_event_settings", {
    p_registration_open: registration ? registration === "open" : null,
    p_voting_status: text(form, "voting") || null,
    p_confirm_close: form.get("confirm_close") === "on",
    p_confirm_reopen: form.get("confirm_reopen") === "on",
    p_reopen_reason: text(form, "reason") || null,
  });
}

export async function resetEvent(_: AdminState, form: FormData) {
  return run("admin_reset_event", { p_confirm: text(form, "confirm") });
}

export async function addGuest(_: AdminState, form: FormData) {
  return run("admin_add_guest", { p_name: text(form, "name") });
}

export async function removeGuest(_: AdminState, form: FormData) {
  return run("admin_remove_guest", {
    p_guest_id: text(form, "id"),
    p_reason: text(form, "reason"),
  });
}

export async function restoreGuest(_: AdminState, form: FormData) {
  return run("admin_restore_guest", { p_guest_id: text(form, "id") });
}

/** The link is returned once. Only the hash of its token is stored. */
export async function issueClaim(_: AdminState, form: FormData): Promise<AdminState> {
  const db = await requireAdmin();
  const site = requireEnv("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL);
  const token = newToken();
  const { error } = await db.rpc("admin_issue_claim", {
    p_guest_id: text(form, "id"),
    p_token_hash: hashToken(token),
  });
  if (error) return failure("admin_issue_claim", error.message);
  return { link: new URL(`/claim/${token}`, site).href };
}
