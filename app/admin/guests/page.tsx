import { requireAdmin } from "@/lib/admin";
import type { AdminGuest } from "@/lib/contracts";
import { AdminNav } from "../nav";
import { GuestList } from "./guest-list";

export default async function GuestsPage() {
  const db = await requireAdmin();
  const { data, error } = await db.rpc("admin_list_guests");
  if (error) throw new Error(`admin_list_guests failed: ${error.message}`);

  return (
    <>
      <AdminNav />
      <h1 className="title">Guests</h1>
      <GuestList guests={data as AdminGuest[]} />
    </>
  );
}
