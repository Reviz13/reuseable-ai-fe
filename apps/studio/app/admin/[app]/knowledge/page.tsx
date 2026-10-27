import Link from "next/link";
import { aiAdmin } from "@/lib/aiAdmin";
import { parseApp } from "@/lib/guard";
import { DocumentListSchema } from "@/lib/schemas";
import { AutoRefresh, FaqForm, UploadForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({ params }: { params: Promise<{ app: string }> }) {
  const app = parseApp((await params).app);
  const docs = await aiAdmin(`/admin/${app}/documents`, { schema: DocumentListSchema });
  const processing = docs.some((d) => d.status === "processing");

  return (
    <>
      <AutoRefresh active={processing} />
      <h1>Pengetahuan</h1>
      <div className="card table-wrap">
        {docs.length === 0 ? (
          <p className="muted">Belum ada dokumen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Judul</th>
                <th>Jenis</th>
                <th>Status</th>
                <th>Versi aktif</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/admin/${app}/knowledge/${d.id}`}>{d.title}</Link>
                  </td>
                  <td>{d.kind}</td>
                  <td>
                    <span className={`badge ${d.status}`}>{d.status}</span>
                  </td>
                  <td>{d.active_version ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Unggah dokumen</h2>
          <UploadForm app={app} />
        </section>
        <section className="card">
          <h2>Tambah FAQ</h2>
          <FaqForm app={app} />
        </section>
      </div>
    </>
  );
}
