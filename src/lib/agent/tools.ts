// What the agent can do, as plain functions (the MCP server wraps them; the UI can call them too).
// Read-only towards Odoo; writes only to this app's database.
import sharp from "sharp";
import { prisma } from "../db";
import { ensurePhotos, photoPath } from "../catalog";
import { latestSnapshot } from "../snapshot";
import { PRESETS, giftBundleRules } from "../engine/presets";
import { loadInputs, diagnose, runBuild } from "../engine/run";
import { quantile } from "../engine/solver";
import { matches } from "../engine/solver";
import type { Plan, Rules } from "../engine/types";
import { finance, getPlan, getVersion, savePlan, saveVersion, checksOf, type Brief } from "../projects";

export type ToolCtx = { projectId: number; user: string };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const json = (v: unknown) => JSON.stringify(v, null, 1);

async function snapshotId(ctx: ToolCtx): Promise<number> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
  if (p.snapshotId) return p.snapshotId;
  const s = await latestSnapshot();
  if (!s) throw new Error("No Odoo snapshot yet. Ask the user to press 'Refresh from Odoo' on the Catalog page.");
  await prisma.project.update({ where: { id: ctx.projectId }, data: { snapshotId: s.id } });
  return s.id;
}

/** Items with the project's rules (or neutral ones before a plan exists); no bag sizes needed. */
async function browseItems(ctx: ToolCtx) {
  const plan = await getPlan(ctx.projectId);
  const rules: Rules = plan?.rules ?? giftBundleRules();
  const browsePlan: Plan = { rules: { ...rules, packaging: { ...rules.packaging, enabled: false } }, batches: plan?.batches ?? [] };
  return { rules, inputs: await loadInputs(browsePlan, await snapshotId(ctx), ctx.projectId) };
}

export async function getProject(ctx: ToolCtx): Promise<string> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId }, include: { answers: { orderBy: { id: "asc" } }, versions: { orderBy: { number: "asc" } }, uploads: true, snapshot: true } });
  const plan = await getPlan(ctx.projectId);
  return json({
    name: p.name,
    status: p.status,
    brief: p.brief as unknown as Brief,
    answers: p.answers.map((a) => ({ question: a.question, answer: a.value, by: a.author })),
    snapshot: p.snapshot ? { id: p.snapshot.id, takenAt: p.snapshot.takenAt, sales: `${p.snapshot.salesFrom?.toISOString().slice(0, 10)} → ${p.snapshot.salesTo?.toISOString().slice(0, 10)}`, products: p.snapshot.products } : null,
    plan,
    versions: p.versions.map((v) => ({ number: v.number, label: v.label, createdBy: v.createdBy, createdAt: v.createdAt, committed: v.committed, failedChecks: checksOf(v).filter((c) => !c.ok).map((c) => c.name) })),
    uploads: p.uploads.map((u) => ({ kind: u.kind, filename: u.filename })),
  });
}

export function listPresets(): string {
  return json(
    Object.entries(PRESETS).map(([key, p]) => {
      const r = p.rules();
      return {
        key,
        title: p.title,
        kind: r.kind,
        batches: p.batches().map((b) => ({ label: b.label, target: b.target, tolerance: b.tolerance, sets: b.recipes.reduce((a, x) => a + x.boxes, 0), recipes: b.recipes.map((x) => `${x.key} ${x.name} ×${x.boxes}: hero ${x.hero?.label ?? "none"} + ${x.slots.length} slots`) })),
        keyRules: { hero: r.hero, filler: r.filler, reuse: r.reuse, stock: r.stock, packaging: r.packaging.enabled, mix: r.mix },
      };
    }),
  );
}

export async function ruleMemory(): Promise<string> {
  const rules = await prisma.memoryRule.findMany({ where: { enabled: true }, orderBy: { id: "asc" } });
  return json(rules.map((r) => ({ id: r.id, title: r.title, text: r.text, rule: r.rule, by: r.createdBy })));
}

export async function rememberRule(ctx: ToolCtx, input: { title: string; text: string; rule?: unknown }): Promise<string> {
  const r = await prisma.memoryRule.create({ data: { title: input.title, text: input.text, rule: (input.rule ?? undefined) as never, createdBy: ctx.user, sourceProjectId: ctx.projectId } });
  return `Saved rule #${r.id} "${r.title}" for future projects.`;
}

export async function catalogStats(ctx: ToolCtx, input: { prefix?: string; depth?: number; priceMin?: number; priceMax?: number; site?: string }): Promise<string> {
  const { inputs, rules } = await browseItems(ctx);
  const depth = input.depth ?? Math.min(5, (input.prefix?.split(" / ").length ?? 0) + 1);
  const items = inputs.items.filter((i) => (!input.prefix || matches(i.categ, [input.prefix])) && (input.priceMin === undefined || i.price >= input.priceMin) && (input.priceMax === undefined || i.price <= input.priceMax) && (!input.site || (i.units[input.site] ?? 0) > 0));
  const sellers = inputs.items.filter((i) => i.weekly > 0).map((i) => i.weekly);
  const heroCut = quantile(sellers, 1 - rules.hero.topShare);
  const coverCut = quantile(inputs.items.map((i) => i.cover), 0.5);
  const groups = new Map<string, typeof items>();
  for (const i of items) {
    const key = i.categ.split(" / ").slice(0, depth).join(" / ");
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const rows = [...groups]
    .map(([category, g]) => {
      const prices = g.map((i) => i.price);
      return {
        category,
        skus: g.length,
        bestSellers: g.filter((i) => i.weekly >= heroCut && i.weekly > 0).length,
        slowMovers: g.filter((i) => i.cover >= coverCut && !i.newArrival).length,
        price: `${money(quantile(prices, 0.1))} / ${money(quantile(prices, 0.5))} / ${money(quantile(prices, 0.9))}`,
        units: Object.fromEntries(rules.stock.sites.map((s) => [s, Math.round(g.reduce((a, i) => a + (i.units[s] ?? 0), 0))])),
      };
    })
    .sort((a, b) => b.skus - a.skus)
    .slice(0, 80);
  return [
    `Eligible products with stock (after the project's exclusions): ${items.length}${input.prefix ? ` under "${input.prefix}"` : ""}. Best seller = weekly sales ≥ ${heroCut.toFixed(2)} (top ${Math.round(rules.hero.topShare * 100)}%); slow mover = weeks of cover ≥ ${coverCut.toFixed(1)} (median).`,
    "price = p10 / median / p90 ₮. Category paths are exact MIS paths — use them (or a prefix of them) as recipe slot kinds.",
    json(rows),
  ].join("\n");
}

export async function searchProducts(ctx: ToolCtx, input: { query?: string; categoryPrefix?: string; brand?: string; priceMin?: number; priceMax?: number; site?: string; sort?: "sales" | "cover" | "price"; limit?: number }): Promise<string> {
  const { inputs } = await browseItems(ctx);
  const q = input.query?.toLowerCase();
  const rows = inputs.items
    .filter(
      (i) =>
        (!q || i.name.toLowerCase().includes(q) || i.code.includes(q) || (i.barcode ?? "").includes(q)) &&
        (!input.categoryPrefix || matches(i.categ, [input.categoryPrefix])) &&
        (!input.brand || (i.brand ?? "").toLowerCase().includes(input.brand.toLowerCase())) &&
        (input.priceMin === undefined || i.price >= input.priceMin) &&
        (input.priceMax === undefined || i.price <= input.priceMax) &&
        (!input.site || (i.units[input.site] ?? 0) > 0),
    )
    .sort((a, b) => (input.sort === "cover" ? b.cover - a.cover : input.sort === "price" ? b.price - a.price : b.weekly - a.weekly))
    .slice(0, Math.min(input.limit ?? 30, 100));
  return json(rows.map((i) => ({ code: i.code, name: i.name, brand: i.brand, categ: i.categ, price: i.price, landed: i.landed && Math.round(i.landed), weeklySales: +i.weekly.toFixed(2), weeksCover: +i.cover.toFixed(1), units: i.units, newArrival: i.newArrival })));
}

export async function savePlanTool(ctx: ToolCtx, input: { preset?: keyof typeof PRESETS; rulesPatch?: unknown; batches?: unknown }): Promise<string> {
  const preset = input.preset ? PRESETS[input.preset] : undefined;
  const r = await savePlan(ctx.projectId, { rulesPatch: input.rulesPatch, batches: input.batches ?? (preset && !(await getPlan(ctx.projectId)) ? preset.batches() : undefined), baseRules: preset?.rules });
  if (!r.ok) return `NOT saved — fix these and call save_plan again:\n- ${r.errors.join("\n- ")}`;
  const sets = r.plan.batches.reduce((a, b) => a + b.recipes.reduce((x, y) => x + y.boxes, 0), 0);
  return `Saved: ${r.plan.batches.length} batch(es), ${r.plan.batches.reduce((a, b) => a + b.recipes.length, 0)} recipes, ${sets} sets. Kind: ${r.plan.rules.kind}. Run check_pools next.`;
}

export async function checkPools(ctx: ToolCtx): Promise<string> {
  const plan = await getPlan(ctx.projectId);
  if (!plan) return "No plan saved yet — call save_plan first.";
  const inputs = await loadInputs(plan, await snapshotId(ctx), ctx.projectId);
  const d = diagnose(plan, inputs.items);
  const lines = [`Eligible items: ${inputs.items.length}${plan.rules.packaging.enabled ? ` (bag check on; ${inputs.items.filter((i) => !i.dims).length} have no catalog size and can't be used)` : ""}`];
  for (const [k, s] of Object.entries(d.stats)) lines.push(`Batch ${k}: hero base ${s.heroBase}, filler base ${s.fillerBase}, best-seller cuts ${json(s.cuts)}, slow-mover cover cut ${s.coverCut.toFixed(1)} weeks`);
  for (const r of d.recipes) {
    lines.push(`\n${r.batch}/${r.key} ${r.name} ×${r.boxes} — ${r.feasible ? "OK" : "PROBLEMS"}; combinations ${r.combos}`);
    if (r.hero) lines.push(`  hero ${r.hero.label} ${money(r.hero.band[0])}–${money(r.hero.band[1])}: ${r.hero.pool} candidates${r.hero.perSite ? ` ${json(r.hero.perSite)}` : ""}`);
    for (const s of r.slots) lines.push(`  ${s.label} ${money(s.band[0])}–${money(s.band[1])}: ${s.pool}${s.perSite ? ` ${json(s.perSite)}` : ""}, median ${s.median ?? "—"}`);
    for (const p of r.problems) lines.push(`  ! ${p}`);
  }
  return lines.join("\n");
}

export async function buildSets(ctx: ToolCtx, input: { label?: string }): Promise<string> {
  const plan = await getPlan(ctx.projectId);
  if (!plan) return "No plan saved yet — call save_plan first.";
  await prisma.project.update({ where: { id: ctx.projectId }, data: { status: "building" } });
  const inputs = await loadInputs(plan, await snapshotId(ctx), ctx.projectId);
  const r = runBuild(plan, inputs);
  if (!r.ok) {
    await prisma.project.update({ where: { id: ctx.projectId }, data: { status: "proposal" } });
    const probs = r.diagnostics.recipes.filter((x) => !x.feasible).map((x) => `${x.batch}/${x.key}: ${x.problems.join("; ")}`);
    return `BUILD FAILED: ${r.error}\n${r.stuck ? `Stuck at set ${r.stuck.k} of ${r.stuck.recipe} (${r.stuck.name}). Widen that recipe's bands/kinds, lower its set count, or relax a rule, then build again.\n` : ""}${probs.length ? `Pool problems:\n- ${probs.join("\n- ")}` : ""}`;
  }
  const v = await saveVersion(ctx.projectId, plan, r, ctx.user, input.label);
  const fin = finance(plan, r.sets);
  const failed = r.checks.filter((c) => !c.ok);
  const perRecipe = new Map<string, number[]>();
  for (const s of r.sets) perRecipe.set(`${s.batch}/${s.recipeKey} ${s.recipe}`, [...(perRecipe.get(`${s.batch}/${s.recipeKey} ${s.recipe}`) ?? []), s.total]);
  return [
    `Saved as V${v.number}: ${r.sets.length} sets (seed ${r.seed}).`,
    failed.length ? `FAILED CHECKS:\n- ${failed.map((c) => `${c.name}: ${c.detail}`).join("\n- ")}` : `All ${r.checks.length} checks passed.`,
    "Values per recipe: " + [...perRecipe].map(([k, t]) => `${k}: ${money(Math.min(...t))}–${money(Math.max(...t))}₮`).join("; "),
    `Margin (VAT 10% removed, landed cost): ${fin.rows.map((x) => `${x.label} ${(x.margin * 100).toFixed(1)}%`).join(", ")}; total ${(fin.total.margin * 100).toFixed(1)}%.`,
    "Now call inspect_sets (with photos) to review what went in.",
  ].join("\n");
}

/** One contact-sheet image per set: item photos left→right in set order (hero first). */
async function contactSheet(codes: string[]): Promise<string | null> {
  const tile = 150;
  const cols = Math.min(6, codes.length);
  const rows = Math.ceil(codes.length / cols);
  const tiles = await Promise.all(
    codes.map(async (code, i) => {
      const f = photoPath(code);
      const img = f ? await sharp(f).resize(tile - 6, tile - 6, { fit: "contain", background: "#ffffff" }).toBuffer() : await sharp({ create: { width: tile - 6, height: tile - 6, channels: 3, background: "#eeeeee" } }).png().toBuffer();
      return { input: img, left: (i % cols) * tile + 3, top: Math.floor(i / cols) * tile + 3 };
    }),
  );
  const buf = await sharp({ create: { width: cols * tile, height: rows * tile, channels: 3, background: "#ffffff" } }).composite(tiles).jpeg({ quality: 70 }).toBuffer();
  return buf.toString("base64");
}

export async function inspectSets(ctx: ToolCtx, input: { version?: number; codes?: string[]; recipe?: string; photos?: boolean; limit?: number }): Promise<Content[]> {
  const v = await getVersion(ctx.projectId, input.version);
  if (!v) return [{ type: "text", text: "No version built yet." }];
  let sets = v.sets;
  if (input.codes?.length) sets = sets.filter((s) => input.codes!.includes(s.code));
  if (input.recipe) sets = sets.filter((s) => s.recipeKey === input.recipe || s.recipe === input.recipe);
  const limit = Math.min(input.limit ?? (input.photos ? 10 : 60), input.photos ? 16 : 200);
  sets = sets.slice(0, limit);
  const out: Content[] = [{ type: "text", text: `V${v.number}: showing ${sets.length} of ${v.sets.length} sets.` }];
  if (input.photos) await ensurePhotos(sets.flatMap((s) => s.items.map((i) => ({ code: i.code }))));
  for (const s of sets) {
    const lines = [`${s.code} · ${s.recipe} · ${s.site ?? ""} · ${money(s.total)}₮${s.bag ? ` · bag ${s.bag}` : ""}`];
    for (const i of s.items) lines.push(`  ${i.role === "hero" ? "★" : "-"} ${i.code} ${i.name} | ${i.brand ?? ""} | ${i.categ} | ${money(i.price)}₮${input.photos && !photoPath(i.code) ? " | (no photo)" : ""}`);
    out.push({ type: "text", text: lines.join("\n") });
    if (input.photos) {
      const img = await contactSheet(s.items.map((i) => i.code));
      if (img) out.push({ type: "image", data: img, mimeType: "image/jpeg" });
    }
  }
  return out;
}

export async function financeTool(ctx: ToolCtx, input: { version?: number }): Promise<string> {
  const v = await getVersion(ctx.projectId, input.version);
  if (!v) return "No version built yet.";
  return json(v.finance);
}
