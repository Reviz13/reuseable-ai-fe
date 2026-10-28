import { AppIdSchema } from "@ai/contracts";
import { supabaseEnv } from "@/lib/env";
import { LoginForm } from "./LoginForm";

// Rendered per request so the Supabase url/key are read at runtime, not baked in at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { url, anonKey } = supabaseEnv();
  const denied = AppIdSchema.safeParse((await searchParams).denied);
  return (
    <>
      {denied.success && (
        <p className="error login" role="alert">
          This account does not have access to {denied.data}
        </p>
      )}
      <LoginForm supabaseUrl={url} anonKey={anonKey} />
    </>
  );
}
