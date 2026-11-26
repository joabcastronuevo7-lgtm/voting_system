"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, { email: "" });

  return (
    <form action={action} className="card">
      <label htmlFor="email" className="label">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        className="field"
        defaultValue={state.email}
        autoComplete="username"
        required
      />
      <label htmlFor="password" className="label">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        className="field"
        autoComplete="current-password"
        required
      />
      {state.error && <p role="alert" className="error">{state.error}</p>}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
