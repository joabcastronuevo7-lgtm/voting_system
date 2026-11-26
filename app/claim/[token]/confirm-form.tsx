"use client";

import { useActionState } from "react";
import { claim } from "./actions";

export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(claim, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <p role="alert" className="error">{state.error}</p>}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Please wait…" : "Confirm"}
      </button>
    </form>
  );
}
