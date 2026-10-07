// Bonus / sample items put on top of finished sets (Red Box V2/V3): the set contents never change.
// Value bands per tier, a required kind (e.g. a sample snack in every box), never two variants of one
// product in a set, higher tiers get more. Balanced by a seeded local search (the scratch
// balance_v3.py idea: add / drop / move / swap / exchange-with-spare moves).
import { prisma } from "./db";
import { columnIndex, readWorkbook, type Cell } from "./uploads";
import { Rng } from "./engine/solver";
import { code8 } from "./odoo/client";
import type { Prisma } from "@/generated/prisma/client";

export type BonusItem = {
  id: string;
  name: string;
  code?: string;
  barcode?: string;
  qty: number;
  value: number; // ₮, rounded to 100
  expiry?: string;
  kind?: string; // e.g. food, beauty, warmer, nail…
  family?: string; // variants of one product share it
  exclude?: boolean;
  reason?: string;
  tiers?: string[]; // only these tiers (labels/keys); empty = any
};
export type BonusPool = { kind: "bonus_pool"; sheet: string; rate: number; items: BonusItem[] };

const num = (c: Cell | undefined) => (typeof c === "number" ? c : c != null && /^[\d,.\s]+$/.test(String(c)) ? Number(String(c).replace(/[,\s]/g, "")) : undefined);

export type BonusImportInput = {
  uploadId: number;
  sheet: string;
  headerRow: number;
  nameColumn: string | number;
  qtyColumn: string | number;
  valueColumn: string | number;
  /** ₮ per unit of the value column (e.g. 3.24 when the sheet has Korean won). */
  rate: number;
  codeColumn?: string | number;
  barcodeColumn?: string | number;
  expiryColumn?: string | number;
};

export async function importBonusPool(input: BonusImportInput): Promise<{ summary: string; pool: BonusPool }> {
  const up = await prisma.upload.findUniqueOrThrow({ where: { id: input.uploadId } });
  const sh = (await readWorkbook(up.path)).find((s) => s.name === input.sheet);
  if (!sh) throw new Error(`Sheet "${input.sheet}" not found`);
  const header = sh.rows[input.headerRow - 1] ?? [];
  const col = (ref?: string | number) => (ref === undefined ? -1 : columnIndex(header, ref));
  const [cName, cQty, cVal, cCode, cBar, cExp] = [col(input.nameColumn), col(input.qtyColumn), col(input.valueColumn), col(input.codeColumn), col(input.barcodeColumn), col(input.expiryColumn)];
  const items: BonusItem[] = [];
  for (let r = input.headerRow; r < sh.rows.length; r++) {
    const row = sh.rows[r] ?? [];
    const name = row[cName];
    const raw = num(row[cVal]);
    const qty = num(row[cQty]) ?? 0;
    if (name == null || !String(name).trim() || !raw || qty <= 0) continue;
    items.push({
      id: `b${r + 1}`,
      name: String(name).trim(),
      code: cCode >= 0 && row[cCode] != null ? code8(String(row[cCode])) : undefined,
      barcode: cBar >= 0 && row[cBar] != null ? String(row[cBar]) : undefined,
      qty: Math.floor(qty),
      value: Math.round((raw * input.rate) / 100) * 100,
      expiry: cExp >= 0 && row[cExp] != null ? String(row[cExp]) : undefined,
    });
  }
  const pool: BonusPool = { kind: "bonus_pool", sheet: input.sheet, rate: input.rate, items };
  await prisma.upload.update({ where: { id: up.id }, data: { kind: "bonus_pool", parsed: pool as unknown as Prisma.InputJsonValue } });
  const units = items.reduce((a, i) => a + i.qty, 0);
  const value = items.reduce((a, i) => a + i.qty * i.value, 0);
  return { pool, summary: `${items.length} bonus items, ${units} units worth ≈${Math.round(value).toLocaleString("en-US")}₮ (value × ${input.rate}). Next: label each with classify_bonus (kind, family, exclude, tiers).` };
}

export async function classifyBonus(uploadId: number, labels: Array<Partial<BonusItem> & { id: string }>): Promise<string> {
  const up = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const pool = up.parsed as unknown as BonusPool;
  const by = new Map(labels.map((l) => [l.id, l]));
  let n = 0;
  for (const it of pool.items) {
    const l = by.get(it.id);
    if (!l) continue;
    Object.assign(it, { kind: l.kind ?? it.kind, family: l.family ?? it.family, exclude: l.exclude ?? it.exclude, reason: l.reason ?? it.reason, tiers: l.tiers ?? it.tiers });
    n++;
  }
  await prisma.upload.update({ where: { id: up.id }, data: { parsed: pool as unknown as Prisma.InputJsonValue } });
  return `Labelled ${n} items; ${pool.items.filter((i) => i.exclude).length} excluded, ${pool.items.filter((i) => !i.kind).length} still without a kind.`;
}

// --- Balancer ------------------------------------------------------------------------------------
export type Band = { tier: string; lo: number; hi: number; minItems?: number; maxItems?: number };
export type BalanceInput = { sets: Array<{ code: string; tier: string }>; pool: BonusItem[]; bands: Band[]; requireKind?: string; maxPerKind?: Record<string, number>; seed?: number; iterations?: number };
export type BalanceResult = { assign: Map<string, BonusItem[]>; spare: BonusItem[]; report: string[]; ok: boolean };

type Unit = BonusItem & { u: number };

export function balanceBonus(input: BalanceInput): BalanceResult {
  const rng = new Rng(input.seed ?? 3240);
  const band = new Map(input.bands.map((b) => [b.tier, b]));
  const sets = input.sets.filter((s) => band.has(s.tier));
  let units: Unit[] = [];
  let u = 0;
  for (const it of input.pool.filter((i) => !i.exclude)) for (let k = 0; k < it.qty; k++) units.push({ ...it, u: u++ });
  const fam = (x: Unit) => x.family ?? x.name;
  const inSet = new Map<string, Unit[]>(sets.map((s) => [s.code, []]));
  const tierOf = new Map(sets.map((s) => [s.code, s.tier]));
  const allowed = (x: Unit, code: string) => !x.tiers?.length || x.tiers.includes(tierOf.get(code)!);
  const total = (code: string) => inSet.get(code)!.reduce((a, x) => a + x.value, 0);
  const fits = (x: Unit, code: string, without?: Unit) => {
    const list = inSet.get(code)!.filter((y) => y !== without);
    const b = band.get(tierOf.get(code)!)!;
    if (!allowed(x, code) || list.some((y) => fam(y) === fam(x))) return false;
    if (b.maxItems && list.length + 1 > b.maxItems) return false;
    if (x.kind && input.maxPerKind?.[x.kind] !== undefined && list.filter((y) => y.kind === x.kind).length + 1 > input.maxPerKind[x.kind]) return false;
    return list.reduce((a, y) => a + y.value, 0) + x.value <= b.hi;
  };
  const take = (x: Unit, code: string) => {
    inSet.get(code)!.push(x);
    units = units.filter((y) => y !== x);
  };

  // 1. the required kind first (e.g. one sample snack per box), pricier tiers first
  const order = [...sets].sort((a, b) => band.get(b.tier)!.hi - band.get(a.tier)!.hi);
  if (input.requireKind)
    for (const s of order) {
      const cands = units.filter((x) => x.kind === input.requireKind && fits(x, s.code)).sort((a, b) => a.value - b.value);
      if (cands.length) take(cands[Math.floor(cands.length / 2)], s.code);
    }
  // 2. greedy fill toward each band's middle in rounds: every set still below its middle gets at most one
  //    unit per round (furthest below first), so one tier can't swallow the pool
  for (let round = 0; round < 1_000; round++) {
    const need = sets
      .map((s) => ({ s, gap: (band.get(s.tier)!.lo + band.get(s.tier)!.hi) / 2 - total(s.code) }))
      .filter((x) => x.gap > 0)
      .sort((a, b) => b.gap / band.get(b.s.tier)!.hi - a.gap / band.get(a.s.tier)!.hi);
    let moved = false;
    for (const { s, gap } of need) {
      const c = units.filter((x) => fits(x, s.code));
      if (!c.length) continue;
      const under = c.filter((x) => x.value <= gap).sort((a, b) => b.value - a.value);
      // the biggest unit that still fits under the middle; else the smallest that keeps the set in band
      take(under[0] ?? c.sort((a, b) => a.value - b.value)[0], s.code);
      moved = true;
    }
    if (!moved) break;
  }
  // 3. local search on the cost below
  const cost = () => {
    let c = 0;
    const byTier = new Map<string, number[]>();
    for (const s of sets) {
      const b = band.get(s.tier)!;
      const t = total(s.code);
      const list = inSet.get(s.code)!;
      c += Math.max(0, b.lo - t) * 10 + Math.max(0, t - b.hi) * 10;
      if (input.requireKind && !list.some((x) => x.kind === input.requireKind)) c += 1e6;
      if (b.minItems && list.length < b.minItems) c += 1e5 * (b.minItems - list.length);
      byTier.set(s.tier, [...(byTier.get(s.tier) ?? []), t]);
    }
    for (const t of byTier.values()) c += Math.max(...t) - Math.min(...t);
    return c;
  };
  let best = cost();
  const codes = sets.map((s) => s.code);
  for (let it = 0; it < (input.iterations ?? 30_000) && best > 0; it++) {
    const a = codes[Math.floor(rng.next() * codes.length)];
    const la = inSet.get(a)!;
    const move = Math.floor(rng.next() * 4);
    let undo: (() => void) | null = null;
    if (move === 0 && units.length) {
      // add a spare unit
      const x = units[Math.floor(rng.next() * units.length)];
      if (fits(x, a)) {
        take(x, a);
        undo = () => {
          inSet.set(a, inSet.get(a)!.filter((y) => y !== x));
          units.push(x);
        };
      }
    } else if (move === 1 && la.length) {
      // drop a unit back to the spares
      const x = la[Math.floor(rng.next() * la.length)];
      inSet.set(a, la.filter((y) => y !== x));
      units.push(x);
      undo = () => {
        units = units.filter((y) => y !== x);
        inSet.get(a)!.push(x);
      };
    } else if (move === 2 && la.length && units.length) {
      // exchange with a spare
      const x = la[Math.floor(rng.next() * la.length)];
      const y = units[Math.floor(rng.next() * units.length)];
      if (fits(y, a, x)) {
        inSet.set(a, [...la.filter((z) => z !== x), y]);
        units = [...units.filter((z) => z !== y), x];
        undo = () => {
          inSet.set(a, [...inSet.get(a)!.filter((z) => z !== y), x]);
          units = [...units.filter((z) => z !== x), y];
        };
      }
    } else if (move === 3 && la.length) {
      // swap with another set
      const b = codes[Math.floor(rng.next() * codes.length)];
      const lb = inSet.get(b)!;
      if (b !== a && lb.length) {
        const x = la[Math.floor(rng.next() * la.length)];
        const y = lb[Math.floor(rng.next() * lb.length)];
        if (fits(y, a, x) && fits(x, b, y)) {
          inSet.set(a, [...la.filter((z) => z !== x), y]);
          inSet.set(b, [...lb.filter((z) => z !== y), x]);
          undo = () => {
            inSet.set(a, la);
            inSet.set(b, lb);
          };
        }
      }
    }
    if (!undo) continue;
    const c = cost();
    if (c <= best) best = c;
    else undo();
  }

  const report: string[] = [];
  let ok = true;
  const tiers = [...new Set(sets.map((s) => s.tier))];
  for (const t of tiers) {
    const b = band.get(t)!;
    const tot = sets.filter((s) => s.tier === t).map((s) => total(s.code));
    const out = tot.filter((v) => v < b.lo || v > b.hi).length;
    const noKind = input.requireKind ? sets.filter((s) => s.tier === t && !inSet.get(s.code)!.some((x) => x.kind === input.requireKind)).length : 0;
    if (out || noKind) ok = false;
    report.push(`${t}: bonus ${Math.min(...tot).toLocaleString("en-US")}–${Math.max(...tot).toLocaleString("en-US")}₮ (band ${b.lo.toLocaleString("en-US")}–${b.hi.toLocaleString("en-US")}), ${out} outside the band${input.requireKind ? `, ${noKind} without ${input.requireKind}` : ""}`);
  }
  const avg = tiers.map((t) => ({ t, v: sets.filter((s) => s.tier === t).reduce((a, s) => a + total(s.code), 0) / sets.filter((s) => s.tier === t).length, hi: band.get(t)!.hi })).sort((a, b) => a.hi - b.hi);
  if (avg.some((x, i) => i && x.v <= avg[i - 1].v)) {
    ok = false;
    report.push("Average bonus does not rise with the tier.");
  }
  const spareMap = new Map<string, BonusItem & { qty: number }>();
  for (const x of units) spareMap.set(x.id, { ...x, qty: (spareMap.get(x.id)?.qty ?? 0) + 1 });
  report.push(`${units.length} units left over (≈${units.reduce((a, x) => a + x.value, 0).toLocaleString("en-US")}₮) — keep for sale.`);
  return { assign: new Map([...inSet].map(([k, v]) => [k, v.map(({ u: _u, ...rest }) => rest)])), spare: [...spareMap.values()], report, ok };
}

/** Copy a version, add the balanced bonus items to its sets, save as the next version. */
export async function applyBonus(projectId: number, uploadId: number, opts: { version?: number; bands: Band[]; requireKind?: string; maxPerKind?: Record<string, number>; createdBy: string; label?: string }) {
  const up = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const pool = up.parsed as unknown as BonusPool;
  const src = opts.version
    ? await prisma.version.findUniqueOrThrow({ where: { projectId_number: { projectId, number: opts.version } }, include: { sets: { include: { items: true }, orderBy: { position: "asc" } } } })
    : await prisma.version.findFirstOrThrow({ where: { projectId }, orderBy: { number: "desc" }, include: { sets: { include: { items: true }, orderBy: { position: "asc" } } } });
  const r = balanceBonus({ sets: src.sets.map((s) => ({ code: s.code, tier: s.tier ?? "" })), pool: pool.items, bands: opts.bands, requireKind: opts.requireKind, maxPerKind: opts.maxPerKind });
  const last = await prisma.version.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
  const v = await prisma.version.create({
    data: {
      projectId,
      number: (last?.number ?? 0) + 1,
      label: opts.label ?? `V${src.number} + bonus`,
      createdBy: opts.createdBy,
      snapshotId: src.snapshotId,
      rules: src.rules as Prisma.InputJsonValue,
      recipes: src.recipes as Prisma.InputJsonValue,
      checks: [...((src.checks as unknown[]) ?? []), { name: "Bonus within its tier band", nameMn: "Бонус түвшний хязгаартаа", ok: r.ok, detail: r.report.join(" · "), detailMn: r.report.join(" · ") }] as Prisma.InputJsonValue,
      finance: src.finance as Prisma.InputJsonValue,
      diagnostics: { ...(src.diagnostics as object), bonus: { uploadId, report: r.report, spare: r.spare } } as Prisma.InputJsonValue,
      seed: src.seed,
    },
  });
  for (const s of src.sets) {
    const bonus = r.assign.get(s.code) ?? [];
    await prisma.giftSet.create({
      data: {
        versionId: v.id,
        position: s.position,
        code: s.code,
        tier: s.tier,
        recipeKey: s.recipeKey,
        recipe: s.recipe,
        site: s.site,
        total: s.total,
        bag: s.bag,
        source: s.source,
        label: s.label,
        items: {
          create: [
            ...s.items.map(({ id: _id, setId: _setId, ...i }) => i),
            ...bonus.map((b, k) => ({ position: s.items.length + k, role: "bonus", code: b.code ?? b.id, barcode: b.barcode ?? null, name: b.name, price: 0, value: b.value, slot: b.kind ?? null, note: b.expiry ? `хугацаа ${b.expiry}` : null })),
          ],
        },
      },
    });
  }
  return { version: v.number, ...r };
}
