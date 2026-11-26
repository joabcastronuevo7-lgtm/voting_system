import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import type { Results } from "@/lib/contracts";
import { winners } from "@/lib/winners";
import { RefreshButton } from "../../me/refresh-button";
import { Show } from "./show";

export const metadata: Metadata = { title: "The winners · Dinner Awards 2026" };

export default async function PresentationPage() {
  const db = await requireAdmin();
  // the database returns nothing unless voting is closed
  const { data, error } = await db.rpc("admin_results");
  if (error) throw new Error(`admin_results failed: ${error.message}`);
  const results = data as Results;

  return (
    <div className="stage">
      {results.published ? (
        // only first places are passed on, so no other total reaches the browser
        <Show awards={winners(results.results)} />
      ) : (
        <div className="stage-body">
          <div className="flex flex-col items-center gap-6">
            <p className="stage-eyebrow">Dinner Awards 2026</p>
            <h1 className="stage-heading">Results are locked until voting closes</h1>
            <div className="w-64">
              <RefreshButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
