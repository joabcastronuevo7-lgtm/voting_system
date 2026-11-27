import Link from "next/link";
import { signOut } from "./actions";

export function AdminNav() {
  return (
    <nav aria-label="Organizer" className="flex items-center justify-between">
      <Link href="/admin" className="link">Dashboard</Link>
      <Link href="/admin/guests" className="link">Guests</Link>
      <Link href="/admin/qr" className="link">QR code</Link>
      <form action={signOut}>
        <button type="submit" className="link">Sign out</button>
      </form>
    </nav>
  );
}
