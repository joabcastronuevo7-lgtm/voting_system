"use client";

import { useActionState } from "react";
import { register } from "./actions";

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, { name: "" });

  return (
    <form action={action} className="card rise">
      <label htmlFor="name" className="label">Full name</label>
      <input
        id="name"
        name="name"
        className="field"
        defaultValue={state.name}
        autoComplete="name"
        autoCapitalize="words"
        required
        minLength={2}
        maxLength={80}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "name-error" : undefined}
      />
      {state.error && (
        <p id="name-error" role="alert" className="error">{state.error}</p>
      )}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Please wait…" : "Continue to Voting"}
      </button>
    </form>
  );
}
