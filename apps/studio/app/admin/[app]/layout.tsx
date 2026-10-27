import Link from "next/link";
import { aiAdmin } from "@/lib/aiAdmin";
import { ForbiddenError } from "@/lib/errors";
import { parseApp, requireAdminSession } from "@/lib/guard";
import { logout } from "./actions";
import { SignOutOnMount } from "./SignOutOnMount";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ app: string }>;
}) {
  const app = parseApp((await params).app);
  const { email } = await requireAdminSession(app);

  let allowed = true;
  try {
    await aiAdmin(`/admin/${app}/assistant`);
  } catch (err) {
    if (err instanceof ForbiddenError) allowed = false;
    else throw err;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">AI Studio · {app}</span>
        {allowed && (
          <nav>
            <Link href={`/admin/${app}/knowledge`}>Pengetahuan</Link>
            <Link href={`/admin/${app}/assistant`}>Asisten</Link>
            <Link href={`/admin/${app}/insights`}>Insight</Link>
          </nav>
        )}
        <span className="muted">{email}</span>
        <form action={logout}>
          <button type="submit" className="secondary">
            Keluar
          </button>
        </form>
      </header>
      {allowed ? (
        children
      ) : (
        <div className="card">
          <SignOutOnMount app={app} />
          <p className="error" role="alert">
            Akun ini tidak memiliki akses ke {app}
          </p>
          <Link href="/login">Kembali ke halaman masuk</Link>
        </div>
      )}
    </div>
  );
}
