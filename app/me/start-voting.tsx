"use client";

import Link, { useLinkStatus } from "next/link";

// On slow Wi-Fi the ballot can take a while to arrive. The link stays tappable.
function Label() {
  const { pending } = useLinkStatus();
  return <span role="status">{pending ? "Opening the ballot…" : "Start voting"}</span>;
}

export function StartVoting() {
  return (
    <Link href="/vote" className="btn">
      <Label />
    </Link>
  );
}
