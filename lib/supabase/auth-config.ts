// Shared by proxy.ts and server code, so the admin auth cookie is written one way.

// No browser Supabase client exists, so the auth cookie can be HttpOnly.
export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};
