"use client";

import { useEffect, useRef, useState } from "react";
import s from "./dashboard.module.css";

type Preset = "today" | "7d" | "30d";
type Range = Preset | "custom";
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
/** What is on screen: a preset, or a custom From-To (a single day when equal). */
type Selection = { range: Preset } | { range: "custom"; from: string; to: string };

const PRESETS: { id: Preset; label: string; prev: string }[] = [
  { id: "today", label: "Today", prev: "yesterday" },
  { id: "7d", label: "7 days", prev: "previous 7 days" },
  { id: "30d", label: "30 days", prev: "previous 30 days" },
];
const METHOD_LABEL = { cash: "Cash", qris: "QRIS", card: "Card" } as const;
const MAX_DAYS = 92;
const DAY_MS = 86_400_000;

const rupiah = (n: number) => "Rp" + Math.round(n).toLocaleString("en-US");
function compact(n: number): string {
  if (n >= 1e9) return `Rp${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  if (n >= 1e6) return `Rp${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (n >= 1e3) return `Rp${Math.round(n / 1e3)}K`;
  return rupiah(n);
}
const dateFmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const shortDate = (iso: string) => dateFmt(iso, { day: "numeric", month: "short" });
const longDate = (iso: string) => dateFmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const askDate = (iso: string) => dateFmt(iso, { day: "numeric", month: "long", year: "numeric" });
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
/** Today's date in Jakarta, YYYY-MM-DD (the dashboard's calendar). */
const jakartaToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/** Reads ?range=…&from=…&to=… so a view can be shared or reloaded. */
function selectionFromUrl(): Selection {
  try {
    const p = new URLSearchParams(window.location.search);
    const range = p.get("range");
    const from = p.get("from"), to = p.get("to");
    if (range === "custom" && from && to) return { range: "custom", from, to };
    if (range === "today" || range === "7d" || range === "30d") return { range };
  } catch {
    /* no window during prerender */
  }
  return { range: "7d" };
}

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
      {up ? "▲" : "▼"} {Math.abs(pct).toLocaleString("en-US", { maximumFractionDigits: 1 })}%{" "}
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

/** Daily sales (bars) and profit (line) on one Rupiah axis, with a per-day tooltip; a click opens that day. */
function SalesChart({ days, onPick }: { days: Day[]; onPick: (date: string) => void }) {
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
        <svg width={width} height={H} role="img" aria-label="Daily sales and profit chart">
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
              className={s.hit}
              onMouseEnter={() => setHover(i)}
              onClick={() => onPick(d.date)}
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
            <i className={s.keySales} /> Sales <b>{rupiah(h.sales)}</b>
          </span>
          <span>
            <i className={s.keyProfit} /> Profit <b>{rupiah(h.profit)}</b>
          </span>
          <span className={s.tipMuted}>{h.transactions} transactions · click to open this day</span>
        </div>
      )}
    </div>
  );
}

export function Dashboard({ role, onAsk }: { role: "owner" | "cashier"; onAsk: (q: string) => void }) {
  // Client-only (DemoPos mounts the dashboard after hydration), so the URL can seed the first render.
  const [sel, setSel] = useState<Selection>(selectionFromUrl);
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const today = jakartaToday();

  useEffect(() => {
    if (role !== "owner") return;
    const qs = new URLSearchParams({ range: sel.range, ...(sel.range === "custom" ? { from: sel.from, to: sel.to } : {}) });
    try {
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({ view: "dashboard", ...Object.fromEntries(qs) }).toString();
      window.history.replaceState(null, "", url);
    } catch {
      /* URL sync is a convenience */
    }
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/demo-dashboard?role=${role}&${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 502 ? "POS data is unreachable. Make sure mock-pos is running." : await r.text());
        return (await r.json()) as Data;
      })
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [role, sel]);

  if (role !== "owner") {
    return (
      <div className={s.locked}>
        <span className={s.lockIcon} aria-hidden>
          🔒
        </span>
        <h2>Dashboard is for the owner</h2>
        <p>Only the owner can view sales and profit. Switch the role to Owner to open the dashboard.</p>
      </div>
    );
  }

  const pick = (date: string) => {
    setDraft(null);
    setSel({ range: "custom", from: date, to: date });
  };
  const draftError = draft
    ? !draft.from || !draft.to
      ? "Choose both dates."
      : draft.from > draft.to
        ? "From must be on or before To."
        : draft.to > today
          ? "To cannot be in the future."
          : daysBetween(draft.from, draft.to) > MAX_DAYS
            ? `Choose at most ${MAX_DAYS} days.`
            : null
    : null;

  const span = data ? daysBetween(data.from, data.to) : 0;
  const prevLabel =
    sel.range === "custom" ? (span === 1 ? "the day before" : `previous ${span} days`) : PRESETS.find((p) => p.id === sel.range)!.prev;
  const question = !data
    ? "Profit this week?"
    : data.from === data.to
      ? `Profit on ${askDate(data.from)}?`
      : `Profit from ${askDate(data.from)} to ${askDate(data.to)}?`;

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
          <h1 className={s.title}>Sales Dashboard</h1>
          <p className={s.sub}>
            Kopi Tepi · {data ? (data.from === data.to ? longDate(data.to) : `${shortDate(data.from)} – ${shortDate(data.to)}`) : "…"}
          </p>
        </div>
        <div className={s.controls}>
          <div className={s.ranges} role="group" aria-label="Date range">
            {PRESETS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={s.range}
                aria-pressed={sel.range === r.id && !draft}
                onClick={() => {
                  setDraft(null);
                  setSel({ range: r.id });
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              className={s.range}
              aria-pressed={sel.range === "custom" || !!draft}
              onClick={() => setDraft(sel.range === "custom" ? { from: sel.from, to: sel.to } : { from: data?.from ?? today, to: data?.to ?? today })}
            >
              📅 Custom
            </button>
          </div>
          <button type="button" className={s.ask} onClick={() => onAsk(question)}>
            ✨ Ask NEXUS
          </button>
        </div>
      </div>

      {draft && (
        <form
          className={s.custom}
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftError) {
              setSel({ range: "custom", from: draft.from, to: draft.to });
              setDraft(null);
            }
          }}
        >
          <label>
            From
            <input type="date" value={draft.from} max={today} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label>
            To
            <input type="date" value={draft.to} max={today} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <button type="button" className={s.linkBtn} onClick={() => setDraft({ ...draft, to: draft.from })}>
            Single day
          </button>
          <button type="submit" className={s.apply} disabled={!!draftError}>
            Apply
          </button>
          <button type="button" className={s.linkBtn} onClick={() => setDraft(null)}>
            Cancel
          </button>
          {draftError && <span className={s.customError}>{draftError}</span>}
        </form>
      )}

      {error && <p className={s.error}>{error}</p>}

      <div className={`${s.body} ${loading ? s.loading : ""}`} aria-busy={loading}>
        <div className={s.kpis}>
          {[
            { label: "Sales", value: t?.sales, prev: p?.sales },
            { label: "COGS", value: t?.cogs, prev: p?.cogs, lowerIsBetter: true },
            { label: "Profit", value: t?.profit, prev: p?.profit, extra: t ? `Margin ${margin.toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "" },
            { label: "Transactions", value: t?.transactions, prev: p?.transactions, plain: true },
            { label: "Average per transaction", value: avg, prev: prevAvg },
          ].map((k) => (
            <div key={k.label} className={s.kpi}>
              <span className={s.kpiLabel}>{k.label}</span>
              <span className={s.kpiValue}>
                {k.value === undefined || !data ? "—" : k.plain ? k.value.toLocaleString("en-US") : rupiah(k.value)}
              </span>
              {data && k.prev !== undefined && <Delta now={k.value ?? 0} before={k.prev} label={prevLabel} lowerIsBetter={k.lowerIsBetter} />}
              {k.extra && <span className={s.kpiExtra}>{k.extra}</span>}
            </div>
          ))}
        </div>

        {data && data.totals.missing_cost_items > 0 && (
          <p className={s.warn} role="note">
            <span aria-hidden>⚠️</span> {data.totals.missing_cost_items.toLocaleString("en-US")} items were sold without COGS
            (Consignment Layer Cake), so profit does not include their cost yet.
          </p>
        )}

        <div className={s.grid}>
          <section className={`${s.card} ${s.wide}`}>
            <div className={s.cardHead}>
              <h2>Daily sales &amp; profit</h2>
              <div className={s.legend}>
                <span>
                  <i className={s.keySales} /> Sales
                </span>
                <span>
                  <i className={s.keyProfit} /> Profit
                </span>
              </div>
            </div>
            {data && data.days.length > 1 ? (
              <SalesChart days={data.days} onPick={pick} />
            ) : (
              <p className={s.note}>One day selected. Choose a longer range to see the daily trend.</p>
            )}
            {data && (
              <details className={s.table}>
                <summary>View as table</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sales</th>
                      <th>COGS</th>
                      <th>Profit</th>
                      <th>Transactions</th>
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
              <h2>Top products</h2>
            </div>
            <ol className={s.products}>
              {data?.products.slice(0, 7).map((x, i) => (
                <li key={x.name} title={`${x.name}: ${x.qty} sold, ${rupiah(x.sales)}`}>
                  <span className={s.rank}>{i + 1}</span>
                  <span className={s.pName}>{x.name}</span>
                  <span className={s.pQty}>{x.qty.toLocaleString("en-US")}×</span>
                  <span className={s.pTrack} aria-hidden>
                    <span className={s.pBar} style={{ width: `${(x.qty / maxQty) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className={s.card}>
            <div className={s.cardHead}>
              <h2>Payment methods</h2>
            </div>
            <div className={s.stack} role="img" aria-label="Share of sales by payment method">
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
                    {rupiah(m.sales)} · {m.transactions.toLocaleString("en-US")} transactions
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
