// Deterministic set builder — a TypeScript port of the proven Python engines, unified:
//   redbox_199k.py   try_box / close_with_pair / build_box / build_boxes / allocate (:537-697)
//   gift_bundles.py  Usage / has_fill / combos / build_batch scarcest-first / seed retries / bag fit (:471-812)
// Everything that was a constant is read from Rules / Batch, so one engine builds mystery boxes,
// gift bundles and anything in between. The AI never picks SKUs; it writes the recipes this follows.
import type { Batch, BuiltSet, Recipe, Rules, SetItem, Slot } from "./types";
import { type Bin, type Item, rx } from "./items";

// --- Random numbers (seeded, so a seed reproduces a build) ---------------------------------------
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  sample<T>(arr: T[], k: number): T[] {
    return this.shuffle(arr).slice(0, k);
  }
  choice<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// --- Helpers -----------------------------------------------------------------------------------
export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function matches(categ: string, kinds: string[]): boolean {
  return kinds.some((k) => categ === k || categ.startsWith(k + " / "));
}

export function joinPatterns(patterns: Array<string | undefined>): RegExp | undefined {
  const ps = patterns.filter((p): p is string => !!p);
  return ps.length ? rx(ps.map((p) => `(?:${p})`).join("|")) : undefined;
}

function nameOk(name: string, slot: Slot, exclude?: RegExp): boolean {
  return (!exclude || !exclude.test(name)) && (!slot.require || rx(slot.require).test(name));
}

export type Packaging = Rules["packaging"];

/** Smallest bag that holds items of these sizes (longest side first), or null (bag_for in gift_bundles.py). */
export function bagFor(dims: Array<[number, number, number] | undefined>, pk: Packaging): string | null {
  if (!dims.length || dims.some((d) => !d)) return null;
  const ds = dims as Array<[number, number, number]>;
  const longest = Math.max(...ds.map((d) => d[0]));
  const widest = Math.max(...ds.map((d) => d[1]));
  const stack = ds.reduce((a, d) => a + d[2], 0);
  const bags = [...pk.bags].sort((a, b) => a.w * a.h - b.w * b.h);
  for (const bag of bags) {
    if (longest <= bag.h - pk.topFold && widest + stack <= bag.w + pk.girthSlack && stack <= bag.maxStack) return bag.code;
  }
  return null;
}

// --- Pools -------------------------------------------------------------------------------------
export type Pool = { slot: Slot; lo: number; hi: number; items: Item[]; typ: number };

export function makePool(slot: Slot, records: Item[], exclude?: RegExp): Pool {
  const [lo, hi] = slot.band;
  const items = records.filter((r) => matches(r.categ, slot.kinds) && r.price >= lo && r.price <= hi && nameOk(r.name, slot, exclude));
  return { slot, lo, hi, items, typ: items.length ? median(items.map((i) => i.price)) : (lo + hi) / 2 };
}

export type RecipePlan = {
  batch: Batch;
  recipe: Recipe;
  index: number;
  heroPool: Pool | null;
  pools: Pool[];
  exclude?: RegExp;
  boxes: Box[];
};

export type PoolStats = {
  eligible: number;
  sellers: number;
  cuts: Record<string, number>;
  coverCut: number;
  heroBase: number;
  fillerBase: number;
  noSize?: number;
};

export function recipeExclude(recipe: Recipe, rules: Rules): RegExp | undefined {
  const seg = rules.segmentExcludes.filter((s) => recipe.segment && s.segment.toLowerCase() === recipe.segment.toLowerCase()).map((s) => s.pattern);
  return joinPatterns([recipe.exclude, ...seg]);
}

/** Hero candidates (best sellers) and slow movers for one batch, then a pool per recipe slot (split_pools + make_plans). */
export function makePlans(batch: Batch, items: Item[], rules: Rules): { plans: RecipePlan[]; stats: PoolStats } {
  const pk = rules.packaging;
  const fitsAlone = (i: Item) => !pk.enabled || bagFor([i.dims], pk) !== null;
  const sellers = items.filter((i) => i.weekly > 0).map((i) => i.weekly);
  const shareOf = (r: Recipe) => r.heroShare ?? rules.hero.topShare;
  const cuts: Record<string, number> = {};
  for (const r of batch.recipes) cuts[String(shareOf(r))] = quantile(sellers, 1 - shareOf(r));
  const minCut = Math.min(...Object.values(cuts));
  const heroRecipes = batch.recipes.filter((r) => r.hero && rules.hero.enabled);
  const heroLo = Math.min(...heroRecipes.map((r) => r.hero!.band[0]), Infinity);
  const heroHi = Math.max(...heroRecipes.map((r) => r.hero!.band[1]), -Infinity);
  const heroEx = rules.hero.excludeCateg ? rx(rules.hero.excludeCateg) : undefined;
  const heroBase = items.filter(
    (i) =>
      i.weekly >= minCut &&
      i.price >= heroLo &&
      i.price <= heroHi &&
      !(heroEx && heroEx.test(i.categ)) &&
      i.avail >= Math.max(1, rules.hero.minUnits) &&
      i.avail - 1 >= rules.hero.keepWeeks * i.weekly &&
      fitsAlone(i),
  );
  const coverCut = rules.filler.coverQuantile > 0 ? quantile(items.map((i) => i.cover), rules.filler.coverQuantile) : 0;
  const slots = batch.recipes.flatMap((r) => r.slots);
  const fillLo = Math.min(...slots.map((s) => s.band[0]), Infinity);
  const fillHi = Math.max(...slots.map((s) => s.band[1]), -Infinity);
  const fillerBase = items.filter((i) => i.cover >= coverCut && i.avail >= Math.max(1, rules.filler.minUnits) && !i.newArrival && i.price >= fillLo && i.price <= fillHi && fitsAlone(i));

  const plans: RecipePlan[] = batch.recipes.map((recipe, index) => {
    const exclude = recipeExclude(recipe, rules);
    const heroPool = recipe.hero && rules.hero.enabled ? makePool(recipe.hero, heroBase.filter((h) => h.weekly >= cuts[String(shareOf(recipe))]), exclude) : null;
    return { batch, recipe, index, heroPool, pools: [], exclude, boxes: [] };
  });
  const heroPids = new Set(plans.flatMap((p) => p.heroPool?.items.map((i) => i.pid) ?? []));
  const fillers = fillerBase.filter((f) => !heroPids.has(f.pid));
  for (const p of plans) p.pools = p.recipe.slots.map((s) => makePool(s, fillers, p.exclude));
  return {
    plans,
    stats: {
      eligible: items.length,
      sellers: sellers.length,
      cuts,
      coverCut,
      heroBase: heroBase.length,
      fillerBase: fillerBase.length,
      noSize: pk.enabled ? items.filter((i) => !i.dims).length : undefined,
    },
  };
}

// --- State: units left, SKU and product-line uses ----------------------------------------------
const ANY = "*";

export class State {
  uses = new Map<number, number>();
  famUses = new Map<string, number>();
  left = new Map<string, number>();
  usedHeroes = new Set<number>();
  all: Box[] = [];
  constructor(public rules: Rules, items: Item[]) {
    if (rules.stock.allocate) {
      for (const i of items) {
        let sum = 0;
        for (const [site, q] of Object.entries(i.units)) {
          this.left.set(`${i.pid}|${site}`, q);
          sum += q;
        }
        this.left.set(`${i.pid}|${ANY}`, sum);
      }
    }
  }
  unitsLeft(pid: number, site: string | null): number {
    if (!this.rules.stock.allocate || site === null) return Infinity;
    return this.left.get(`${pid}|${site}`) ?? 0;
  }
  canUse(it: Item, site: string | null, blocked: Set<string>): boolean {
    return (
      this.unitsLeft(it.pid, site) >= 1 &&
      (this.uses.get(it.pid) ?? 0) < this.rules.reuse.maxUsesPerSku &&
      (this.famUses.get(it.family) ?? 0) < this.rules.reuse.maxFamilyUses &&
      !blocked.has(it.family)
    );
  }
  weight(it: Item): number {
    return it.w * this.rules.reuse.reuseWeight ** (this.uses.get(it.pid) ?? 0) * this.rules.reuse.familyWeight ** (this.famUses.get(it.family) ?? 0);
  }
  take(box: Box) {
    for (const it of box.items) {
      if (this.rules.stock.allocate && box.site !== null) {
        const k = `${it.pid}|${box.site}`;
        this.left.set(k, (this.left.get(k) ?? 0) - 1);
        // the "any site" counter follows every per-site use (it is what hero candidates check)
        if (box.site !== ANY) this.left.set(`${it.pid}|${ANY}`, (this.left.get(`${it.pid}|${ANY}`) ?? 0) - 1);
      }
      this.uses.set(it.pid, (this.uses.get(it.pid) ?? 0) + 1);
      this.famUses.set(it.family, (this.famUses.get(it.family) ?? 0) + 1);
    }
    if (box.heroItem) this.usedHeroes.add(box.heroItem.pid);
    this.all.push(box);
  }
}

// --- One set -----------------------------------------------------------------------------------
export class Box {
  items: Item[] = [];
  slots: number[] = []; // -1 = hero
  pids = new Set<number>();
  tmpls = new Set<number>();
  fams = new Set<string>();
  leaf = new Map<string, number>();
  sub = new Map<string, number>();
  top = new Map<string, number>();
  k = 0;
  constructor(public site: string | null, public rules: Rules, public plan: RecipePlan) {}

  get heroItem(): Item | null {
    return this.slots[0] === -1 ? this.items[0] : null;
  }
  get total(): number {
    return this.items.reduce((a, i) => a + i.price, 0);
  }
  get bag(): string | null {
    return this.rules.packaging.enabled ? bagFor(this.items.map((i) => i.dims), this.rules.packaging) : null;
  }

  fits(it: Item, extra?: Item): boolean {
    if (this.pids.has(it.pid) || this.tmpls.has(it.tmpl) || this.fams.has(it.family)) return false;
    if (extra && (extra.tmpl === it.tmpl || extra.family === it.family)) return false;
    const mix = this.rules.mix;
    const over = (m: Map<string, number>, key: string, extraKey: string | undefined, limit: number | undefined) =>
      limit !== undefined && (m.get(key) ?? 0) + 1 + (extraKey === key ? 1 : 0) > limit;
    if (over(this.leaf, it.categ, extra?.categ, mix.leaf) || over(this.sub, it.sub, extra?.sub, mix.sub) || over(this.top, it.top, extra?.top, mix.top)) return false;
    if (this.rules.packaging.enabled) {
      const dims = [...this.items.map((i) => i.dims), it.dims, ...(extra ? [extra.dims] : [])];
      if (bagFor(dims, this.rules.packaging) === null) return false;
    }
    return true;
  }

  add(it: Item, slot: number) {
    this.items.push(it);
    this.slots.push(slot);
    this.pids.add(it.pid);
    this.tmpls.add(it.tmpl);
    this.fams.add(it.family);
    for (const [m, key] of [[this.leaf, it.categ], [this.sub, it.sub], [this.top, it.top]] as const) m.set(key, (m.get(key) ?? 0) + 1);
  }
}

type Ctx = { rng: Rng; state: State; rules: Rules; batch: Batch };

function closeWithOne(ctx: Ctx, pool: Pool, box: Box, remaining: number, blocked: Set<string>): Item | null {
  const tol = ctx.batch.tolerance;
  const cands = pool.items.filter((b) => Math.abs(b.price - remaining) <= tol && ctx.state.canUse(b, box.site, blocked) && box.fits(b));
  if (!cands.length) return null;
  return ctx.rng.choice(cands, cands.map((b) => ctx.state.weight(b) * (1 - (tol ? (0.5 * Math.abs(b.price - remaining)) / tol : 0)) + 1e-12));
}

/** Two items, one per closing slot, that bring the set within target ± tolerance. */
function closeWithPair(ctx: Ctx, pa: Pool, pb: Pool, box: Box, remaining: number, blocked: Set<string>): [Item, Item] | null {
  const { state, rng } = ctx;
  const tol = ctx.batch.tolerance;
  const ok = (it: Item) => state.canUse(it, box.site, blocked) && box.fits(it);
  const byPrice = new Map<number, Item[]>();
  for (const b of pb.items) if (ok(b)) byPrice.set(b.price, [...(byPrice.get(b.price) ?? []), b]);
  const prices = [...byPrice.keys()].sort((x, y) => x - y);
  let firsts = pa.items.filter(ok);
  if (firsts.length > 40) firsts = rng.sample(firsts, 40);
  const pairs: Array<[Item, Item]> = [];
  const weights: number[] = [];
  for (const a of firsts) {
    const want = remaining - a.price;
    for (const p of prices) {
      if (p < want - tol) continue;
      if (p > want + tol) break;
      const best = [...byPrice.get(p)!].sort((x, y) => state.weight(y) - state.weight(x)).slice(0, 3);
      for (const b of best) {
        if (b.pid !== a.pid && box.fits(b, a)) {
          pairs.push([a, b]);
          // anywhere in the band is fine; nearer the target gets a slight edge
          weights.push(state.weight(a) * state.weight(b) * (1 - (tol ? (0.5 * Math.abs(p - want)) / tol : 0)) + 1e-12);
        }
      }
    }
  }
  return pairs.length ? rng.choice(pairs, weights) : null;
}

function tryBox(ctx: Ctx, plan: RecipePlan, hero: Item | null, site: string | null, blocked: Set<string>): Box | null {
  const { rng, state, rules, batch } = ctx;
  const pools = plan.pools;
  const box = new Box(site, rules, plan);
  if (hero) box.add(hero, -1);
  const order = rng.shuffle(pools.map((_, i) => i));
  const nClose = Math.min(2, order.length);
  const body = order.slice(0, order.length - nClose);
  const closing = order.slice(order.length - nClose);
  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    const rest = [...body.slice(i + 1), ...closing];
    const remaining = batch.target - box.total;
    const lo = Math.max(pools[s].lo, remaining - batch.tolerance - rest.reduce((a, r) => a + pools[r].hi, 0));
    const hi = Math.min(pools[s].hi, remaining + batch.tolerance - rest.reduce((a, r) => a + pools[r].lo, 0));
    const cands = pools[s].items.filter((it) => it.price >= lo && it.price <= hi && state.canUse(it, site, blocked) && box.fits(it));
    if (!cands.length) return null;
    // steer each pick toward this slot's fair share of the money still to fill
    const target = Math.max(1, (remaining * pools[s].typ) / [s, ...rest].reduce((a, r) => a + pools[r].typ, 0));
    const weights = cands.map((c) => Math.max(state.weight(c) * Math.exp(-(((c.price - target) / (0.5 * target)) ** 2)), 1e-12));
    box.add(rng.choice(cands, weights), s);
  }
  const remaining = batch.target - box.total;
  if (closing.length === 2) {
    const pair = closeWithPair(ctx, pools[closing[0]], pools[closing[1]], box, remaining, blocked);
    if (!pair) return null;
    box.add(pair[0], closing[0]);
    box.add(pair[1], closing[1]);
  } else if (closing.length === 1) {
    const one = closeWithOne(ctx, pools[closing[0]], box, remaining, blocked);
    if (!one) return null;
    box.add(one, closing[0]);
  }
  if (Math.abs(box.total - batch.target) > batch.tolerance) return null;
  if (batch.hardRange && (box.total < batch.hardRange[0] || box.total > batch.hardRange[1])) return null;
  if (rules.mix.minTopCats && box.top.size < rules.mix.minTopCats) return null;
  for (const other of state.all) {
    let shared = 0;
    for (const p of box.pids) if (other.pids.has(p)) shared++;
    if (rules.reuse.maxShared !== undefined ? shared > rules.reuse.maxShared : shared === box.pids.size && shared === other.pids.size) return null;
  }
  return box;
}

type Score = [number, number, number, number, number];

function score(box: Box, ctx: Ctx): Score {
  const { state, batch } = ctx;
  const dev = Math.abs(box.total - batch.target);
  const reused = box.items.filter((i) => (state.uses.get(i.pid) ?? 0) > 0).length;
  const famRepeats = box.items.filter((i) => (state.famUses.get(i.family) ?? 0) > 0).length;
  const fillers = box.items.filter((_, i) => box.slots[i] !== -1);
  const slow = fillers.length ? fillers.reduce((a, i) => a + i.w, 0) / fillers.length : 0;
  return [dev <= batch.tolerance ? 1 : 0, -reused, -famRepeats, batch.close !== undefined && dev <= batch.close ? 1 : 0, slow];
}

function better(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function perfect(box: Box, ctx: Ctx): boolean {
  const { state, batch } = ctx;
  return (
    Math.abs(box.total - batch.target) <= (batch.close ?? batch.tolerance) &&
    !box.items.some((i) => (state.uses.get(i.pid) ?? 0) > 0 || (state.famUses.get(i.family) ?? 0) > 0)
  );
}

/** Families already in this recipe's sets: a product line goes into one set per recipe. */
function blockedOf(plan: RecipePlan): Set<string> {
  return new Set(plan.boxes.flatMap((b) => b.items.map((i) => i.family)));
}

function heroCandidates(plan: RecipePlan, state: State, blocked: Set<string>): Item[] {
  const seen = new Set(plan.boxes.map((b) => b.heroItem?.micro));
  return (plan.heroPool?.items ?? [])
    .filter((h) => !(state.rules.hero.distinct && state.usedHeroes.has(h.pid)) && state.canUse(h, state.rules.stock.allocate ? ANY : null, blocked))
    .sort((a, b) => Number(seen.has(a.micro)) - Number(seen.has(b.micro)) || b.weekly - a.weekly);
}

/** For two-filler recipes: does some free pair complete this hero on target (and in a bag)? */
function hasFill(ctx: Ctx, plan: RecipePlan, hero: Item, blocked: Set<string>): boolean {
  if (plan.pools.length !== 2) return true;
  const box = new Box(null, ctx.rules, plan);
  box.add(hero, -1);
  const free = (p: Pool) => p.items.filter((a) => ctx.state.canUse(a, null, blocked) && box.fits(a));
  const firsts = free(plan.pools[0]);
  const seconds = free(plan.pools[1]);
  for (const a of firsts) {
    const rest = ctx.batch.target - hero.price - a.price;
    if (seconds.some((b) => Math.abs(rest - b.price) <= ctx.batch.tolerance && b.pid !== a.pid && box.fits(b, a))) return true;
  }
  return false;
}

function siteOptions(ctx: Ctx, hero: Item | null): Array<string | null> {
  const { rules, state } = ctx;
  if (!rules.stock.allocate) return [null];
  if (!rules.stock.oneSitePerSet) return [ANY];
  const sites = rules.stock.sites.filter((s) => !hero || state.unitsLeft(hero.pid, s) >= 1);
  // preferred site (central warehouse) first, then the site holding most of the hero
  return sites.sort((a, b) => Number(a !== rules.stock.preferSite) - Number(b !== rules.stock.preferSite) || (hero ? state.unitsLeft(hero.pid, b) - state.unitsLeft(hero.pid, a) : 0));
}

function buildBox(ctx: Ctx, plan: RecipePlan): Box | null {
  const { rules, batch } = ctx;
  const s = rules.search;
  const blocked = blockedOf(plan);
  if (plan.pools.some((p) => !p.items.length)) return null;
  const loFill = plan.pools.reduce((a, p) => a + Math.min(...p.items.map((i) => i.price)), 0);
  const hiFill = plan.pools.reduce((a, p) => a + Math.max(...p.items.map((i) => i.price)), 0);
  const heroes: Array<Item | null> = plan.heroPool
    ? heroCandidates(plan, ctx.state, blocked).filter((h) => h.price + loFill <= batch.target + batch.tolerance && h.price + hiFill >= batch.target - batch.tolerance && hasFill(ctx, plan, h, blocked))
    : [null];
  let best: Box | null = null;
  let bestScore: Score | null = null;
  let productive = 0;
  for (const hero of heroes.slice(0, s.maxHeroesTried)) {
    if (productive >= s.heroesTried) break;
    let anyFound = false;
    for (const site of siteOptions(ctx, hero)) {
      const found: Box[] = [];
      let perfects = 0;
      for (let n = 0; n < s.attempts; n++) {
        const box = tryBox(ctx, plan, hero, site, blocked);
        if (!box) continue;
        found.push(box);
        if (perfect(box, ctx) && ++perfects >= s.enoughPerfect) break;
      }
      if (!found.length) continue;
      anyFound = true;
      for (const b of found) {
        const sc = score(b, ctx);
        if (!bestScore || better(sc, bestScore)) {
          best = b;
          bestScore = sc;
        }
      }
      if (best && perfect(best, ctx)) return best;
    }
    if (anyFound) productive++;
  }
  return best;
}

/** How many hero + filler combinations land on target (two-filler recipes; a rough count otherwise). */
export function combos(plan: RecipePlan, rules: Rules, state?: State): number {
  const blocked = blockedOf(plan);
  const free = (items: Item[]) => (state ? items.filter((i) => state.canUse(i, null, blocked)) : items);
  const heroes = plan.heroPool ? free(plan.heroPool.items) : [];
  const pools = plan.pools.map((p) => free(p.items));
  if (!plan.heroPool) return pools.length ? Math.min(...pools.map((p) => p.length)) : 0;
  if (pools.length !== 2) return (pools.length ? Math.min(...pools.map((p) => p.length)) : 1) * heroes.length;
  const tol = plan.batch.tolerance;
  let n = 0;
  for (const h of heroes)
    for (const a of pools[0]) {
      const rest = plan.batch.target - h.price - a.price;
      for (const b of pools[1]) {
        if (Math.abs(rest - b.price) <= tol && a.family !== b.family && (!rules.packaging.enabled || bagFor([h.dims, a.dims, b.dims], rules.packaging))) n++;
        if (n > 1e6) return n;
      }
    }
  return n;
}

export class Stuck extends Error {
  constructor(public batchKey: string, public recipeKey: string, public recipeName: string, public k: number) {
    super(`could not build set ${k} of recipe ${recipeKey} (${recipeName}) in batch ${batchKey}`);
  }
}

export type BuildOutput = { seed: number; plans: RecipePlan[]; boxes: Box[]; stats: Record<string, PoolStats> };

function buildOnce(batches: Batch[], items: Item[], rules: Rules, seed: number): BuildOutput {
  const rng = new Rng(seed);
  const state = new State(rules, items);
  const allPlans: RecipePlan[] = [];
  const stats: Record<string, PoolStats> = {};
  for (const batch of batches) {
    const { plans, stats: st } = makePlans(batch, items, rules);
    stats[batch.key] = st;
    allPlans.push(...plans);
    const ctx: Ctx = { rng, state, rules, batch };
    for (const p of plans) {
      if (p.heroPool && p.heroPool.items.length < (rules.hero.distinct ? p.recipe.boxes : 1)) throw new Stuck(batch.key, p.recipe.key, p.recipe.name, 1);
    }
    const maxK = Math.max(...batch.recipes.map((r) => r.boxes));
    // set 1 of every recipe, then set 2, …; each round starts with the recipe that has fewest workable combinations left
    for (let k = 1; k <= maxK; k++) {
      const order = plans.filter((p) => k <= p.recipe.boxes).sort((a, b) => combos(a, rules, state) - combos(b, rules, state));
      for (const plan of order) {
        const box = buildBox(ctx, plan);
        if (!box) throw new Stuck(batch.key, plan.recipe.key, plan.recipe.name, k);
        box.k = k;
        state.take(box);
        plan.boxes.push(box);
      }
    }
  }
  const boxes = allPlans.flatMap((p) => [...p.boxes].sort((a, b) => a.k - b.k));
  return { seed, plans: allPlans, boxes, stats };
}

/** The whole project with the first seed that fills every set. */
export function buildAll(batches: Batch[], items: Item[], rules: Rules): BuildOutput {
  let last: Stuck | null = null;
  for (let seed = rules.search.seed; seed < rules.search.seed + rules.search.seedTries; seed++) {
    try {
      return buildOnce(batches, items, rules, seed);
    } catch (e) {
      if (!(e instanceof Stuck)) throw e;
      last = e;
    }
  }
  throw last ?? new Error("build failed");
}

// --- Allocation and output ---------------------------------------------------------------------
/** One unit of every item per set from the set's site (any chosen site when not one-site); fullest bin first. */
export function allocate(boxes: Box[], bins: Bin[], rules: Rules): Map<Box, Array<{ site: string; bin: string; locationId: number }>> {
  const left = new Map(bins.map((b) => [`${b.pid}|${b.locationId}`, b.qty]));
  const byPid = new Map<number, Bin[]>();
  for (const b of bins) if (rules.stock.sites.includes(b.site)) byPid.set(b.pid, [...(byPid.get(b.pid) ?? []), b]);
  const out = new Map<Box, Array<{ site: string; bin: string; locationId: number }>>();
  for (const box of boxes) {
    const picks = box.items.map((it) => {
      const locs = (byPid.get(it.pid) ?? []).filter((l) => (box.site === ANY || box.site === null || l.site === box.site) && (left.get(`${l.pid}|${l.locationId}`) ?? 0) >= 1);
      if (!locs.length) throw new Error(`No stock left for ${it.code} at ${box.site}`);
      const loc = locs.reduce((m, l) => {
        const lq = left.get(`${l.pid}|${l.locationId}`)!;
        const mq = left.get(`${m.pid}|${m.locationId}`)!;
        return lq > mq || (lq === mq && l.bin > m.bin) ? l : m;
      });
      left.set(`${loc.pid}|${loc.locationId}`, left.get(`${loc.pid}|${loc.locationId}`)! - 1);
      return { site: loc.site, bin: loc.bin, locationId: loc.locationId };
    });
    out.set(box, picks);
  }
  return out;
}

/** Set codes run on through the recipes of a batch, within each code group: RB199-01…, TG-K01…, TG-Y01… */
export function setCode(batch: Batch, recipe: Recipe, k: number): string {
  const groupOf = (r: Recipe) => (r.codeGroup && r.codeGroup !== batch.prefix ? r.codeGroup : "");
  const group = groupOf(recipe);
  const before = batch.recipes.slice(0, batch.recipes.indexOf(recipe)).filter((r) => groupOf(r) === group);
  const n = before.reduce((a, r) => a + r.boxes, 0) + k;
  return `${batch.prefix}-${group}${String(n).padStart(2, "0")}`;
}

export function toBuiltSets(out: BuildOutput, alloc: Map<Box, Array<{ site: string; bin: string; locationId: number }>> | null): BuiltSet[] {
  return out.boxes.map((box) => {
    const plan = box.plan;
    const picks = alloc?.get(box);
    const items: SetItem[] = box.items.map((it, i) => {
      const s = box.slots[i];
      return {
        role: s === -1 ? "hero" : "filler",
        slot: s,
        slotLabel: s === -1 ? plan.recipe.hero!.label : plan.recipe.slots[s].label,
        pid: it.pid,
        tmpl: it.tmpl,
        code: it.code,
        barcode: it.barcode,
        name: it.name,
        brand: it.brand,
        categ: it.categ,
        price: it.price,
        landed: it.landed,
        weekly: it.weekly,
        cover: it.cover,
        units: it.avail,
        dims: it.dims,
        site: picks?.[i].site,
        bin: picks?.[i].bin,
        locationId: picks?.[i].locationId,
      };
    });
    const sites = picks ? [...new Set(picks.map((p) => p.site))] : [];
    return {
      code: setCode(plan.batch, plan.recipe, box.k),
      batch: plan.batch.key,
      recipeKey: plan.recipe.key,
      recipe: plan.recipe.name,
      k: box.k,
      site: sites.length === 1 ? sites[0] : sites.length ? sites.join("+") : null,
      total: box.total,
      bag: box.bag,
      items,
    };
  });
}
