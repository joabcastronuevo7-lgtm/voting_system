import Link from "next/link";
import { redirect } from "next/navigation";
import { getGuest } from "@/lib/guest";

export default async function ThanksPage() {
  const guest = await getGuest();
  if (!guest) redirect("/");
  if (!guest.has_voted) redirect("/me");

  return (
    <section className="card rise text-center">
      <div className="medal" aria-hidden>✓</div>
      <h1 className="title">Your votes have been submitted!</h1>
      <p className="lead">Your ballot was recorded. Enjoy the evening.</p>
      <Link href="/me" className="btn">Back to my page</Link>
    </section>
  );
}
