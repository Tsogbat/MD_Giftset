// Team-made sets (e.g. Red Box 299k/499k, Tsagaan gar 45K): included EXACTLY as given — never substituted,
// re-priced or re-planned (the user's standing rule). We only enrich them from Odoo, check them and report.
import { prisma } from "./db";
import { columnIndex, readWorkbook, type Cell } from "./uploads";
import type { Check } from "./engine/types";
import type { Prisma } from "@/generated/prisma/client";
import { code8 } from "./odoo/client";

export type TeamItem = { code: string; qty: number; sheetName?: string; sheetPrice?: number };
export type TeamSet = { label: string; items: TeamItem[]; sheetTotal?: number };
export type TeamImport = { kind: "team_sets"; tier: string; prefix: string; sellPrice?: number; sheet: string; sets: TeamSet[] };

export type TeamImportInput = {
  uploadId: number;
  sheet: string;
  headerRow: number;
  setColumn: string | number;
  codeColumn: string | number;
  qtyColumn?: string | number;
  nameColumn?: string | number;
  priceColumn?: string | number;
  totalColumn?: string | number;
  tier: string;
  prefix: string;
  sellPrice?: number;
};

const num = (c: Cell | undefined) => (typeof c === "number" ? c : c != null && /^[\d,.\s]+$/.test(String(c)) ? Number(String(c).replace(/[,\s]/g, "")) : undefined);

/** Group rows into sets: the set column names a set on its first row and is blank on the rows below it. */
export async function importTeamSets(input: TeamImportInput): Promise<{ summary: string; data: TeamImport }> {
  const up = await prisma.upload.findUniqueOrThrow({ where: { id: input.uploadId } });
  const sheets = await readWorkbook(up.path);
  const sh = sheets.find((s) => s.name === input.sheet);
  if (!sh) throw new Error(`Sheet "${input.sheet}" not found (${sheets.map((s) => s.name).join(", ")})`);
  const header = sh.rows[input.headerRow - 1] ?? [];
  const col = (ref?: string | number) => (ref === undefined ? -1 : columnIndex(header, ref));
  const [cSet, cCode, cQty, cName, cPrice, cTotal] = [col(input.setColumn), col(input.codeColumn), col(input.qtyColumn), col(input.nameColumn), col(input.priceColumn), col(input.totalColumn)];
  const sets: TeamSet[] = [];
  let current: TeamSet | null = null;
  for (let r = input.headerRow; r < sh.rows.length; r++) {
    const row = sh.rows[r] ?? [];
    const label = row[cSet];
    if (label != null && String(label).trim()) {
      current = { label: String(label).trim(), items: [], sheetTotal: cTotal >= 0 ? num(row[cTotal]) : undefined };
      sets.push(current);
    }
    const code = row[cCode];
    if (!current || code == null || !String(code).trim()) continue;
    current.items.push({
      code: code8(String(typeof code === "number" ? Math.round(code) : code).trim()),
      qty: cQty >= 0 ? (num(row[cQty]) ?? 1) : 1,
      sheetName: cName >= 0 && row[cName] != null ? String(row[cName]) : undefined,
      sheetPrice: cPrice >= 0 ? num(row[cPrice]) : undefined,
    });
  }
  // the qty column in team sheets is often the stock on hand, not units per set: only keep small integers
  const qtyLooksLikeStock = sets.some((s) => s.items.some((i) => i.qty > 5));
  if (qtyLooksLikeStock) for (const s of sets) for (const i of s.items) i.qty = 1;
  const data: TeamImport = { kind: "team_sets", tier: input.tier, prefix: input.prefix, sellPrice: input.sellPrice, sheet: input.sheet, sets: sets.filter((s) => s.items.length) };
  await prisma.upload.update({ where: { id: up.id }, data: { kind: "team_sets", parsed: data as unknown as Prisma.InputJsonValue } });
  const n = data.sets.reduce((a, s) => a + s.items.length, 0);
  return {
    data,
    summary: `${data.sets.length} team sets with ${n} items read from "${input.sheet}" as tier "${input.tier}" (codes ${input.prefix}-01…).${qtyLooksLikeStock ? " The quantity column looked like stock on hand, so every item counts as 1 per set." : ""} They will be included in every version exactly as given.`,
  };
}

export type EnrichedTeamItem = TeamItem & { productId: number | null; name: string; brand: string | null; categ: string | null; price: number | null; landed: number | null; stock: number; barcode: string | null };

export async function teamSetsOf(projectId: number): Promise<TeamImport[]> {
  const ups = await prisma.upload.findMany({ where: { projectId, kind: "team_sets" }, orderBy: { id: "asc" } });
  return ups.map((u) => u.parsed as unknown as TeamImport | null).filter((x): x is TeamImport => !!x?.sets?.length);
}

/** Odoo facts for team items from the project's snapshot. */
export async function enrichTeam(snapshotId: number, imports: TeamImport[]) {
  const codes = [...new Set(imports.flatMap((t) => t.sets.flatMap((s) => s.items.map((i) => i.code))))];
  const rows = await prisma.snapshotProduct.findMany({ where: { snapshotId, code: { in: codes } } });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const stock = await prisma.snapshotStock.groupBy({ by: ["productId"], where: { snapshotId, productId: { in: rows.map((r) => r.productId) }, site: { in: ["WH", "CEN", "ENC"] } }, _sum: { qty: true } });
  const stockBy = new Map(stock.map((s) => [s.productId, s._sum.qty ?? 0]));
  return imports.map((t) => ({
    ...t,
    sets: t.sets.map((s) => ({
      ...s,
      items: s.items.map((i): EnrichedTeamItem => {
        const r = byCode.get(i.code);
        return { ...i, productId: r?.productId ?? null, name: r?.name ?? i.sheetName ?? i.code, brand: r?.brand ?? null, categ: r?.categ ?? null, price: r?.listPrice ?? i.sheetPrice ?? null, landed: r?.landedCost ?? null, stock: r ? (stockBy.get(r.productId) ?? 0) : 0, barcode: r?.barcode ?? null };
      }),
    })),
  }));
}

/** Units the team sets need, per product id (built sets must leave them alone). */
export function teamUsage(enriched: Awaited<ReturnType<typeof enrichTeam>>): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of enriched) for (const s of t.sets) for (const i of s.items) if (i.productId) m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty);
  return m;
}

/** Checks on team sets — reported, never fixed (gift_all.py's team checks). */
export function teamChecks(enriched: Awaited<ReturnType<typeof enrichTeam>>): Check[] {
  const checks: Check[] = [];
  for (const t of enriched) {
    const items = t.sets.flatMap((s) => s.items);
    const missing = items.filter((i) => !i.productId);
    const priceDiff = items.filter((i) => i.sheetPrice != null && i.price != null && Math.round(i.sheetPrice) !== Math.round(i.price));
    const usage = new Map<string, number>();
    for (const i of items) usage.set(i.code, (usage.get(i.code) ?? 0) + i.qty);
    const short = [...usage].filter(([code, n]) => {
      const it = items.find((i) => i.code === code)!;
      return it.productId && it.stock < n;
    });
    const dup = t.sets.filter((s) => new Set(s.items.map((i) => i.code)).size !== s.items.length);
    const noCost = items.filter((i) => i.productId && i.landed == null);
    const add = (name: string, nameMn: string, ok: boolean, detail: string, detailMn = detail) => checks.push({ name: `Team ${t.tier}: ${name}`, nameMn: `Багийн ${t.tier}: ${nameMn}`, ok, detail, detailMn });
    add("every code is in Odoo", "бүх код Odoo-д байгаа", !missing.length, missing.length ? `not found: ${missing.map((i) => i.code).join(", ")}` : `${items.length} items`);
    add("sheet prices = Odoo list price", "файлын үнэ = Odoo үнэ", !priceDiff.length, priceDiff.length ? priceDiff.slice(0, 5).map((i) => `${i.code} ${i.sheetPrice}→${i.price}`).join("; ") : "all equal");
    add("today's stock covers the team sets", "өнөөдрийн үлдэгдэл хүрэлцэнэ", !short.length, short.length ? `short (left as given): ${short.slice(0, 6).map(([c, n]) => `${c} needs ${n}`).join("; ")}` : "enough everywhere");
    add("no SKU twice inside a set", "нэг багцад нэг SKU давхардаагүй", !dup.length, dup.length ? dup.map((s) => s.label).join(", ") : "ok");
    add("landed cost known", "буулгасан өртөг тодорхой", !noCost.length, noCost.length ? `${noCost.length} items without cost` : "ok");
  }
  return checks;
}
