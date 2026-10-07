// Odoo → Snapshot: one frozen copy of products, prices, landed costs, sales and stock per bin.
// Every project pins a snapshot so its builds are reproducible (the Tsagaan gar lesson: live sales
// changed the bundles on every rebuild). Metrics follow build_catalog in redbox_199k.py (:377-413).
import { prisma } from "./db";
import { withOdoo, SQL, NON_PICK_LOCATIONS, code8 } from "./odoo/client";

export const DEFAULT_SITES = ["WH", "CEN", "ENC"]; // SILK has no stock yet
export const NEW_ARRIVAL_DAYS = 14;
const DAY = 86_400_000;

type StockRow = { product_id: number; warehouse: string; location_id: number; bin: string; location: string; qty: number };
type ProductRow = { product_id: number; product_tmpl_id: number; default_code: string | null; barcode: string | null; name: unknown; list_price: number; categ: string | null; brand: string | null; active: boolean; sale_ok: boolean };

/** Odoo stores translatable names as JSON ({"en_US": …, "mn_MN": …}); prefer Mongolian. */
export function nameText(name: unknown): string {
  if (name && typeof name === "object") {
    const o = name as Record<string, string>;
    return o.mn_MN ?? o.en_US ?? Object.values(o)[0] ?? "";
  }
  return String(name ?? "");
}

export type Metrics = { weeksOnSale: number; weeklySales: number; weeksCover: number; newArrival: boolean };

/** Weekly sales over the time the item was actually on sale (from its first receipt). */
export function metrics(sold: number, avail: number, firstIn: Date | null, salesStart: Date, salesEnd: Date): Metrics {
  const from = firstIn && firstIn > salesStart ? firstIn : salesStart;
  const weeksOnSale = Math.max(1, Math.floor((salesEnd.getTime() - from.getTime()) / DAY) / 7);
  const weeklySales = Math.max(0, sold) / weeksOnSale;
  return {
    weeksOnSale,
    weeklySales,
    weeksCover: avail / Math.max(weeklySales, 0.1),
    newArrival: Math.floor((salesEnd.getTime() - (firstIn ?? salesStart).getTime()) / DAY) < NEW_ARRIVAL_DAYS,
  };
}

export async function takeSnapshot(createdBy: string, onProgress?: (msg: string) => void): Promise<number> {
  const snap = await prisma.snapshot.create({ data: { createdBy } });
  const say = (m: string) => onProgress?.(m);
  try {
    say("Reading Odoo (read-only)…");
    const data = await withOdoo(async (q) => {
      const [range] = await q<{ first: Date; last: Date }>(SQL.salesRange);
      const stock = await q<StockRow>(SQL.stock);
      const products = await q<ProductRow>(SQL.products);
      const costs = await q<{ product_id: number; landed_cost: number; po: string }>(SQL.cost);
      const sales = await q<{ product_id: number; sold: number }>(SQL.sales);
      const firstIn = await q<{ product_id: number; first_in: Date }>(SQL.firstReceipt);
      return { range, stock, products, costs, sales, firstIn };
    });
    const salesStart = new Date(data.range.first);
    const salesEnd = new Date(data.range.last);
    const stock = data.stock.filter((s) => !NON_PICK_LOCATIONS.includes(s.location) && s.qty > 0);
    const perProduct = new Map<number, Map<string, number>>();
    for (const s of stock) {
      const m = perProduct.get(s.product_id) ?? new Map<string, number>();
      m.set(s.warehouse, (m.get(s.warehouse) ?? 0) + Number(s.qty));
      perProduct.set(s.product_id, m);
    }
    const cost = new Map(data.costs.map((c) => [c.product_id, c]));
    const sold = new Map(data.sales.map((s) => [s.product_id, Number(s.sold)]));
    const first = new Map(data.firstIn.map((f) => [f.product_id, new Date(f.first_in)]));
    say(`Computing metrics for ${perProduct.size} products with stock…`);

    const rows = [];
    for (const p of data.products) {
      const sites = perProduct.get(p.product_id);
      if (!sites) continue; // only products with stock somewhere, like the Python catalog
      const avail = DEFAULT_SITES.reduce((a, s) => a + (sites.get(s) ?? 0), 0);
      const fi = first.get(p.product_id) ?? null;
      const m = metrics(sold.get(p.product_id) ?? 0, avail, fi, salesStart, salesEnd);
      const c = cost.get(p.product_id);
      rows.push({
        snapshotId: snap.id,
        productId: p.product_id,
        tmplId: p.product_tmpl_id,
        code: code8(p.default_code),
        barcode: p.barcode?.trim() || null,
        name: nameText(p.name),
        brand: p.brand?.trim() || null,
        categ: p.categ ?? "",
        listPrice: Number(p.list_price) || 0,
        landedCost: c ? Number(c.landed_cost) : null,
        costPo: c?.po ?? null,
        active: !!p.active,
        saleOk: !!p.sale_ok,
        sold: Math.max(0, sold.get(p.product_id) ?? 0),
        firstIn: fi,
        avail,
        ...m,
      });
    }
    for (let i = 0; i < rows.length; i += 500) await prisma.snapshotProduct.createMany({ data: rows.slice(i, i + 500) });
    const stockRows = stock.map((s) => ({
      snapshotId: snap.id,
      productId: s.product_id,
      site: s.warehouse,
      locationId: s.location_id,
      bin: s.bin,
      location: s.location,
      qty: Number(s.qty),
    }));
    for (let i = 0; i < stockRows.length; i += 1000) await prisma.snapshotStock.createMany({ data: stockRows.slice(i, i + 1000) });
    await prisma.snapshot.update({ where: { id: snap.id }, data: { status: "ready", salesFrom: salesStart, salesTo: salesEnd, products: rows.length } });
    say(`Snapshot #${snap.id}: ${rows.length} products, ${stockRows.length} bin rows, sales ${salesStart.toISOString().slice(0, 10)} → ${salesEnd.toISOString().slice(0, 10)}`);
    return snap.id;
  } catch (e) {
    await prisma.snapshot.update({ where: { id: snap.id }, data: { status: "failed", error: (e as Error).message.slice(0, 1000) } });
    throw e;
  }
}

export async function latestSnapshot() {
  return prisma.snapshot.findFirst({ where: { status: "ready" }, orderBy: { id: "desc" } });
}
