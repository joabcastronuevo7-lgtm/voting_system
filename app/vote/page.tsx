import { redirect } from "next/navigation";
import type { Ballot } from "@/lib/contracts";
import { getGuest } from "@/lib/guest";
import { createSecretClient } from "@/lib/supabase/secret";
import { BallotForm } from "./ballot-form";

export default async function VotePage() {
  const guest = await getGuest();
  if (!guest) redirect("/");
  if (guest.has_voted || guest.voting_status !== "open") redirect("/me");

  const { data, error } = await createSecretClient().rpc("ballot_nominees", {
    p_token_hash: guest.hash,
  });
  // state changed between the two calls: /me shows the current one
  if (error?.message === "VOTING_NOT_OPEN" || error?.message === "ALREADY_VOTED") redirect("/me");
  if (error) throw new Error(`ballot_nominees failed: ${error.message}`);

  return (
    <>
      <noscript>
        <p className="error">Voting needs JavaScript. Turn it on, then reload this page.</p>
      </noscript>
      <BallotForm {...(data as Ballot)} />
    </>
  );
}
