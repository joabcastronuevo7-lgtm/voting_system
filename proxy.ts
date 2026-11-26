import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, cookieOptions, newToken } from "@/lib/session-cookie";
import { adminCookieOptions } from "@/lib/supabase/auth-config";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return refreshAdmin(request);
  return issueGuestToken(request);
}

/**
 * Gives the browser its token before it registers or claims. If the reply to either is
 * lost, the browser already holds the token and is recognised on the next visit.
 * The token means nothing until the database stores its hash for a guest.
 */
function issueGuestToken(request: NextRequest) {
  const response = NextResponse.next();
  // Page loads only: a token set on the registration request itself would be visible to
  // that action, which could then save a guest the browser never hears about.
  // Never replaced here, so an existing session is neither overwritten nor extended.
  if (request.method === "GET" && !request.cookies.has(SESSION_COOKIE)) {
    response.cookies.set(SESSION_COOKIE, newToken(), cookieOptions());
  }
  return response;
}

/**
 * Server Components cannot set cookies, so an expired admin token is renewed here.
 * It does not authorize anything: pages and actions call requireAdmin().
 */
async function refreshAdmin(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: adminCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );
  await supabase.auth.getClaims();
  return response;
}

export const config = { matcher: ["/", "/claim/:path*", "/admin/:path*"] };
