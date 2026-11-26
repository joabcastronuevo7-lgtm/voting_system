import { redirect } from "next/navigation";
import { getGuest } from "@/lib/guest";
import { RegisterForm } from "./register-form";

export default async function Home() {
  // Returning guests skip registration.
  if (await getGuest()) redirect("/me");

  return (
    <>
      <h1 className="title">Who&apos;s Your Pick?</h1>
      <p className="lead">First, tell us who you are.</p>
      <RegisterForm />
    </>
  );
}
