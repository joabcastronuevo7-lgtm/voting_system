"use client";

import { useEffect, useState } from "react";
import type { Award } from "@/lib/winners";

const NEXT = ["ArrowRight", "ArrowDown", "PageDown", " "];
const BACK = ["ArrowLeft", "ArrowUp", "PageUp"];

/**
 * Step null is the holding screen, 0 to n-1 one award each, and n all of them. The
 * winners arrive once with the page, so reveals keep working without a network.
 */
export function Show({ awards }: { awards: Award[] }) {
  const [step, setStep] = useState<number | null>(null);
  const last = awards.length;
  const started = step !== null;

  const next = () => setStep((s) => (s === null ? s : Math.min(s + 1, last)));
  const back = () => setStep((s) => (s === null || s === 0 ? null : s - 1));

  // Keyboard and presentation clickers. Nothing moves before "Start presentation".
  useEffect(() => {
    if (!started) return;
    const onKey = (event: KeyboardEvent) => {
      // a focused button already answers Space itself
      if (event.key === " " && event.target instanceof HTMLButtonElement) return;
      const forward = NEXT.includes(event.key);
      if (!forward && !BACK.includes(event.key)) return;
      event.preventDefault();
      if (event.repeat) return;
      setStep((s) => {
        if (s === null) return s;
        if (forward) return Math.min(s + 1, last);
        return s === 0 ? null : s - 1;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, last]);

  const fullScreen = () =>
    void (document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
    )?.catch(() => {}); // refused by the browser: the screen still fills the window

  const shown = step === null ? [] : step === last ? awards : [awards[step]];

  return (
    <>
      <div className="stage-body" aria-live="polite">
        {step === null ? (
          <div key="start" className="reveal flex flex-col items-center gap-[3vmin]">
            <p className="stage-eyebrow">Dinner Awards 2026</p>
            <p className="stage-eyebrow text-ivory">Voting closed</p>
            <h1 className="stage-title">The Winners</h1>
            <p className="stage-lead">Celebrating this year&apos;s outstanding people</p>
            <button type="button" className="btn max-w-sm" onClick={() => setStep(0)}>
              Start presentation
            </button>
            <p className="max-w-2xl text-sm text-muted">
              Results are loaded once. After you start, do not reopen voting or change guests.
              If anything was changed, reload this page and check the results again.
            </p>
          </div>
        ) : (
          <div key={step} className="reveal flex w-full flex-col items-center gap-[3vmin]">
            <p className="stage-eyebrow">
              {step === last ? "Dinner Awards 2026 · The winners" : "Dinner Awards 2026"}
            </p>
            <div className={step === last ? "stage-all" : "stage-one"}>
              {shown.map((award) => (
                <section key={award.id} className="stage-award">
                  <h2 className="stage-category">{award.name}</h2>
                  {step !== last && <p className="stage-lead">{award.description}</p>}
                  {award.winners.length === 0 ? (
                    <p className="stage-lead">No votes recorded</p>
                  ) : (
                    <>
                      <ul className="stage-names" data-count={Math.min(award.winners.length, 7)}>
                        {award.winners.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                      <p className="stage-eyebrow">
                        {award.winners.length > 1 ? "Winners · Tie" : "Winner"}
                      </p>
                      <p className="stage-votes">
                        {award.votes} {award.votes === 1 ? "vote" : "votes"}
                        {award.winners.length > 1 && " each"}
                      </p>
                    </>
                  )}
                </section>
              ))}
            </div>
            {step === last && <p className="stage-eyebrow text-ivory">A night to celebrate</p>}
          </div>
        )}
      </div>

      <div className="stage-controls">
        {started && (
          <>
            <button type="button" className="link" onClick={back}>Back</button>
            <button type="button" className="link" disabled={step === last} onClick={next}>
              Next
            </button>
            <button type="button" className="link" onClick={() => setStep(last)}>
              Show all
            </button>
          </>
        )}
        <button type="button" className="link" onClick={fullScreen}>Full screen</button>
      </div>
    </>
  );
}
