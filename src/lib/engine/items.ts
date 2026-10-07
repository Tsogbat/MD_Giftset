// Solver input: one record per eligible product, plus stock per bin. Pure (no DB) so it can be tested.
import type { Rules } from "./types";

export type Item = {
  pid: number;
  tmpl: number;
  code: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  categ: string;
  top: string;
  sub: string;
  micro: string;
  family: string;
  price: number;
  landed: number | null;
  weekly: number;
  cover: number;
  avail: number;
  units: Record<string, number>;
  newArrival: boolean;
  dims?: [number, number, number];
  /** Draw weight: slower (and, for bundles, higher-stock) items are drawn more often. */
  w: number;
};

export type Bin = { pid: number; site: string; locationId: number; bin: string; qty: number };

export type RawProduct = {
  pid: number;
  tmpl: number;
  code: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  categ: string | null;
  listPrice: number;
  landedCost: number | null;
  active: boolean;
  saleOk: boolean;
  weeklySales: number;
  firstIn: Date | null;
  dims?: [number, number, number];
};

const COLOR_WORDS = new Set([
  "хар", "цагаан", "ягаан", "цэнхэр", "ногоон", "шар", "улаан", "нил", "саарал", "бор", "хөх", "мөнгөлөг", "алтан", "минт", "ivory", "шаргал",
  "цайвар", "тунгалаг", "улбар", "бежь", "black", "white", "pink", "blue", "green", "red", "yellow", "purple", "mint", "gray", "grey", "beige", "brown", "navy",
]);

/** Product line without colour words and the trailing variant word (family_of in both Python builders). */
export function familyOf(name: string): string {
  let words = name.replace(/[(),]/g, " ").split(/\s+/).filter((w) => w && !COLOR_WORDS.has(w.toLowerCase()));
  if (words.length >= 5) words = words.slice(0, -1);
  return words.join(" ").toLowerCase();
}

export function levels(categ: string): { top: string; sub: string; micro: string } {
  const p = categ.split(" / ");
  return { top: p[0] ?? "", sub: p.slice(0, 2).join(" / "), micro: p.slice(0, 3).join(" / ") };
}

export const rx = (pattern: string) => new RegExp(pattern, "i");

export function anyMatch(text: string | null | undefined, patterns: Array<{ pattern: string }>): boolean {
  return patterns.some((p) => rx(p.pattern).test(text ?? ""));
}

/** Why a product is not eligible, or null when it is. */
export function ineligibleReason(p: RawProduct, rules: Rules): string | null {
  const categ = p.categ ?? "";
  if (!p.active || !p.saleOk) return "inactive or not for sale";
  if (p.landedCost == null) return "no landed cost";
  if (p.listPrice < rules.itemPrice[0] || p.listPrice > rules.itemPrice[1]) return "price outside the item range";
  if (rules.exclusions.topCategories.includes(levels(categ).top)) return `top category ${levels(categ).top} excluded`;
  const c = rules.exclusions.categ.find((x) => rx(x.pattern).test(categ));
  if (c) return c.label;
  const n = rules.exclusions.name.find((x) => rx(x.pattern).test(p.name));
  if (n) return n.label;
  const b = rules.exclusions.brand.find((x) => rx(x.pattern).test(p.brand ?? ""));
  if (b) return b.label;
  const c2 = rules.exclusions.codes.find((x) => x.code === p.code);
  if (c2) return `excluded SKU: ${c2.reason}`;
  return null;
}

/**
 * Eligible items with stock in the chosen sites. `bins` must already have other projects' reservations
 * taken off. Cover and new-arrival are recomputed for the chosen sites and rules.
 */
export function buildItems(products: RawProduct[], bins: Bin[], rules: Rules, salesTo: Date): Item[] {
  const sites = new Set(rules.stock.sites);
  const units = new Map<number, Record<string, number>>();
  for (const b of bins) {
    if (!sites.has(b.site) || b.qty <= 0) continue;
    const u = units.get(b.pid) ?? {};
    u[b.site] = (u[b.site] ?? 0) + b.qty;
    units.set(b.pid, u);
  }
  const out: Item[] = [];
  for (const p of products) {
    const u = units.get(p.pid);
    if (!u) continue;
    if (ineligibleReason(p, rules)) continue;
    const avail = Object.values(u).reduce((a, b) => a + b, 0);
    if (avail <= 0) continue;
    const cover = avail / Math.max(p.weeklySales, 0.1);
    const categ = p.categ ?? "";
    const newArrival = p.firstIn ? Math.floor((salesTo.getTime() - p.firstIn.getTime()) / 86_400_000) < rules.filler.newArrivalDays : false;
    const w = rules.filler.weighting === "cover_units" ? Math.log1p(cover) * Math.log1p(avail) : Math.log1p(cover);
    out.push({
      pid: p.pid,
      tmpl: p.tmpl,
      code: p.code,
      barcode: p.barcode,
      name: p.name,
      brand: p.brand,
      categ,
      ...levels(categ),
      family: familyOf(p.name),
      price: Math.round(p.listPrice),
      landed: p.landedCost,
      weekly: p.weeklySales,
      cover,
      avail,
      units: u,
      newArrival,
      dims: p.dims,
      w,
    });
  }
  return out;
}
