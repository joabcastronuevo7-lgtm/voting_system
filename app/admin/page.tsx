import Link from "next/link";
import type { CSSProperties } from "react";
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
        {counts.map(([label, value], i) => {
          const ring = label === "Turnout";
          return (
            <div
              key={label}
              className={`card rise gap-1 text-center ${ring ? "order-first col-span-2" : ""}`}
              style={{ "--i": i } as CSSProperties}
            >
              <dt className="text-sm text-muted">{label}</dt>
              <dd
                className={ring ? "turnout-ring" : "text-2xl"}
                style={ring ? ({ "--turn": turnout } as CSSProperties) : undefined}
              >
                {value}
              </dd>
            </div>
          );
        })}
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
