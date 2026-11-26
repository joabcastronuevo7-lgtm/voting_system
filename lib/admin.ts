import "server-only";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabase/admin";

/**
 * The signed-in administrator's client, or a redirect to the login page. Call it in
 * every admin page and action. The database functions check again.
 */
export async function requireAdmin() {
  const db = await createAdminClient();
  // asks the Auth server, so a signed-out or deleted account is refused
  const { data, error } = await db.auth.getUser();
  if (error?.name === "AuthRetryableFetchError") {
    throw new Error(`admin sign-in check failed: ${error.message}`);
  }
  if (!data.user) redirect("/admin/login");

  const admin = await db.rpc("is_admin");
  if (admin.error) throw new Error(`is_admin failed: ${admin.error.message}`);
  if (admin.data !== true) redirect("/admin/login");
  return db;
}
