"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "./actions";

const PAGES = [
  ["/admin", "Dashboard"],
  ["/admin/guests", "Guests"],
  ["/admin/qr", "QR code"],
];

export function AdminNav() {
  const path = usePathname();

  return (
    <nav aria-label="Organizer" className="tabs">
      {PAGES.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </nav>
  );
}
