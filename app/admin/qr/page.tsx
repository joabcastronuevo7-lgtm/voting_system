import type { Metadata } from "next";
import Image from "next/image";
import QRCode from "qrcode";
import { requireAdmin } from "@/lib/admin";
import { requireEnv } from "@/lib/supabase/env";
import { AdminNav } from "../nav";

export const metadata: Metadata = { title: "Guest QR code · Dinner Awards 2026" };

/** The one code every guest scans. It opens the public registration page. */
export default async function QrPage() {
  await requireAdmin();
  const site = requireEnv("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL);
  const url = new URL("/", site).href;
  const image = await QRCode.toDataURL(url, { width: 1200 });

  return (
    <>
      <AdminNav />
      <h1 className="title">Guest QR code</h1>
      <p className="lead">One code for every guest. It opens the registration page.</p>
      {!url.startsWith("https://") && (
        <p role="alert" className="error">
          This is not a public HTTPS address. Do not print this code.
        </p>
      )}
      <Image
        src={image}
        alt={`QR code for ${url}`}
        width={1200}
        height={1200}
        unoptimized
        className="h-auto w-full rounded-2xl bg-white"
      />
      <p className="break-all text-center">{url}</p>
      <a href={image} download="dinner-awards-qr.png" className="btn">Download PNG</a>
      <p className="lead">Scan it with a real phone before printing.</p>
    </>
  );
}
