"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export function LoginForm({ supabaseUrl, anonKey }: { supabaseUrl: string; anonKey: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const supabase = createBrowserSupabase(supabaseUrl, anonKey);
      const { error } = await supabase.auth.signInWithPassword({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (error) {
        setError("Incorrect email or password.");
        return;
      }
      router.push("/admin/pos/knowledge");
      router.refresh();
    } catch {
      setError("Unable to sign in right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login card">
      <h1>Welcome back</h1>
      <p className="lead">Sign in to manage NEXUS knowledge and settings.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p>
          <button type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </p>
      </form>
    </main>
  );
}
