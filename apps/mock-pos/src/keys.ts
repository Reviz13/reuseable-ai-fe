import { generateKeyPair, exportJWK, exportPKCS8, importPKCS8, type JWK, type KeyLike } from "jose";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Keys {
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
}

interface Stored { kid: string; privatePkcs8: string; publicJwk: JWK }

export async function loadOrCreateKeys(path = ".keys/mock-pos.json"): Promise<Keys> {
  if (existsSync(path)) {
    const s = JSON.parse(readFileSync(path, "utf8")) as Stored;
    return { kid: s.kid, publicJwk: s.publicJwk, privateKey: await importPKCS8(s.privatePkcs8, "RS256") };
  }
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const kid = "mock-pos-1";
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const stored: Stored = { kid, publicJwk, privatePkcs8: await exportPKCS8(privateKey) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(stored), { mode: 0o600 });
  return { kid, publicJwk, privateKey };
}
