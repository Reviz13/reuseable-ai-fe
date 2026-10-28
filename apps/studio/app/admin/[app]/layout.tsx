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
            <Link href={`/admin/${app}/knowledge`}>Knowledge</Link>
            <Link href={`/admin/${app}/assistant`}>Assistant</Link>
            <Link href={`/admin/${app}/insights`}>Insights</Link>
          </nav>
        )}
        <span className="muted">{email}</span>
        <form action={logout}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>
      {allowed ? (
        children
      ) : (
        <div className="card">
          <SignOutOnMount app={app} />
          <p className="error" role="alert">
            This account does not have access to {app}
          </p>
          <Link href="/login">Back to sign in</Link>
        </div>
      )}
    </div>
  );
}
