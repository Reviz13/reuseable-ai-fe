"use client";

import Script from "next/script";
import { useCallback, useState } from "react";

type Role = "owner" | "cashier";
type Cat = "kopi" | "nonkopi" | "makanan";

// Static catalog adapted from the Kopi Tepi prototype. This page is only a host for the widget.
const PRODUCTS: { id: string; name: string; cat: Cat; price: number }[] = [
  { id: "P01", name: "Es Kopi Susu Tepi", cat: "kopi", price: 24000 },
  { id: "P02", name: "Americano", cat: "kopi", price: 22000 },
  { id: "P03", name: "Cappuccino", cat: "kopi", price: 28000 },
  { id: "P04", name: "Kopi Tubruk", cat: "kopi", price: 15000 },
  { id: "P05", name: "V60 Single Origin", cat: "kopi", price: 35000 },
  { id: "P06", name: "Matcha Latte", cat: "nonkopi", price: 30000 },
  { id: "P07", name: "Cokelat Panas", cat: "nonkopi", price: 26000 },
  { id: "P08", name: "Es Teh Tarik", cat: "nonkopi", price: 18000 },
  { id: "P09", name: "Lemon Tea", cat: "nonkopi", price: 16000 },
  { id: "P10", name: "Roti Bakar Srikaya", cat: "makanan", price: 20000 },
  { id: "P11", name: "Croissant Mentega", cat: "makanan", price: 25000 },
  { id: "P12", name: "Pisang Goreng Keju", cat: "makanan", price: 18000 },
  { id: "P13", name: "Nasi Goreng Kampung", cat: "makanan", price: 32000 },
  { id: "P14", name: "Kue Lapis Titipan", cat: "makanan", price: 12000 },
];

const CAT_STYLE: Record<Cat, { bg: string; ink: string; label: string }> = {
  kopi: { bg: "#EBDDCF", ink: "#5B3A21", label: "Kopi" },
  nonkopi: { bg: "#D7E9DD", ink: "#1E5536", label: "Non-kopi" },
  makanan: { bg: "#F5E4C3", ink: "#74490A", label: "Makanan" },
};

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");

export function DemoPos({ aiServiceUrl }: { aiServiceUrl: string }) {
  const [role, setRole] = useState<Role>("owner");

  // Callback ref: runs on every (re)mount of the element, which key={role} forces on role change.
  const attach = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      (el as HTMLElement & { getToken: () => Promise<string> }).getToken = () =>
        fetch("/api/demo-token?role=" + role).then((r) => r.text());
    },
    [role],
  );

  return (
    <div style={{ minHeight: "100vh", background: "#E8ECE5", color: "#17231E", fontFamily: "system-ui, sans-serif" }}>
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
          padding: "16px 24px", background: "#F5F7F2", borderBottom: "1px solid #D2D9D0",
        }}
      >
        <strong style={{ fontSize: 20 }}>Kopi Tepi POS</strong>
        <div role="group" aria-label="Peran pengguna" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#56655D", fontSize: 14 }}>Masuk sebagai</span>
          {(["owner", "cashier"] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={role === r}
              onClick={() => setRole(r)}
              style={{
                padding: "6px 14px", borderRadius: 999, cursor: "pointer", font: "inherit",
                border: "1px solid #1E6A45",
                background: role === r ? "#1E6A45" : "transparent",
                color: role === r ? "#fff" : "#1E6A45",
              }}
            >
              {r === "owner" ? "Owner" : "Kasir"}
            </button>
          ))}
        </div>
      </header>

      <main style={{ padding: 24 }}>
        <ul
          style={{
            listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          }}
        >
          {PRODUCTS.map((p) => (
            <li key={p.id} style={{ background: "#fff", border: "1px solid #D2D9D0", borderRadius: 12, padding: 14 }}>
              <span
                style={{
                  fontSize: 12, padding: "2px 8px", borderRadius: 999,
                  background: CAT_STYLE[p.cat].bg, color: CAT_STYLE[p.cat].ink,
                }}
              >
                {CAT_STYLE[p.cat].label}
              </span>
              <div style={{ margin: "10px 0 4px", fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontFamily: "ui-monospace, monospace", color: "#56655D" }}>{rupiah(p.price)}</div>
            </li>
          ))}
        </ul>
      </main>

      <Script src={`${aiServiceUrl}/widget/v1/ai-assistant.js`} strategy="afterInteractive" />
      <ai-assistant key={role} ref={attach} app="pos" api={aiServiceUrl} />
    </div>
  );
}
