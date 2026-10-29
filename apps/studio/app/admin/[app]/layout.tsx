import Link from "next/link";
import { NavLink, Sidebar, SidebarBrand } from "@/components/Sidebar";
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
  const user = email ?? "Admin";

  let allowed = true;
  try {
    await aiAdmin(`/admin/${app}/assistant`);
  } catch (err) {
    if (err instanceof ForbiddenError) allowed = false;
    else throw err;
  }

  // Same rule as /api/demo-token: the demo works outside production, or when DEMO_ENABLED=1.
  const demo = process.env.NODE_ENV !== "production" || process.env.DEMO_ENABLED === "1";

  return (
    <div className="app">
      <Sidebar brand={<SidebarBrand logo="✦" name="AI Studio" sub={`App · ${app}`} href={`/admin/${app}/knowledge`} />}>
        {allowed && (
          <>
            <div className="sidebar-section">Manage</div>
            <nav className="sidebar-nav" aria-label="Admin">
              <NavLink href={`/admin/${app}/knowledge`} icon="📚">
                Knowledge
              </NavLink>
              <NavLink href={`/admin/${app}/assistant`} icon="🤖">
                Assistant
              </NavLink>
              <NavLink href={`/admin/${app}/insights`} icon="💡">
                Insights
              </NavLink>
            </nav>
            {demo && (
              <>
                <div className="sidebar-section">Preview</div>
                <nav className="sidebar-nav" aria-label="Demo">
                  <a className="nav-item" href="/demo/pos">
                    <span className="nav-icon" aria-hidden>
                      ☕
                    </span>
                    POS demo
                  </a>
                </nav>
              </>
            )}
          </>
        )}
        <div className="sidebar-foot">
          <div className="side-card">
            <div className="side-user">
              <span className="side-avatar" aria-hidden>
                {user.slice(0, 1)}
              </span>
              <span className="side-email" title={user}>
                {user}
              </span>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="side-btn">
              Sign out
            </button>
          </form>
        </div>
      </Sidebar>
      <main className="main">
        <div className="content ui">
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
      </main>
    </div>
  );
}
