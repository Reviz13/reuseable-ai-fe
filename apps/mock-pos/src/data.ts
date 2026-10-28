export const OUTLET_ID = "kopi-tepi-01";

interface MenuItem { name: string; price: number; hpp: number | null }

// Same catalog as the demo cashier screen (apps/studio/app/demo/pos). Consignment Layer Cake is a consignment
// item without HPP, so every period has items the profit report cannot cost.
export const MENU: readonly MenuItem[] = [
  { name: "Tepi Iced Milk Coffee", price: 24000, hpp: 9000 },
  { name: "Americano", price: 22000, hpp: 6000 },
  { name: "Cappuccino", price: 28000, hpp: 10000 },
  { name: "Tubruk Coffee", price: 15000, hpp: 4000 },
  { name: "V60 Single Origin", price: 35000, hpp: 14000 },
  { name: "Matcha Latte", price: 30000, hpp: 12000 },
  { name: "Hot Chocolate", price: 26000, hpp: 10000 },
  { name: "Iced Teh Tarik", price: 18000, hpp: 6000 },
  { name: "Lemon Tea", price: 16000, hpp: 5000 },
  { name: "Kaya Toast", price: 20000, hpp: 8000 },
  { name: "Butter Croissant", price: 25000, hpp: 11000 },
  { name: "Cheese Banana Fritters", price: 18000, hpp: 7000 },
  { name: "Village Fried Rice", price: 32000, hpp: 14000 },
  { name: "Consignment Layer Cake", price: 12000, hpp: null },
];

export interface DayTotals {
  sales: number;
  cogs: number;
  transactions: number;
  missing_cost_items: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PaymentMethod = "cash" | "qris" | "card";
export interface DayDetail extends DayTotals {
  products: Record<string, { qty: number; sales: number }>;
  payments: Record<PaymentMethod, { transactions: number; sales: number }>;
}

export function dailyTotals(outletId: string, date: string): DayTotals {
  const { products: _p, payments: _m, ...totals } = dailyDetail(outletId, date);
  return totals;
}

/** One item per transaction. Payment methods use their own stream so the totals stay put. */
export function dailyDetail(outletId: string, date: string): DayDetail {
  const rand = mulberry32(hash(outletId + date));
  const payRand = mulberry32(hash(outletId + date + "|pay"));
  const products: DayDetail["products"] = {};
  const payments: DayDetail["payments"] = {
    cash: { transactions: 0, sales: 0 },
    qris: { transactions: 0, sales: 0 },
    card: { transactions: 0, sales: 0 },
  };
  const transactions = 40 + Math.floor(rand() * 81); // 40..120
  let sales = 0, cogs = 0, missing = 0;
  for (let i = 0; i < transactions; i++) {
    const item = MENU[Math.floor(rand() * MENU.length)]!;
    sales += item.price;
    const p = (products[item.name] ??= { qty: 0, sales: 0 });
    p.qty++;
    p.sales += item.price;
    const r = payRand();
    const m = payments[r < 0.4 ? "cash" : r < 0.85 ? "qris" : "card"];
    m.transactions++;
    m.sales += item.price;
    if (item.hpp === null) missing++;
    else cogs += item.hpp;
  }
  return { sales, cogs, transactions, missing_cost_items: missing, products, payments };
}
