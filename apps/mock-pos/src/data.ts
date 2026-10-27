export const OUTLET_ID = "kopi-tepi-01";

interface MenuItem { name: string; price: number; hpp: number | null }

export const MENU: readonly MenuItem[] = [
  { name: "Kopi Susu", price: 22000, hpp: 8000 },
  { name: "Americano", price: 18000, hpp: 5000 },
  { name: "Latte", price: 28000, hpp: 10000 },
  { name: "Matcha", price: 30000, hpp: 12000 },
  { name: "Croissant", price: 25000, hpp: 11000 },
  { name: "Nasi Goreng", price: 35000, hpp: 15000 },
  { name: "Kue Bulan", price: 15000, hpp: null },
  { name: "Roti Pandan", price: 12000, hpp: null },
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

export function dailyTotals(outletId: string, date: string): DayTotals {
  const rand = mulberry32(hash(outletId + date));
  const transactions = 40 + Math.floor(rand() * 81); // 40..120
  let sales = 0, cogs = 0, missing = 0;
  for (let i = 0; i < transactions; i++) {
    const item = MENU[Math.floor(rand() * MENU.length)]!;
    sales += item.price;
    if (item.hpp === null) missing++;
    else cogs += item.hpp;
  }
  return { sales, cogs, transactions, missing_cost_items: missing };
}
