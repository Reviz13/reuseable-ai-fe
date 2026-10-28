"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <h2>Something went wrong</h2>
      <p className="error">{error.message || "The request to the AI service failed."}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
