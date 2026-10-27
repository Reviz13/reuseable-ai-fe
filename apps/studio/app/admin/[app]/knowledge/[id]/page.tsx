import Link from "next/link";
import { notFound } from "next/navigation";
import { aiAdmin } from "@/lib/aiAdmin";
import { AdminApiError } from "@/lib/errors";
import { parseApp } from "@/lib/guard";
import { DocumentDetailSchema } from "@/lib/schemas";
import { UploadForm } from "../forms";
import { ActivateButton, DeleteButton } from "./controls";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ app: string; id: string }> }) {
  const p = await params;
  const app = parseApp(p.app);
  const doc = await aiAdmin(`/admin/${app}/documents/${encodeURIComponent(p.id)}`, { schema: DocumentDetailSchema }).catch((e) => {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    throw e;
  });

  return (
    <>
      <p>
        <Link href={`/admin/${app}/knowledge`}>&larr; Kembali</Link>
      </p>
      <h1>{doc.title}</h1>
      <p className="muted">
        {doc.kind} · <span className={`badge ${doc.status}`}>{doc.status}</span> · versi aktif: {doc.active_version ?? "-"}
      </p>
      <section className="card table-wrap">
        <h2>Riwayat versi</h2>
        <table>
          <thead>
            <tr>
              <th>Versi</th>
              <th>Dibuat</th>
              <th>Chunk</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.versions.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.version}
                  {v.id === doc.active_version_id && " (aktif)"}
                </td>
                <td>{new Date(v.created_at).toLocaleString("id-ID")}</td>
                <td>{v.chunk_count}</td>
                <td className={v.error ? "error" : undefined}>{v.error ?? "-"}</td>
                <td>
                  {v.id !== doc.active_version_id && <ActivateButton app={app} documentId={doc.id} versionId={v.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {doc.kind === "file" && (
        <section className="card">
          <h2>Versi baru</h2>
          <UploadForm app={app} documentId={doc.id} />
        </section>
      )}
      <DeleteButton app={app} documentId={doc.id} />
    </>
  );
}
