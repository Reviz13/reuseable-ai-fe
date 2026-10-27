import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { JwtClaimsSchema, type AppId, type JwtClaims } from "@ai/contracts";
import { AuthError } from "./errors.js";

export type EndUserVerifier = (token: string, app: AppId) => Promise<JwtClaims>;

export function createEndUserVerifier(
  appIssuers: Partial<Record<AppId, string>>,
  opts: { jwksFor?: (url: string) => JWTVerifyGetKey } = {},
): EndUserVerifier {
  const jwksFor = opts.jwksFor ?? ((url: string) => createRemoteJWKSet(new URL(url)));
  const cache = new Map<string, JWTVerifyGetKey>();
  const keys = (url: string) => {
    let k = cache.get(url);
    if (!k) cache.set(url, (k = jwksFor(url)));
    return k;
  };

  return async (token, app) => {
    const url = appIssuers[app];
    if (!url) throw new AuthError(`no issuer configured for app ${app}`);
    try {
      const { payload } = await jwtVerify(token, keys(url), {
        issuer: app,
        audience: "ai-platform",
        clockTolerance: 30,
        algorithms: ["RS256"],
      });
      return JwtClaimsSchema.parse(payload);
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : "invalid token");
    }
  };
}
