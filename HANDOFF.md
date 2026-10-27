# Handoff: Reusable AI Micro Frontend (pilot POS)

Ringkasan keputusan dari sesi brainstorming di claude.ai. Taruh file ini di root repo
(bersama `kopi-tepi-pos.html` sebagai referensi UI), lalu lanjutkan dengan skill
`superpowers:brainstorming` mulai dari **Bagian 2 desain**.

## Status proses (superpowers)

- Jalur: **Architectural** (proyek baru, beberapa subsistem).
- Selesai: pertanyaan klarifikasi, pemilihan pendekatan (A), Bagian 1 desain (arsitektur).
- Belum: Bagian 2–5 desain, spec tertulis, rencana implementasi.
- `kopi-tepi-pos.html` adalah **prototype throwaway** untuk validasi UI/konsep, bukan kode produksi.

## Keputusan yang sudah disepakati

| Topik | Keputusan |
|---|---|
| Pengguna | Internal. Perusahaan memiliki aplikasi POS, Core Banking, ERP/HRIS. |
| Isolasi | "Tenant" = aplikasi (pos, banking, erp). Knowledge dan tool terisolasi per aplikasi. |
| Pilot | **POS**. Core Banking menyusul setelah keputusan compliance. |
| Kemampuan pilot | (1) Q&A dari manual/SOP/FAQ POS dengan sitasi. (2) Profit periode tertentu via satu tool read-only. |
| Siapa boleh lihat profit | **Owner saja**, satu outlet. |
| Data profit | POS menyimpan harga pokok (HPP). Profit dihitung **oleh POS backend**, bukan oleh AI. |
| Pendekatan | **A: build sendiri.** Node/TS service, Postgres + pgvector, LLM gateway, tool registry. |
| Hosting LLM | **Belum diputuskan** (menunggu security/compliance). Semua panggilan model lewat LLM gateway supaya provider bisa diganti lewat config. |
| Widget | Web Component + Shadow DOM, posisi di 4 sudut (drag & snap), host mengatur inset via CSS var. |

## Bagian 1: Arsitektur (disetujui untuk lanjut)

```
POS app + <ai-assistant>  --token-->  AI Platform (Node/TS)
                                        ├─ Auth + chat orchestrator (verifikasi token, streaming)
                                        ├─ Tool: get_profit  ──> POS backend /internal/reports/profit
                                        ├─ SOP retriever     ──> Postgres + pgvector (app=pos, versi aktif)
                                        └─ LLM gateway       ──> provider (cloud / self-hosted)
```

## Kontrak tool `get_profit`

- Parameter yang bisa diisi model: `period` (`today|yesterday|this_week|last_week|this_month|last_month|custom`), `start_date`, `end_date`.
- **Tidak ada** parameter `outlet_id`, `user_id`, atau `role`. Semuanya diambil dari token yang sudah diverifikasi.
- Pengecekan role (`owner`) dilakukan di kode tool. Jika gagal, kembalikan `FORBIDDEN`.
- Tanggal di-resolve di kode, sesuai zona waktu outlet (WIB/WITA/WIT). Minggu dimulai Senin. Custom maksimal 92 hari dan tidak boleh di masa depan.
- Panggil POS backend dengan timeout sekitar 5 detik. **Setiap panggilan dicatat di audit log**, termasuk yang ditolak atau gagal.
- Guardrail: setiap angka rupiah dalam jawaban harus sama dengan nilai dari hasil tool. Jika tidak, ganti jawaban dengan template.

Endpoint yang dibutuhkan dari tim POS:
```
GET /internal/reports/profit?outlet_id=&from=&to=
→ { sales, cogs, profit, currency, transactions, missing_cost_items, from, to, as_of }
```

Pertanyaan terbuka untuk tim POS:
- Apakah refund/void sudah dikurangkan?
- Apakah diskon diterapkan sebelum angka penjualan?
- Apakah PPN termasuk atau tidak?
- Bagaimana menangani item tanpa HPP?

Definisi profit **harus sama** dengan laporan owner yang sudah ada di POS.

## Pertanyaan untuk compliance (paralel)

1. Bolehkah dokumen internal (SOP, manual) dikirim ke LLM API eksternal? Apakah harus in-country?
2. Bolehkah data pelanggan/transaksi dikirim? Jika ya, dengan syarat apa (masking, DPA)?
3. Apakah audit log wajib? Berapa lama retensinya?
4. Apakah perlu syarat vendor seperti zero data retention atau no training?
5. Apa klasifikasi data SOP banking?

## Langkah berikutnya

1. Bagian 2 desain: alur data dan error handling (kasir tanya profit, SOP tidak ditemukan, POS down, token kedaluwarsa, prompt injection dari dokumen).
2. Bagian 3: model data Postgres (documents, chunks + versi, conversations, feedback, audit_log).
3. Bagian 4: kontrak widget/SDK dan integrasi identitas dengan POS (token handshake).
4. Bagian 5: strategi testing, termasuk eval set pertanyaan POS.
5. Tulis spec ke `docs/superpowers/specs/`, review, lalu `writing-plans`.
