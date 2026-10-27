"use client";

import { useEffect } from "react";
import { signOutOnly } from "./actions";

/** Cookies cannot be changed while a Server Component renders, so sign out via a Server Action on mount. */
export function SignOutOnMount({ app }: { app: string }) {
  useEffect(() => {
    const go = () => window.location.assign(`/login?denied=${encodeURIComponent(app)}`);
    signOutOnly().then(go, go);
  }, [app]);
  return null;
}
