// Uploads assets/knowledge/pos/*.md through the admin API. Run after `pnpm dev` is up: `pnpm seed:knowledge`.
// Signs in as the seeded admin with the anon key; the password only goes to Supabase Auth. A file whose
// title already exists becomes a new version of that document; unchanged files are skipped by the API.
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DIR = resolve(process.cwd(), "assets/knowledge/pos");
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60_000;

type Doc = { id: string; kind: string; title: string; status: string };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (fill the root .env)`);
  return v;
}

async function main() {
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email: need("SEED_ADMIN_EMAIL"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message ?? "no session"}`);
  const auth = { authorization: `Bearer ${data.session.access_token}` };
  const base = `${need("AI_SERVICE_URL").replace(/\/+$/, "")}/admin/pos`;

  const list = async (): Promise<Doc[]> => {
    const res = await fetch(`${base}/documents`, { headers: auth });
    if (!res.ok) throw new Error(`list documents: ${res.status}`);
    return (await res.json()) as Doc[];
  };
  const existing = new Map((await list()).filter((d) => d.kind === "file").map((d) => [d.title, d.id]));

  const files = (await readdir(DIR)).filter((f) => f.endsWith(".md")).sort();
  const pending = new Set<string>();
  let failed = 0;
  for (const name of files) {
    const form = new FormData();
    form.append("file", new Blob([await readFile(resolve(DIR, name))], { type: "text/markdown" }), name);
    const id = existing.get(name);
    const res = await fetch(`${base}/documents${id ? `?document_id=${id}` : ""}`, { method: "POST", headers: auth, body: form });
    const body = (await res.json().catch(() => ({}))) as { document_id?: string; deduped?: boolean };
    if (!res.ok || !body.document_id) {
      console.log(`${name}: failed (${res.status})`);
      failed++;
      continue;
    }
    console.log(`${name}: ${body.deduped ? "unchanged" : id ? "new version" : "uploaded"}`);
    if (!body.deduped) pending.add(body.document_id);
  }

  // Ingestion (parse, chunk, embed) runs in the background; wait until every upload is ready or failed.
  const deadline = Date.now() + TIMEOUT_MS;
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    for (const d of await list()) {
      if (!pending.has(d.id) || d.status === "processing") continue;
      pending.delete(d.id);
      if (d.status !== "ready") {
        console.log(`${d.title}: ingestion ${d.status}`);
        failed++;
      }
    }
  }
  if (pending.size > 0) {
    console.log(`${pending.size} document(s) still processing after ${TIMEOUT_MS / 60_000} minutes; check Studio > Knowledge.`);
    failed++;
  }
  console.log(failed ? `done with ${failed} problem(s)` : `done: ${files.length} documents ready`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("seed-knowledge failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
