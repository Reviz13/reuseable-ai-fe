"use client";

import { useEffect, useRef, useState } from "react";
import s from "./dashboard.module.css";

type Range = "today" | "7d" | "30d";
type Totals = { sales: number; cogs: number; profit: number; transactions: number; missing_cost_items: number };
type Day = Totals & { date: string };
type Data = {
  range: Range;
  from: string;
  to: string;
  days: Day[];
  products: { name: string; qty: number; sales: number }[];
  payments: { method: "cash" | "qris" | "card"; transactions: number; sales: number }[];
  totals: Totals;
  previous: Totals;
};

const RANGES: { id: Range; label: string; prev: string; ask: string }[] = [
  { id: "today", label: "Hari ini", prev: "kemarin", ask: "Profit hari ini?" },
  { id: "7d", label: "7 hari", prev: "7 hari sebelumnya", ask: "Profit minggu ini?" },
  { id: "30d", label: "30 hari", prev: "30 hari sebelumnya", ask: "Profit bulan ini?" },
];
const METHOD_LABEL = { cash: "Tunai", qris: "QRIS", card: "Kartu" } as const;

const rupiah = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");
function compact(n: number): string {
  if (n >= 1e9) return `Rp${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e6) return `Rp${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
  if (n >= 1e3) return `Rp${Math.round(n / 1e3)} rb`;
  return rupiah(n);
}
const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Smallest 1/2/2.5/5 x 10^k at or above `v`. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** `lowerIsBetter`: for costs, a fall is shown as good news. */
function Delta({ now, before, label, lowerIsBetter }: { now: number; before: number; label: string; lowerIsBetter?: boolean }) {
  if (!before) return <span className={s.deltaFlat}>— vs {label}</span>;
  const pct = ((now - before) / Math.abs(before)) * 100;
  const up = pct >= 0;
  return (
    <span className={up !== Boolean(lowerIsBetter) ? s.deltaUp : s.deltaDown}>
      {up ? "▲" : "▼"} {Math.abs(pct).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%{" "}
      <span className={s.deltaLabel}>vs {label}</span>
    </span>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Daily sales (bars) and profit (line) on one Rupiah axis, with a per-day hover tooltip. */
function SalesChart({ days }: { days: Day[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240, top = 12, bottom = 28, left = 64, right = 12;
  const plotW = Math.max(0, width - left - right), plotH = H - top - bottom;
  const max = niceCeil(Math.max(...days.map((d) => d.sales)));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const band = days.length ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(36, band - 2 - band * 0.3));
  const cx = (i: number) => left + band * i + band / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 56)));
  const bar = (i: number, v: number) => {
    const x = cx(i) - barW / 2, yt = y(v), yb = y(0), r = Math.min(4, barW / 2, yb - yt);
    return `M${x},${yb}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + barW - r}Q${x + barW},${yt} ${x + barW},${yt + r}V${yb}Z`;
  };
  const h = hover !== null ? days[hover] : null;

  return (
    <div ref={ref} className={s.chartWrap} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Grafik penjualan dan profit harian">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} className={t === 0 ? s.axis : s.gridLine} />
              <text x={left - 8} y={y(t)} className={s.tick} textAnchor="end" dominantBaseline="middle">
                {compact(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.date} x={cx(i)} y={H - 8} className={s.tick} textAnchor="middle">
                {shortDate(d.date)}
              </text>
            ) : null,
          )}
          {hover !== null && <rect x={left + band * hover} y={top} width={band} height={plotH} className={s.hoverBand} />}
          {days.map((d, i) => (
            <path key={d.date} d={bar(i, d.sales)} className={s.salesBar} />
          ))}
          {days.length > 1 && (
            <polyline points={days.map((d, i) => `${cx(i)},${y(Math.max(0, d.profit))}`).join(" ")} className={s.profitLine} />
          )}
          {days.map((d, i) =>
            days.length <= 31 || i === hover ? (
              <circle key={d.date} cx={cx(i)} cy={y(Math.max(0, d.profit))} r={i === hover ? 5 : 4} className={s.profitDot} />
            ) : null,
          )}
          {days.map((d, i) => (
            <rect
              key={d.date}
              x={left + band * i}
              y={top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className={s.tooltip}
          style={{ left: Math.min(Math.max(cx(hover), 90), width - 90), top: Math.max(0, y(h.sales) - 8) }}
          role="status"
        >
          <strong>{longDate(h.date)}</strong>
          <span>
            <i className={s.keySales} /> Penjualan <b>{rupiah(h.sales)}</b>
          </span>
          <span>
            <i className={s.keyProfit} /> Profit <b>{rupiah(h.profit)}</b>
          </span>
          <span className={s.tipMuted}>{h.transactions} transaksi</span>
        </div>
      )}
    </div>
  );
}

export function Dashboard({ role, onAsk }: { role: "owner" | "cashier"; onAsk: (q: string) => void }) {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (role !== "owner") return;
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/demo-dashboard?role=${role}&range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 502 ? "Data POS tidak bisa dihubungi. Pastikan mock-pos berjalan." : await r.text());
        return (await r.json()) as Data;
      })
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [role, range]);

  if (role !== "owner") {
    return (
      <div className={s.locked}>
        <span className={s.lockIcon} aria-hidden>
          🔒
        </span>
        <h2>Dashboard khusus Owner</h2>
        <p>Hanya owner yang dapat melihat penjualan dan profit. Ganti peran ke Owner untuk membuka dashboard.</p>
      </div>
    );
  }

  const meta = RANGES.find((r) => r.id === range)!;
  const t = data?.totals, p = data?.previous;
  const margin = t && t.sales ? (t.profit / t.sales) * 100 : 0;
  const avg = t && t.transactions ? t.sales / t.transactions : 0;
  const prevAvg = p && p.transactions ? p.sales / p.transactions : 0;
  const maxQty = data ? Math.max(1, ...data.products.map((x) => x.qty)) : 1;
  const paySales = data ? data.payments.reduce((a, x) => a + x.sales, 0) : 0;

  return (
    <div className={s.dash}>
      <div className={s.top}>
        <div>
          <h1 className={s.title}>Dashboard Penjualan</h1>
          <p className={s.sub}>
            Kopi Tepi · {data ? (data.from === data.to ? longDate(data.to) : `${shortDate(data.from)} – ${shortDate(data.to)}`) : "…"}
          </p>
        </div>
        <div className={s.controls}>
          <div className={s.ranges} role="group" aria-label="Rentang waktu">
            {RANGES.map((r) => (
              <button key={r.id} type="button" className={s.range} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className={s.ask} onClick={() => onAsk(meta.ask)}>
            ✨ Tanya NEXUS: {meta.ask}
          </button>
        </div>
      </div>

      {error && <p className={s.error}>{error}</p>}

      <div className={`${s.body} ${loading ? s.loading : ""}`} aria-busy={loading}>
        <div className={s.kpis}>
          {[
            { label: "Penjualan", value: t?.sales, prev: p?.sales },
            { label: "HPP", value: t?.cogs, prev: p?.cogs, lowerIsBetter: true },
            { label: "Profit", value: t?.profit, prev: p?.profit, extra: t ? `Margin ${margin.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%` : "" },
            { label: "Transaksi", value: t?.transactions, prev: p?.transactions, plain: true },
            { label: "Rata-rata / transaksi", value: avg, prev: prevAvg },
          ].map((k) => (
            <div key={k.label} className={s.kpi}>
              <span className={s.kpiLabel}>{k.label}</span>
              <span className={s.kpiValue}>
                {k.value === undefined || !data ? "—" : k.plain ? k.value.toLocaleString("id-ID") : rupiah(k.value)}
              </span>
              {data && k.prev !== undefined && <Delta now={k.value ?? 0} before={k.prev} label={meta.prev} lowerIsBetter={k.lowerIsBetter} />}
              {k.extra && <span className={s.kpiExtra}>{k.extra}</span>}
            </div>
          ))}
        </div>

        {data && data.totals.missing_cost_items > 0 && (
          <p className={s.warn} role="note">
            <span aria-hidden>⚠️</span> {data.totals.missing_cost_items.toLocaleString("id-ID")} item terjual tanpa HPP (Kue Lapis
            Titipan), jadi profit belum memperhitungkan biayanya.
          </p>
        )}

        <div className={s.grid}>
          <section className={`${s.card} ${s.wide}`}>
            <div className={s.cardHead}>
              <h2>Penjualan &amp; profit harian</h2>
              <div className={s.legend}>
                <span>
                  <i className={s.keySales} /> Penjualan
                </span>
                <span>
                  <i className={s.keyProfit} /> Profit
                </span>
              </div>
            </div>
            {data && data.days.length > 1 ? (
              <SalesChart days={data.days} />
            ) : (
              <p className={s.note}>Pilih 7 atau 30 hari untuk melihat tren harian.</p>
            )}
            {data && (
              <details className={s.table}>
                <summary>Lihat sebagai tabel</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Penjualan</th>
                      <th>HPP</th>
                      <th>Profit</th>
                      <th>Transaksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}>
                        <td>{shortDate(d.date)}</td>
                        <td>{rupiah(d.sales)}</td>
                        <td>{rupiah(d.cogs)}</td>
                        <td>{rupiah(d.profit)}</td>
                        <td>{d.transactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </section>

          <section className={s.card}>
            <div className={s.cardHead}>
              <h2>Produk terlaris</h2>
            </div>
            <ol className={s.products}>
              {data?.products.slice(0, 7).map((x, i) => (
                <li key={x.name} title={`${x.name}: ${x.qty} terjual, ${rupiah(x.sales)}`}>
                  <span className={s.rank}>{i + 1}</span>
                  <span className={s.pName}>{x.name}</span>
                  <span className={s.pQty}>{x.qty.toLocaleString("id-ID")}×</span>
                  <span className={s.pTrack} aria-hidden>
                    <span className={s.pBar} style={{ width: `${(x.qty / maxQty) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className={s.card}>
            <div className={s.cardHead}>
              <h2>Metode bayar</h2>
            </div>
            <div className={s.stack} role="img" aria-label="Porsi penjualan per metode bayar">
              {data?.payments.map((m) => (
                <span
                  key={m.method}
                  className={s[`pay_${m.method}`]}
                  style={{ width: `${paySales ? (m.sales / paySales) * 100 : 0}%` }}
                  title={`${METHOD_LABEL[m.method]}: ${rupiah(m.sales)}`}
                />
              ))}
            </div>
            <ul className={s.payList}>
              {data?.payments.map((m) => (
                <li key={m.method}>
                  <i className={s[`pay_${m.method}`]} />
                  <span>{METHOD_LABEL[m.method]}</span>
                  <span className={s.payPct}>{paySales ? Math.round((m.sales / paySales) * 100) : 0}%</span>
                  <span className={s.payVal}>
                    {rupiah(m.sales)} · {m.transactions.toLocaleString("id-ID")} trx
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
