import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import type { Dashboard } from "@/lib/contracts";
import { RefreshButton } from "../me/refresh-button";
import { Controls } from "./controls";
import { AdminNav } from "./nav";

export default async function AdminPage() {
  const db = await requireAdmin();
  const { data, error } = await db.rpc("admin_dashboard");
  if (error) throw new Error(`admin_dashboard failed: ${error.message}`);
  const event = data as Dashboard;
  const turnout = event.eligible ? Math.round((event.ballots_cast / event.eligible) * 100) : 0;
  const counts: [string, string | number][] = [
    ["Registered", event.registered],
    ["Eligible", event.eligible],
    ["Voted", event.ballots_cast],
    ["Not voted", event.eligible - event.ballots_cast],
    ["Turnout", `${turnout}%`],
    ["Guest limit", event.max_active_guests],
  ];

  return (
    <>
      <AdminNav />
      <h1 className="title">Dashboard</h1>
      <dl className="grid grid-cols-2 gap-3">
        {counts.map(([label, value]) => (
          <div key={label} className="card gap-1 text-center">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
      <RefreshButton />
      {event.voting_status === "closed" && (
        <Link href="/admin/presentation" prefetch={false} className="btn">
          Open winners presentation
        </Link>
      )}
      <Controls registrationOpen={event.registration_open} voting={event.voting_status} />
    </>
  );
}
