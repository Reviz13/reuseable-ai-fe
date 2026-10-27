import Link from "next/link";
import { aiAdmin } from "@/lib/aiAdmin";
import { parseApp } from "@/lib/guard";
import { AuditSchema, FeedbackSchema, GapSchema } from "@/lib/schemas";
import { resolveGap } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const fmt = (s: string) => new Date(s).toLocaleString("id-ID");

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ app: string }>;
  searchParams: Promise<SP>;
}) {
  const app = parseApp((await params).app);
  const sp = await searchParams;
  const tab = ["gaps", "feedback", "audit"].includes(one(sp.tab)) ? one(sp.tab) : "gaps";
  const base = `/admin/${app}/insights`;

  return (
    <>
      <h1>Insight</h1>
      <nav className="tabs">
        {[
          ["gaps", "Celah pengetahuan"],
          ["feedback", "Umpan balik"],
          ["audit", "Audit"],
        ].map(([key, label]) => (
          <Link key={key} href={`${base}?tab=${key}`} className={tab === key ? "active" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "gaps" && <Gaps app={app} resolved={one(sp.resolved) === "true"} base={base} />}
      {tab === "feedback" && <Feedback app={app} />}
      {tab === "audit" && <Audit app={app} sp={sp} base={base} />}
    </>
  );
}

async function Gaps({ app, resolved, base }: { app: "pos" | "banking" | "erp"; resolved: boolean; base: string }) {
  const gaps = await aiAdmin(`/admin/${app}/gaps?resolved=${resolved}`, { schema: GapSchema });
  return (
    <section className="card table-wrap">
      <p>
        <Link href={`${base}?tab=gaps`}>Belum selesai</Link> · <Link href={`${base}?tab=gaps&resolved=true`}>Selesai</Link>
      </p>
      {gaps.length === 0 ? (
        <p className="muted">Tidak ada data.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pertanyaan</th>
              <th>Skor tertinggi</th>
              <th>Waktu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.id}>
                <td>{g.question}</td>
                <td>{g.top_score ?? "-"}</td>
                <td>{fmt(g.created_at)}</td>
                <td>
                  {!g.resolved_at && (
                    <form action={resolveGap.bind(null, app)}>
                      <input type="hidden" name="id" value={g.id} />
                      <button type="submit" className="secondary">
                        Tandai selesai
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function Feedback({ app }: { app: "pos" | "banking" | "erp" }) {
  const items = await aiAdmin(`/admin/${app}/feedback?rating=-1`, { schema: FeedbackSchema });
  return (
    <section>
      {items.length === 0 && <p className="card muted">Belum ada umpan balik negatif.</p>}
      {items.map((f) => (
        <article className="card" key={f.message_id}>
          <p>
            <strong>Pertanyaan:</strong> {f.question ?? "-"}
          </p>
          <p>
            <strong>Jawaban:</strong> {f.answer}
          </p>
          <p>
            <strong>Komentar:</strong> {f.comment ?? "-"}
          </p>
          <p className="muted">{fmt(f.created_at)}</p>
        </article>
      ))}
    </section>
  );
}

async function Audit({ app, sp, base }: { app: "pos" | "banking" | "erp"; sp: SP; base: string }) {
  const qs = new URLSearchParams();
  for (const k of ["action", "outcome", "from", "to"]) if (one(sp[k])) qs.set(k, one(sp[k]));
  const rows = await aiAdmin(`/admin/${app}/audit${qs.size ? `?${qs}` : ""}`, { schema: AuditSchema });
  return (
    <>
      <form method="get" action={base} className="card row">
        <input type="hidden" name="tab" value="audit" />
        <div>
          <label htmlFor="action">Aksi</label>
          <input id="action" name="action" type="text" defaultValue={one(sp.action)} placeholder="doc.upload" />
        </div>
        <div>
          <label htmlFor="outcome">Hasil</label>
          <select id="outcome" name="outcome" defaultValue={one(sp.outcome)}>
            <option value="">Semua</option>
            <option value="ok">ok</option>
            <option value="forbidden">forbidden</option>
            <option value="error">error</option>
          </select>
        </div>
        <div>
          <label htmlFor="from">Dari</label>
          <input id="from" name="from" type="date" defaultValue={one(sp.from)} />
        </div>
        <div>
          <label htmlFor="to">Sampai</label>
          <input id="to" name="to" type="date" defaultValue={one(sp.to)} />
        </div>
        <button type="submit">Filter</button>
      </form>
      <section className="card table-wrap">
        {rows.length === 0 ? (
          <p className="muted">Tidak ada data.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Pelaku</th>
                <th>Aksi</th>
                <th>Hasil</th>
                <th>Parameter</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <td>{fmt(r.at)}</td>
                  <td>{r.actor_type}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.outcome}
                    {r.error_code ? ` (${r.error_code})` : ""}
                  </td>
                  <td>
                    <pre className="params">{JSON.stringify(r.params)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
