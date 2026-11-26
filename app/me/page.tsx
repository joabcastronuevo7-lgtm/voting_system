import { redirect } from "next/navigation";
import { getGuest } from "@/lib/guest";
import { RefreshButton } from "./refresh-button";
import { StartVoting } from "./start-voting";

export default async function MePage() {
  const guest = await getGuest();
  if (!guest) redirect("/");

  const closed = guest.voting_status === "closed";
  const [heading, detail] = closed
    ? ["Voting closed", guest.has_voted ? "Your votes were recorded." : "Thank you for joining us."]
    : guest.has_voted
      ? ["You've voted", "Your votes were recorded."]
      : {
          not_started: ["Voting opens soon", "You are registered. Keep this page handy."],
          open: ["Vote now", "Choose one winner in each of three categories."],
          paused: ["Voting paused", "Please check back in a moment."],
        }[guest.voting_status as "not_started" | "open" | "paused"];
  const canVote = guest.voting_status === "open" && !guest.has_voted;

  return (
    <>
      <h1 className="title break-words">Hi, {guest.full_name}</h1>
      <section className="card text-center">
        <h2 className="subtitle">{heading}</h2>
        <p className="lead">{detail}</p>
        {canVote ? (
          <StartVoting />
        ) : (
          !closed && !guest.has_voted && <RefreshButton />
        )}
      </section>
    </>
  );
}
