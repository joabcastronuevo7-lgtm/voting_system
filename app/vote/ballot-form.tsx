"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Ballot } from "@/lib/contracts";
import { initials } from "@/lib/initials";
import { submitBallot } from "../actions";

export function BallotForm({ categories, nominees }: Ballot) {
  const router = useRouter();
  const [step, setStep] = useState(0); // categories.length is the review screen
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  // Move to the top of each new step, for sighted and screen reader users alike.
  useEffect(() => {
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, [step]);

  // A name tapped before JavaScript loaded is ticked on screen but not yet recorded, and
  // tapping it again would not fire a change.
  const adoptEarlyPick = useCallback((list: HTMLFieldSetElement | null) => {
    const early = list?.querySelector<HTMLInputElement>("input:checked");
    if (early) setPicks((current) => ({ ...current, [early.name]: early.value }));
  }, []);

  // A refreshed list may no longer contain an earlier choice.
  const chosen = (categoryId: string) => nominees.find((n) => n.id === picks[categoryId]);
  const go = (next: number) => {
    setSearch("");
    setStep(next);
  };

  if (nominees.length === 0) {
    return (
      <section className="card text-center">
        <h1 className="subtitle">No nominees yet</h1>
        <p className="lead">No other guests have registered. Please check back soon.</p>
        <Link href="/me" className="btn">Back</Link>
      </section>
    );
  }

  const category = categories[step];

  if (!category) {
    const complete = categories.every((c) => chosen(c.id));

    const submit = () =>
      start(async () => {
        setError("");
        try {
          const result = await submitBallot(picks);
          setError(result.error);
          if (result.reload) router.refresh();
        } catch (e) {
          unstable_rethrow(e); // redirects after a saved ballot
          setError("Could not reach the server. Check your connection and try again.");
        }
      });

    return (
      <>
        <h1 ref={heading} tabIndex={-1} className="title">Review your votes</h1>
        <ul className="space-y-3">
          {categories.map((c, i) => (
            <li key={c.id} className="card flex-row items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm text-gold">{c.name}</p>
                <p className="break-words text-lg">{chosen(c.id)?.full_name ?? "Not selected"}</p>
              </div>
              <button type="button" className="link" disabled={pending} onClick={() => go(i)}>
                Change<span className="sr-only"> {c.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="lead">You cannot change your votes after submitting.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="button" className="btn" disabled={!complete || pending} onClick={submit}>
          {pending ? "Submitting…" : "Submit my votes"}
        </button>
        <Link href="/me" className="link self-center">Back to my page</Link>
      </>
    );
  }

  const term = search.trim().toLocaleLowerCase();
  const matches = nominees.filter((n) => n.full_name.toLocaleLowerCase().includes(term));
  const selected = chosen(category.id);

  return (
    <>
      <div className="steps" aria-hidden>
        {categories.map((c, i) => <i key={c.id} data-done={i <= step || undefined} />)}
      </div>
      <p className="text-center text-sm text-muted">
        Award {step + 1} of {categories.length}
      </p>
      <h1 ref={heading} tabIndex={-1} className="title">{category.name}</h1>
      <p className="lead">{category.description}</p>

      <label htmlFor="search" className="sr-only">Search guests</label>
      <input
        id="search"
        type="search"
        className="field sticky top-2 z-10 shadow-[0_0_0_0.5rem_var(--color-ink)]"
        placeholder="Search by name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />

      <fieldset ref={adoptEarlyPick} className="space-y-2 pb-40">
        <legend className="sr-only">Choose one guest for {category.name}</legend>
        {matches.map((n) => (
          <label key={n.id} className="option">
            {/* scroll margin keeps a keyboard-focused name clear of the pinned search box */}
            <input
              className="scroll-mt-24"
              type="radio"
              name={category.id}
              value={n.id}
              checked={picks[category.id] === n.id}
              onChange={() => setPicks({ ...picks, [category.id]: n.id })}
            />
            <span className="avatar" data-initials={initials(n.full_name)} aria-hidden />
            <span className="min-w-0 break-words">{n.full_name}</span>
          </label>
        ))}
        {matches.length === 0 && (
          <p className="lead" role="status">No guest matches that name.</p>
        )}
      </fieldset>

      <div className="actions">
        <p className="mb-2 truncate text-center text-sm" aria-live="polite">
          {selected ? <>Selected: <strong>{selected.full_name}</strong></> : "No one selected yet"}
        </p>
        <div className="flex gap-3">
          {step === 0 ? (
            <Link href="/me" className="btn btn-secondary">Cancel</Link>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => go(step - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn" disabled={!selected} onClick={() => go(step + 1)}>
            {step === categories.length - 1 ? "Review" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
