import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ClaimPreview } from "@/lib/contracts";
import { getGuest, guestBySession, hashToken } from "@/lib/guest";
import { SESSION_COOKIE, claimSessionToken, isToken } from "@/lib/session-cookie";
import { createSecretClient } from "@/lib/supabase/secret";
import { ConfirmForm } from "./confirm-form";

// The address itself is the secret: keep it out of referrers and search engines.
// `strict-origin` sends the site name only. `no-referrer` would also send `Origin: null`
// with a form posted before JavaScript loads, and Next rejects that.
export const metadata: Metadata = {
  referrer: "strict-origin",
  robots: { index: false, follow: false },
};

/** Opening the link only reads: it is used when the guest taps Confirm. */
export default async function ClaimPage({ params }: PageProps<"/claim/[token]">) {
  const { token } = await params;
  const guest = await getGuest();
  let preview: ClaimPreview = { ok: false, error: "INVALID_CLAIM" };
  if (isToken(token)) {
    const { data, error } = await createSecretClient().rpc("claim_preview", {
      p_claim_hash: hashToken(token),
    });
    if (error) throw new Error(`claim_preview failed: ${error.message}`);
    preview = data as ClaimPreview;

    // This browser already confirmed the link but never got the reply: offer Confirm again.
    const browserToken = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!preview.ok && isToken(browserToken)) {
      const mine = await guestBySession(hashToken(claimSessionToken(browserToken, token)));
      if (mine) preview = { ok: true, full_name: mine.full_name };
    }
  }

  // A spent link on a signed-in phone is often a second tap on Confirm: say where things
  // stand first, and make the way on the main button.
  if (!preview.ok && guest) {
    return (
      <section className="card text-center">
        <h1 className="subtitle break-words">You are signed in as {guest.full_name}</h1>
        <p className="lead">
          This link cannot be used: it was already used or has expired. If that is your name,
          you are all set. If not, ask the host for a new link.
        </p>
        <Link href="/me" className="btn">Go to my page</Link>
      </section>
    );
  }

  return (
    <section className="card text-center">
      <h1 className="subtitle break-words">
        {preview.ok ? `Are you ${preview.full_name}?` : "This link cannot be used"}
      </h1>
      {preview.ok ? (
        <>
          {guest && (
            <p className="lead break-words">This phone is signed in as {guest.full_name}.</p>
          )}
          <p className="lead">
            Confirm to continue on this phone. Any other phone using this name is signed out.
          </p>
          <ConfirmForm token={token} />
          {guest && <Link href="/me" className="link self-center">Go to my page</Link>}
        </>
      ) : (
        <p className="lead">Please ask the host for a new one.</p>
      )}
    </section>
  );
}
