"use client";

import { useActionState, type ReactNode } from "react";
import type { VotingStatus } from "@/lib/contracts";
import { updateSettings } from "./actions";

const STATUS: Record<VotingStatus, string> = {
  not_started: "Not started",
  open: "Open",
  paused: "Paused",
  closed: "Closed",
};

export function Controls({
  registrationOpen,
  voting,
}: {
  registrationOpen: boolean;
  voting: VotingStatus;
}) {
  const [state, action, pending] = useActionState(updateSettings, {});

  /** One button that sends one setting. */
  const change = (name: string, value: string, label: string, children?: ReactNode) => (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name={name} value={value} />
      {children}
      <button type="submit" className="btn" disabled={pending}>{label}</button>
    </form>
  );
  const confirm = (name: string, label: string) => (
    <label className="option">
      <input type="checkbox" name={name} required />
      <span>{label}</span>
    </label>
  );

  return (
    <>
      {state.error && <p role="alert" className="error">{state.error}</p>}

      <section className="card">
        <h2 className="subtitle">Registration: {registrationOpen ? "Open" : "Closed"}</h2>
        {registrationOpen
          ? change("registration", "closed", "Close registration")
          : change("registration", "open", "Open registration")}
      </section>

      <section className="card">
        <h2 className="subtitle">Voting: {STATUS[voting]}</h2>
        {voting === "not_started" && change("voting", "open", "Open voting")}
        {voting === "open" && change("voting", "paused", "Pause voting")}
        {voting === "paused" && change("voting", "open", "Resume voting")}
        {(voting === "open" || voting === "paused") &&
          change(
            "voting",
            "closed",
            "Close voting",
            confirm("confirm_close", "I want to end voting for everyone."),
          )}
        {voting === "closed" &&
          change(
            "voting",
            "open",
            "Reopen voting",
            <>
              {confirm("confirm_reopen", "I want to reopen voting. Published results hide again.")}
              <label htmlFor="reason" className="label">Reason</label>
              <input id="reason" name="reason" className="field" maxLength={500} required />
            </>,
          )}
      </section>
    </>
  );
}
