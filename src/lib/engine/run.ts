// DB side of the engine: snapshot + catalog sizes + other projects' reservations → solver → checks.
import { prisma } from "../db";
import { ensureCatalog } from "../catalog";
import { buildItems, type Bin, type Item, type RawProduct } from "./items";
import { allocate, bagFor, buildAll, combos, makePlans, Stuck, toBuiltSets, type PoolStats } from "./solver";
import { verify } from "./verify";
import type { BuiltSet, Check, Plan } from "./types";

export type Inputs = { products: RawProduct[]; bins: Bin[]; salesTo: Date; items: Item[] };

/** Products and bins of a snapshot; bins already exclude units promised to other projects. */
export async function loadInputs(plan: Plan, snapshotId: number, projectId: number | null, onProgress?: (m: string) => void): Promise<Inputs> {
  const snap = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  const rows = await prisma.snapshotProduct.findMany({ where: { snapshotId } });
  const stock = await prisma.snapshotStock.findMany({ where: { snapshotId } });
  const ledger = await prisma.ledgerEntry.findMany({ where: projectId ? { projectId: { not: projectId } } : {} });
  const promised = new Map<string, number>();
  for (const l of ledger) promised.set(`${l.productId}|${l.site}|${l.bin}`, (promised.get(`${l.productId}|${l.site}|${l.bin}`) ?? 0) + l.qty);
  const bins: Bin[] = stock
    .map((s) => ({ pid: s.productId, site: s.site, locationId: s.locationId, bin: s.bin, qty: s.qty - (promised.get(`${s.productId}|${s.site}|${s.bin}`) ?? 0) }))
    .filter((b) => b.qty > 0);

  let dims = new Map<string, [number, number, number]>();
  if (plan.rules.packaging.enabled) {
    // sizes are needed only for items that could go into a slot
    const bands = plan.batches.flatMap((b) => b.recipes.flatMap((r) => [...(r.hero ? [r.hero.band] : []), ...r.slots.map((s) => s.band)]));
    const lo = Math.min(...bands.map((b) => b[0]));
    const hi = Math.max(...bands.map((b) => b[1]));
    const want = rows.filter((r) => r.listPrice >= lo && r.listPrice <= hi && r.avail >= 1);
    onProgress?.(`Checking package sizes for ${want.length} candidate products on img.artbox.kr…`);
    const facts = await ensureCatalog(want.map((r) => ({ code: r.code, barcode: r.barcode })), (d, t) => {
      if (d % 100 === 0 || d === t) onProgress?.(`img.artbox.kr sizes ${d}/${t}`);
    });
    dims = new Map([...facts.values()].filter((f) => f.dims).map((f) => [f.code, f.dims!]));
  }
  const products: RawProduct[] = rows.map((r) => ({
    pid: r.productId,
    tmpl: r.tmplId,
    code: r.code,
    barcode: r.barcode,
    name: r.name,
    brand: r.brand,
    categ: r.categ,
    listPrice: r.listPrice,
    landedCost: r.landedCost,
    active: r.active,
    saleOk: r.saleOk,
    weeklySales: r.weeklySales,
    firstIn: r.firstIn,
    dims: dims.get(r.code),
  }));
  const salesTo = snap.salesTo ?? snap.takenAt;
  return { products, bins, salesTo, items: buildItems(products, bins, plan.rules, salesTo) };
}

export type SlotReport = { label: string; band: [number, number]; pool: number; perSite?: Record<string, number>; median: number | null; warning?: string };
export type RecipeReport = { batch: string; key: string; name: string; boxes: number; hero: SlotReport | null; slots: SlotReport[]; combos: number; feasible: boolean; problems: string[] };
export type Diagnostics = { stats: Record<string, PoolStats>; recipes: RecipeReport[] };

/** Pool sizes and feasibility per recipe, without building (the agent's check_pools tool). */
export function diagnose(plan: Plan, items: Item[]): Diagnostics {
  const { rules } = plan;
  const stats: Record<string, PoolStats> = {};
  const recipes: RecipeReport[] = [];
  for (const batch of plan.batches) {
    const { plans, stats: st } = makePlans(batch, items, rules);
    stats[batch.key] = st;
    for (const p of plans) {
      const problems: string[] = [];
      const rep = (pool: NonNullable<typeof p.heroPool>, isHero: boolean): SlotReport => {
        const prices = pool.items.map((i) => i.price).sort((a, b) => a - b);
        const perSite = rules.stock.allocate && rules.stock.oneSitePerSet ? Object.fromEntries(rules.stock.sites.map((s) => [s, pool.items.filter((i) => (i.units[s] ?? 0) >= 1).length])) : undefined;
        const need = isHero ? (rules.hero.distinct ? p.recipe.boxes : 1) : rules.search.minSlotPool;
        const warning = pool.items.length < need ? `only ${pool.items.length} candidates (${isHero ? `need ${need} different heroes` : `want ≥ ${need}`})` : undefined;
        if (warning) problems.push(`${isHero ? "hero" : pool.slot.label}: ${warning}`);
        return { label: pool.slot.label, band: pool.slot.band, pool: pool.items.length, perSite, median: prices.length ? prices[Math.floor(prices.length / 2)] : null, warning };
      };
      const hero = p.heroPool ? rep(p.heroPool, true) : null;
      const slots = p.pools.map((pool) => rep(pool, false));
      const lo = (p.heroPool ? Math.min(...p.heroPool.items.map((i) => i.price), Infinity) : 0) + p.pools.reduce((a, x) => a + Math.min(...x.items.map((i) => i.price), Infinity), 0);
      const hi = (p.heroPool ? Math.max(...p.heroPool.items.map((i) => i.price), -Infinity) : 0) + p.pools.reduce((a, x) => a + Math.max(...x.items.map((i) => i.price), -Infinity), 0);
      if (Number.isFinite(lo) && lo > batch.target + batch.tolerance) problems.push(`cheapest possible set is ${Math.round(lo)}₮ — above the target; lower some bands or drop a slot`);
      if (Number.isFinite(hi) && hi < batch.target - batch.tolerance) problems.push(`dearest possible set is ${Math.round(hi)}₮ — below the target; raise bands or add a slot`);
      const c = combos(p, rules);
      if (p.pools.length === 2 && c < p.recipe.boxes) problems.push(`only ${c} hero+filler combinations land on target for ${p.recipe.boxes} sets`);
      recipes.push({ batch: batch.key, key: p.recipe.key, name: p.recipe.name, boxes: p.recipe.boxes, hero, slots, combos: c, feasible: problems.length === 0, problems });
    }
  }
  return { stats, recipes };
}

export type BuildResult =
  | { ok: true; seed: number; sets: BuiltSet[]; checks: Check[]; stats: Record<string, PoolStats>; diagnostics: Diagnostics }
  | { ok: false; error: string; stuck?: { batch: string; recipe: string; name: string; k: number }; diagnostics: Diagnostics };

export function runBuild(plan: Plan, inputs: Inputs): BuildResult {
  const diagnostics = diagnose(plan, inputs.items);
  try {
    const out = buildAll(plan.batches, inputs.items, plan.rules);
    const alloc = plan.rules.stock.allocate ? allocate(out.boxes, inputs.bins, plan.rules) : null;
    const sets = toBuiltSets(out, alloc);
    for (const s of sets) if (plan.rules.packaging.enabled) s.bag = bagFor(s.items.map((i) => i.dims), plan.rules.packaging);
    const checks = verify(plan, sets, out.stats, alloc ? inputs.bins : null);
    return { ok: true, seed: out.seed, sets, checks, stats: out.stats, diagnostics };
  } catch (e) {
    if (e instanceof Stuck) return { ok: false, error: e.message, stuck: { batch: e.batchKey, recipe: e.recipeKey, name: e.recipeName, k: e.k }, diagnostics };
    return { ok: false, error: (e as Error).message, diagnostics };
  }
}
