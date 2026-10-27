"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <h2>Terjadi kesalahan</h2>
      <p className="error">{error.message || "Permintaan ke layanan AI gagal."}</p>
      <button onClick={reset}>Coba lagi</button>
    </div>
  );
}
