import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminCookieOptions } from "./auth-config";
import { requireEnv, supabaseUrl } from "./env";

/**
 * Acts as the signed-in administrator (their Supabase Auth JWT), so `auth.uid()`
 * works inside admin database functions. Never give this client the secret key.
 */
export async function createAdminClient() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl(),
    requireEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    {
      cookieOptions: adminCookieOptions,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies; token refresh belongs in proxy.ts.
          }
        },
      },
    },
  );
}
