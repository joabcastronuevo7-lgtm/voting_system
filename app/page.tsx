import { redirect } from "next/navigation";
import { getGuest } from "@/lib/guest";
import { RegisterForm } from "./register-form";

export default async function Home() {
  // Returning guests skip registration.
  if (await getGuest()) redirect("/me");

  return (
    <>
      <div className="medal" aria-hidden>★</div>
      <h1 className="title rise">Who&apos;s Your Pick?</h1>
      <p className="lead rise">First, tell us who you are.</p>
      <RegisterForm />
    </>
  );
}
