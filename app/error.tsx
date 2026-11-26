"use client";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <section className="card text-center" role="alert">
      <h1 className="subtitle">Something went wrong</h1>
      <p className="lead">Check your connection, then try again.</p>
      <button type="button" className="btn" onClick={() => retry()}>Try again</button>
    </section>
  );
}
