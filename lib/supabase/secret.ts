import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireEnv, supabaseUrl } from "./env";

/**
 * Guest and public-results operations only. Runs as `service_role`, which carries
 * no user identity: admin functions reject it. Use `createAdminClient` for those.
 */
export function createSecretClient() {
  return createClient(
    supabaseUrl(),
    requireEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
