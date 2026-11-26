"use client";

import { useActionState, useState } from "react";
import type { AdminGuest } from "@/lib/contracts";
import { addGuest, issueClaim, removeGuest, restoreGuest, type AdminState } from "../actions";

const FILTERS = {
  all: { label: "Everyone", match: () => true },
  voted: { label: "Voted", match: (g: AdminGuest) => !g.removed_at && g.has_voted },
  waiting: { label: "Not voted", match: (g: AdminGuest) => !g.removed_at && !g.has_voted },
  removed: { label: "Removed", match: (g: AdminGuest) => g.removed_at !== null },
};

export function GuestList({ guests }: { guests: AdminGuest[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all");
  const term = search.trim().toLocaleLowerCase();
  const shown = guests.filter(
    (g) => FILTERS[filter].match(g) && g.full_name.toLocaleLowerCase().includes(term),
  );

  return (
    <>
      <AddGuest />

      <label htmlFor="search" className="sr-only">Search guests</label>
      <input
        id="search"
        type="search"
        className="field"
        placeholder="Search by name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />
      <label htmlFor="filter" className="sr-only">Show</label>
      <select
        id="filter"
        className="field"
        value={filter}
        onChange={(e) => setFilter(e.target.value as keyof typeof FILTERS)}
      >
        {Object.entries(FILTERS).map(([key, { label, match }]) => (
          <option key={key} value={key}>{`${label} (${guests.filter(match).length})`}</option>
        ))}
      </select>

      {shown.length === 0 ? (
        <p className="lead" role="status">No guests to show.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((g) => <Guest key={g.id} guest={g} />)}
        </ul>
      )}
    </>
  );
}

function AddGuest() {
  const [state, action, pending] = useActionState(addGuest, {});

  return (
    <form action={action} className="card">
      <label htmlFor="name" className="label">Add a guest</label>
      <input
        id="name"
        name="name"
        className="field"
        placeholder="Full name"
        autoComplete="off"
        autoCapitalize="words"
        required
        minLength={2}
        maxLength={80}
      />
      <Problem state={state} />
      <button type="submit" className="btn" disabled={pending}>Add guest</button>
    </form>
  );
}

function Guest({ guest }: { guest: AdminGuest }) {
  const removed = guest.removed_at !== null;
  // Before JavaScript loads, a post returns a new page: the address jumps back to this row,
  // and the row opens to show the new link or the error.
  const row = `guest-${guest.id}`;
  const page = `/admin/guests#${row}`;
  const [claim, claimAction, claiming] = useActionState(issueClaim, {}, page);
  const [removal, removeAction, removing] = useActionState(removeGuest, {}, page);

  return (
    <li id={row} className="card">
      <p className="break-words text-lg">{guest.full_name}</p>
      <p className={guest.has_voted && !removed ? "text-sm text-gold" : "text-sm text-muted"}>
        {removed ? `Removed: ${guest.removal_reason}` : guest.has_voted ? "Voted" : "Not voted"}
      </p>
      {removed ? (
        <Restore id={guest.id} />
      ) : (
        <details open={Boolean(claim.link || claim.error || removal.error) || undefined}>
          <summary className="link">
            Manage<span className="sr-only"> {guest.full_name}</span>
          </summary>
          <div className="mt-3 flex flex-col gap-5">
            <Claim id={guest.id} state={claim} action={claimAction} pending={claiming} />
            <Remove id={guest.id} state={removal} action={removeAction} pending={removing} />
          </div>
        </details>
      )}
    </li>
  );
}

function Problem({ state }: { state: AdminState }) {
  return state.error ? <p role="alert" className="error">{state.error}</p> : null;
}

function Restore({ id }: { id: string }) {
  const [state, action, pending] = useActionState(restoreGuest, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Problem state={state} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>Restore guest</button>
    </form>
  );
}

type ActionProps = {
  id: string;
  state: AdminState;
  action: (form: FormData) => void;
  pending: boolean;
};

function Claim({ id, state, action, pending }: ActionProps) {
  const [copied, setCopied] = useState("");

  const copy = () =>
    navigator.clipboard.writeText(state.link!).then(
      () => setCopied(state.link!),
      () => setCopied(""), // the link stays selectable above
    );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-muted">
        For a guest who changed phones or browsers. Send the link only to that guest.
      </p>
      {state.link && (
        <>
          <input
            readOnly
            aria-label="Claim link"
            className="field"
            value={state.link}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="btn" onClick={copy}>
            {copied === state.link ? "Copied" : "Copy link"}
          </button>
          <p className="text-sm text-muted" role="status">
            Shown only now. It works once, for 24 hours. If Copy link does nothing, press and
            hold the link to copy it.
          </p>
        </>
      )}
      <Problem state={state} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {state.link ? "Create a new link" : "Create claim link"}
      </button>
    </form>
  );
}

function Remove({ id, state, action, pending }: ActionProps) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`reason-${id}`} className="label">Reason for removal</label>
      <input id={`reason-${id}`} name="reason" className="field" maxLength={500} required />
      <p className="text-sm text-muted">
        Removal leaves their votes, and votes for them, out of the results.
      </p>
      <Problem state={state} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>Remove guest</button>
    </form>
  );
}
