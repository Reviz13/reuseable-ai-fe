import type { AppId } from "@ai/contracts";
import type { Db } from "../db.js";
import { AuthError } from "./errors.js";

export type AdminIdentity = { user_id: string; apps: AppId[] };
export type AdminVerifier = (token: string) => Promise<AdminIdentity>;

export function createAdminVerifier(deps: {
  getUser: (token: string) => Promise<{ id: string } | null>;
  db: Db;
}): AdminVerifier {
  return async (token) => {
    let user: { id: string } | null;
    try {
      user = await deps.getUser(token);
    } catch {
      throw new AuthError("invalid token");
    }
    if (!user) throw new AuthError("invalid token");
    const rows = await deps.db.query<{ apps: AppId[] }>("select apps from admins where user_id = $1", [user.id]);
    if (rows.length === 0) throw new AuthError("not an admin");
    return { user_id: user.id, apps: rows[0]!.apps };
  };
}
