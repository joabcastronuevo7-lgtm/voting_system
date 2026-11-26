"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "Checking…" : "Check again"}
    </button>
  );
}
