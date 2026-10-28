"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./Dashboard";
import s from "./pos.module.css";

type Role = "owner" | "cashier";
type Cat = "kopi" | "nonkopi" | "makanan";
type Method = "cash" | "qris";
type Line = { id: string; qty: number };
type Paid = { order: string; lines: (Line & { name: string; price: number })[]; subtotal: number; tax: number; total: number; method: Method; cash: number };
type AiElement = HTMLElement & { getToken: () => Promise<string>; ask(text: string): void; open(): void };

// Static catalog adapted from the Kopi Tepi prototype. The cart lives in this page only: nothing is sent
// to the POS, so the profit figures the assistant reports stay the same throughout a demo.
const PRODUCTS: { id: string; name: string; cat: Cat; price: number; emoji: string }[] = [
  { id: "P01", name: "Tepi Iced Milk Coffee", cat: "kopi", price: 24000, emoji: "🧋" },
  { id: "P02", name: "Americano", cat: "kopi", price: 22000, emoji: "☕" },
  { id: "P03", name: "Cappuccino", cat: "kopi", price: 28000, emoji: "☕" },
  { id: "P04", name: "Tubruk Coffee", cat: "kopi", price: 15000, emoji: "🫖" },
  { id: "P05", name: "V60 Single Origin", cat: "kopi", price: 35000, emoji: "⚗️" },
  { id: "P06", name: "Matcha Latte", cat: "nonkopi", price: 30000, emoji: "🍵" },
  { id: "P07", name: "Hot Chocolate", cat: "nonkopi", price: 26000, emoji: "🍫" },
  { id: "P08", name: "Iced Teh Tarik", cat: "nonkopi", price: 18000, emoji: "🥤" },
  { id: "P09", name: "Lemon Tea", cat: "nonkopi", price: 16000, emoji: "🍋" },
  { id: "P10", name: "Kaya Toast", cat: "makanan", price: 20000, emoji: "🍞" },
  { id: "P11", name: "Butter Croissant", cat: "makanan", price: 25000, emoji: "🥐" },
  { id: "P12", name: "Cheese Banana Fritters", cat: "makanan", price: 18000, emoji: "🍌" },
  { id: "P13", name: "Village Fried Rice", cat: "makanan", price: 32000, emoji: "🍳" },
  { id: "P14", name: "Consignment Layer Cake", cat: "makanan", price: 12000, emoji: "🍰" },
];
const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

const CAT_STYLE: Record<Cat, { bg: string; ink: string; label: string }> = {
  kopi: { bg: "#EBDDCF", ink: "#5B3A21", label: "Coffee" },
  nonkopi: { bg: "#D7E9DD", ink: "#1E5536", label: "Non-coffee" },
  makanan: { bg: "#F5E4C3", ink: "#74490A", label: "Food" },
};

const TAX_RATE = 0.11; // Indonesian VAT (PPN)
const QUICK_CASH = [50000, 100000, 200000];

// Role-specific quick questions for the widget's empty panel (pipe separated).
const SUGGESTIONS: Record<Role, string> = {
  owner: "Profit today? | Profit this week? | Profit on September 30? | How much is a Cappuccino?",
  cashier: "How do I open a shift? | How do I refund a transaction? | What are the opening hours? | Profit today?",
};
const AFTER_SALE: Record<Role, { label: string; question: string }> = {
  owner: { label: "Ask NEXUS: profit today", question: "Profit today?" },
  cashier: { label: "Ask NEXUS: how to refund", question: "How do I refund a transaction?" },
};

const rupiah = (n: number) => "Rp" + Math.round(n).toLocaleString("en-US");
const newOrder = () => "KT-" + Math.floor(1000 + Math.random() * 9000);

/** Eases a displayed number toward `value` over ~300 ms. */
function useTween(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 300);
      const v = a + (value - a) * (1 - (1 - k) ** 3);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export function DemoPos({ aiServiceUrl }: { aiServiceUrl: string }) {
  const [role, setRole] = useState<Role>("owner");
  const [view, setView] = useState<"kasir" | "dashboard">("kasir");
  const [cat, setCat] = useState<Cat | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [bump, setBump] = useState<{ id: string; n: number } | null>(null);
  const [method, setMethod] = useState<Method>("cash");
  const [cashText, setCashText] = useState("");
  const [order, setOrder] = useState("KT-0000");
  const [paid, setPaid] = useState<Paid | null>(null);
  const [session, setSession] = useState({ count: 0, revenue: 0 });
  const [now, setNow] = useState<Date | null>(null);
  const ai = useRef<AiElement | null>(null);

  // Client-only values (random order number, clock) are set after mount to keep hydration stable.
  useEffect(() => {
    setOrder(newOrder());
    if (new URLSearchParams(window.location.search).get("view") === "dashboard") setView("dashboard");
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Callback ref: runs on every (re)mount of the element, which key={role} forces on role change.
  const attach = useCallback(
    (el: HTMLElement | null) => {
      ai.current = el as AiElement | null;
      if (!el) return;
      (el as AiElement).getToken = () => fetch("/api/demo-token?role=" + role).then((r) => r.text());
    },
    [role],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PRODUCTS.filter((p) => (cat === "all" || p.cat === cat) && (!q || p.name.toLowerCase().includes(q)));
  }, [cat, query]);

  const qtyOf = (id: string) => cart.find((l) => l.id === id)?.qty ?? 0;
  const setQty = (id: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.id !== id) : c.some((l) => l.id === id) ? c.map((l) => (l.id === id ? { ...l, qty } : l)) : [...c, { id, qty }]));
  const add = (id: string) => {
    setQty(id, qtyOf(id) + 1);
    setBump((b) => ({ id, n: (b?.n ?? 0) + 1 }));
  };

  const subtotal = cart.reduce((sum, l) => sum + BY_ID.get(l.id)!.price * l.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  const cash = Number(cashText.replace(/\D/g, "")) || 0;
  const canPay = cart.length > 0 && (method === "qris" || cash >= total);
  const shownTotal = useTween(total);

  const pay = () => {
    if (!canPay) return;
    setPaid({
      order,
      lines: cart.map((l) => ({ ...l, name: BY_ID.get(l.id)!.name, price: BY_ID.get(l.id)!.price })),
      subtotal,
      tax,
      total,
      method,
      cash: method === "cash" ? cash : total,
    });
    setSession((x) => ({ count: x.count + 1, revenue: x.revenue + total }));
  };
  const nextSale = () => {
    setPaid(null);
    setCart([]);
    setCashText("");
    setMethod("cash");
    setOrder(newOrder());
  };
  const askAi = (question?: string) => {
    if (question) ai.current?.ask(question);
    else ai.current?.open();
  };

  const count = (c: Cat | "all") => (c === "all" ? PRODUCTS.length : PRODUCTS.filter((p) => p.cat === c).length);

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.brand}>
          <span className={s.logo} aria-hidden>
            ☕
          </span>
          <div>
            <div className={s.brandName}>Kopi Tepi POS</div>
            <div className={s.brandSub}>
              {now ? now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : " "}
            </div>
          </div>
        </div>
        <nav className={s.views} aria-label="Pages">
          {(["kasir", "dashboard"] as const).map((v) => (
            <button key={v} type="button" className={s.view} aria-pressed={view === v} onClick={() => {
                setView(v);
                // The dashboard keeps its range in the URL; the cashier view has none.
                if (v === "kasir") window.history.replaceState(null, "", window.location.pathname);
              }}>
              {v === "kasir" ? "🧾 Cashier" : "📊 Dashboard"}
            </button>
          ))}
        </nav>
        <div className={s.headRight}>
          <span className={s.session}>
            This session: <strong>{session.count}</strong> transactions · <strong>{rupiah(session.revenue)}</strong>
          </span>
          <div role="group" aria-label="User role" className={s.roles}>
            <span className={s.roleLabel}>Signed in as</span>
            {(["owner", "cashier"] as const).map((r) => (
              <button key={r} type="button" className={s.role} aria-pressed={role === r} onClick={() => setRole(r)}>
                {r === "owner" ? "Owner" : "Cashier"}
              </button>
            ))}
          </div>
          <button type="button" className={s.askAi} onClick={() => askAi()}>
            ✨ Ask NEXUS
          </button>
        </div>
      </header>

      {view === "kasir" ? (
        <div className={s.layout}>
          <main>
            <div className={s.tools}>
              <input
                className={s.search}
                type="search"
                placeholder="Search menu…"
                aria-label="Search menu"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className={s.tabs} role="group" aria-label="Categories">
                {(["all", "kopi", "nonkopi", "makanan"] as const).map((c) => (
                  <button key={c} type="button" className={s.tab} aria-pressed={cat === c} onClick={() => setCat(c)}>
                    {c === "all" ? "All" : CAT_STYLE[c].label}
                    <span className={s.tabCount}>{count(c)}</span>
                  </button>
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className={s.empty}>No menu item matches &ldquo;{query}&rdquo;.</p>
            ) : (
              <ul className={s.grid}>
                {visible.map((p) => {
                  const qty = qtyOf(p.id);
                  const popped = bump?.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`${s.product} ${qty ? s.inCart : ""}`}
                        onClick={() => add(p.id)}
                        aria-label={`Add ${p.name}, ${rupiah(p.price)}${qty ? `, ${qty} in cart` : ""}`}
                      >
                        {qty > 0 && (
                          <span key={popped ? bump!.n : 0} className={s.badge} aria-hidden>
                            {qty}
                          </span>
                        )}
                        <span
                          key={popped ? `e${bump!.n}` : "e"}
                          className={`${s.emoji} ${popped ? s.pop : ""}`}
                          style={{ background: CAT_STYLE[p.cat].bg }}
                          aria-hidden
                        >
                          {p.emoji}
                        </span>
                        <span className={s.cat} style={{ background: CAT_STYLE[p.cat].bg, color: CAT_STYLE[p.cat].ink }}>
                          {CAT_STYLE[p.cat].label}
                        </span>
                        <span className={s.name}>{p.name}</span>
                        <span className={s.price}>{rupiah(p.price)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </main>

          <aside className={s.cart} aria-label="Cart">
            <div className={s.cartHead}>
              <h2 className={s.cartTitle}>Order</h2>
              <span className={s.order}>#{order}</span>
            </div>
            {cart.length === 0 ? (
              <div className={s.cartEmpty}>
                <span className={s.cartEmptyIcon} aria-hidden>
                  🛒
                </span>
                <span>The cart is empty. Tap a menu item to add it.</span>
              </div>
            ) : (
              <ul className={s.lines}>
                {cart.map((l) => {
                  const p = BY_ID.get(l.id)!;
                  return (
                    <li key={l.id} className={s.line}>
                      <span className={s.lineName}>{p.name}</span>
                      <span className={s.lineTotal}>{rupiah(p.price * l.qty)}</span>
                      <span className={s.qty}>
                        <button type="button" className={s.qtyBtn} aria-label={`Remove one ${p.name}`} onClick={() => setQty(l.id, l.qty - 1)}>
                          −
                        </button>
                        <span className={s.qtyN}>{l.qty}</span>
                        <button type="button" className={s.qtyBtn} aria-label={`Add one ${p.name}`} onClick={() => setQty(l.id, l.qty + 1)}>
                          +
                        </button>
                      </span>
                      <button type="button" className={s.remove} onClick={() => setQty(l.id, 0)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className={s.summary}>
              <div className={s.row}>
                <span>Subtotal</span>
                <span>{rupiah(subtotal)}</span>
              </div>
              <div className={s.row}>
                <span>VAT 11%</span>
                <span>{rupiah(tax)}</span>
              </div>
              <div className={`${s.row} ${s.total}`}>
                <span>Total</span>
                <span>{rupiah(shownTotal)}</span>
              </div>
            </div>

            <div className={s.pay}>
              <div className={s.methods} role="group" aria-label="Payment method">
                <button type="button" className={s.method} aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>
                  💵 Cash
                </button>
                <button type="button" className={s.method} aria-pressed={method === "qris"} onClick={() => setMethod("qris")}>
                  📱 QRIS
                </button>
              </div>
              {method === "cash" && (
                <>
                  <div className={s.quick}>
                    <button type="button" className={s.quickBtn} onClick={() => setCashText(String(total))} disabled={!total}>
                      Exact amount
                    </button>
                    {QUICK_CASH.map((v) => (
                      <button key={v} type="button" className={s.quickBtn} onClick={() => setCashText(String(v))}>
                        {rupiah(v)}
                      </button>
                    ))}
                  </div>
                  <input
                    className={s.cash}
                    inputMode="numeric"
                    placeholder="Cash received"
                    aria-label="Cash received"
                    value={cash ? cash.toLocaleString("en-US") : ""}
                    onChange={(e) => setCashText(e.target.value)}
                  />
                  {cash > 0 && total > 0 && (
                    <div className={`${s.change} ${cash < total ? s.short : ""}`}>
                      {cash < total ? "Short by " : "Change "}
                      <strong>{rupiah(Math.abs(cash - total))}</strong>
                    </div>
                  )}
                </>
              )}
              <button type="button" className={s.payBtn} disabled={!canPay} onClick={pay}>
                Pay {total > 0 ? rupiah(total) : ""}
              </button>
            </div>
          </aside>
        </div>
      ) : (
        <Dashboard role={role} onAsk={(q) => askAi(q)} />
      )}

      {paid && (
        <div
          className={s.backdrop}
          onClick={(e) => e.target === e.currentTarget && nextSale()}
          onKeyDown={(e) => e.key === "Escape" && nextSale()}
        >
          <div className={s.receipt} role="dialog" aria-modal="true" aria-label="Payment successful">
            <svg className={s.check} viewBox="0 0 72 72" aria-hidden>
              <circle className={s.checkCircle} cx="36" cy="36" r="33" />
              <path className={s.checkMark} d="M22 37l10 10 19-21" />
            </svg>
            <h2 className={s.receiptTitle}>Payment successful</h2>
            <p className={s.receiptSub}>
              #{paid.order} · {paid.method === "cash" ? "Cash" : "QRIS"}
            </p>
            <ul className={s.receiptLines}>
              {paid.lines.map((l) => (
                <li key={l.id}>
                  <span>
                    {l.qty}× {l.name}
                  </span>
                  <span>{rupiah(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className={s.receiptTotals}>
              <div className={s.row}>
                <span>Subtotal</span>
                <span>{rupiah(paid.subtotal)}</span>
              </div>
              <div className={s.row}>
                <span>VAT 11%</span>
                <span>{rupiah(paid.tax)}</span>
              </div>
              <div className={`${s.row} ${s.total}`}>
                <span>Total</span>
                <span>{rupiah(paid.total)}</span>
              </div>
              {paid.method === "cash" && (
                <div className={s.row}>
                  <span>Change</span>
                  <span>{rupiah(paid.cash - paid.total)}</span>
                </div>
              )}
            </div>
            <div className={s.receiptActions}>
              <button type="button" className={s.payBtn} onClick={nextSale} autoFocus>
                New transaction
              </button>
              <button
                type="button"
                className={s.secondary}
                onClick={() => {
                  nextSale();
                  askAi(AFTER_SALE[role].question);
                }}
              >
                ✨ {AFTER_SALE[role].label}
              </button>
            </div>
          </div>
        </div>
      )}

      <Script src={`${aiServiceUrl}/widget/v1/ai-assistant.js`} strategy="afterInteractive" />
      <ai-assistant key={role} ref={attach} app="pos" api={aiServiceUrl} lang="en" position="bottom-left" suggestions={SUGGESTIONS[role]} />
    </div>
  );
}
