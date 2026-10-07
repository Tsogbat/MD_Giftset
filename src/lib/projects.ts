// Projects, plans and versions. The agent's tools and the web UI both go through here.
import { prisma } from "./db";
import { latestSnapshot } from "./snapshot";
import { giftBundleRules } from "./engine/presets";
import { PlanSchema, RulesSchema, BatchSchema, type Batch, type BuiltSet, type Check, type Plan, type Rules } from "./engine/types";
import type { BuildResult } from "./engine/run";
import type { Prisma } from "@/generated/prisma/client";

export type Brief = {
  name: string;
  priceRange?: string;
  count?: string;
  description: string;
  notes?: string;
  autoBuild?: boolean;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9а-яөүё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";

export async function createProject(brief: Brief, createdBy: string) {
  const snap = await latestSnapshot();
  let slug = slugify(brief.name);
  for (let i = 2; await prisma.project.findUnique({ where: { slug } }); i++) slug = `${slugify(brief.name)}-${i}`;
  const project = await prisma.project.create({ data: { slug, name: brief.name, brief: brief as unknown as Prisma.InputJsonValue, createdBy, snapshotId: snap?.id ?? null, status: "interview" } });
  await addTurn(project.id, "user", createdBy, "brief", brief);
  return project;
}

export async function addTurn(projectId: number, role: string, author: string, kind: string, payload: unknown, extra: { events?: unknown; durationMs?: number } = {}) {
  const last = await prisma.turn.findFirst({ where: { projectId }, orderBy: { seq: "desc" } });
  return prisma.turn.create({
    data: {
      projectId,
      seq: (last?.seq ?? 0) + 1,
      role,
      author,
      kind,
      payload: payload as Prisma.InputJsonValue,
      events: extra.events as Prisma.InputJsonValue | undefined,
      durationMs: extra.durationMs,
    },
  });
}

/** The plan saved on the project, or null before the agent wrote one. */
export async function getPlan(projectId: number): Promise<Plan | null> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!p.rules || !p.recipes) return null;
  const parsed = PlanSchema.safeParse({ rules: p.rules, batches: p.recipes });
  return parsed.success ? parsed.data : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep merge for rule patches: objects merge, arrays and values replace. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = v === null ? undefined : deepMerge((base as Record<string, unknown>)[k], v);
  return out as T;
}

export type SavePlanInput = { rulesPatch?: unknown; batches?: unknown; baseRules?: () => Rules };

/** Validate and store rules (patched onto the current or a base rule set) and batches. */
export async function savePlan(projectId: number, input: SavePlanInput): Promise<{ ok: true; plan: Plan } | { ok: false; errors: string[] }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const currentRules = project.rules && RulesSchema.safeParse(project.rules).success ? (project.rules as unknown as Rules) : null;
  const base = input.baseRules ? input.baseRules() : currentRules ?? giftBundleRules();
  const rules = RulesSchema.safeParse(deepMerge(base, input.rulesPatch ?? {}));
  const batchesRaw = input.batches ?? project.recipes;
  const batches = BatchSchema.array().min(1).safeParse(batchesRaw);
  const errors: string[] = [];
  if (!rules.success) errors.push(...rules.error.issues.map((i) => `rules.${i.path.join(".")}: ${i.message}`));
  if (!batchesRaw) errors.push("batches: none saved yet — send batches");
  else if (!batches.success) errors.push(...batches.error.issues.map((i) => `batches.${i.path.join(".")}: ${i.message}`));
  if (rules.success) {
    for (const p of [...rules.data.exclusions.categ, ...rules.data.exclusions.name, ...rules.data.exclusions.brand, ...rules.data.segmentExcludes]) {
      try {
        new RegExp(p.pattern, "i");
      } catch (e) {
        errors.push(`bad regex ${p.pattern}: ${(e as Error).message}`);
      }
    }
  }
  if (batches.success) {
    const keys = new Set<string>();
    for (const b of batches.data) {
      if (keys.has(b.key)) errors.push(`batch key ${b.key} used twice`);
      keys.add(b.key);
      const rk = new Set<string>();
      for (const r of b.recipes) {
        if (rk.has(r.key)) errors.push(`recipe key ${r.key} used twice in batch ${b.key}`);
        rk.add(r.key);
        for (const s of [...(r.hero ? [r.hero] : []), ...r.slots]) if (s.band[0] > s.band[1]) errors.push(`${b.key}/${r.key}/${s.label}: band low > high`);
      }
    }
  }
  if (errors.length || !rules.success || !batches.success) return { ok: false, errors };
  const plan: Plan = { rules: rules.data, batches: batches.data };
  await prisma.project.update({ where: { id: projectId }, data: { rules: plan.rules as unknown as Prisma.InputJsonValue, recipes: plan.batches as unknown as Prisma.InputJsonValue, status: project.status === "interview" ? "proposal" : project.status } });
  return { ok: true, plan };
}

// --- Finance (redbox_finance.py: VAT 10% is in the price; margin = gross / net) ----------------
export type FinanceRow = { batch: string; label: string; sets: number; revenue: number; vat: number; net: number; contentsValue: number; landed: number; gross: number; margin: number; missingCost: number };

export function finance(plan: Plan, sets: BuiltSet[]): { rows: FinanceRow[]; total: FinanceRow } {
  const rows = plan.batches.map((b: Batch) => {
    const ss = sets.filter((s) => s.batch === b.key);
    const revenue = ss.reduce((a, s) => a + (b.sellPrice ?? s.total), 0);
    const net = revenue / 1.1;
    const landed = ss.reduce((a, s) => a + s.items.reduce((x, i) => x + (i.landed ?? 0), 0), 0);
    const missingCost = ss.reduce((a, s) => a + s.items.filter((i) => i.landed == null).length, 0);
    return { batch: b.key, label: b.label, sets: ss.length, revenue, vat: revenue - net, net, contentsValue: ss.reduce((a, s) => a + s.total, 0), landed, gross: net - landed, margin: net ? (net - landed) / net : 0, missingCost };
  });
  const sum = (k: keyof FinanceRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const net = sum("net");
  const total = { batch: "all", label: "Total", sets: sum("sets"), revenue: sum("revenue"), vat: sum("vat"), net, contentsValue: sum("contentsValue"), landed: sum("landed"), gross: sum("gross"), margin: net ? sum("gross") / net : 0, missingCost: sum("missingCost") };
  return { rows, total };
}

// --- Versions -----------------------------------------------------------------------------------
export async function saveVersion(projectId: number, plan: Plan, result: Extract<BuildResult, { ok: true }>, createdBy: string, label?: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const last = await prisma.version.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
  const fin = finance(plan, result.sets);
  const version = await prisma.version.create({
    data: {
      projectId,
      number: (last?.number ?? 0) + 1,
      label: label ?? null,
      createdBy,
      snapshotId: project.snapshotId,
      rules: plan.rules as unknown as Prisma.InputJsonValue,
      recipes: plan.batches as unknown as Prisma.InputJsonValue,
      checks: result.checks as unknown as Prisma.InputJsonValue,
      finance: fin as unknown as Prisma.InputJsonValue,
      diagnostics: { stats: result.stats, recipes: result.diagnostics.recipes } as unknown as Prisma.InputJsonValue,
      seed: result.seed,
    },
  });
  for (const [position, s] of result.sets.entries()) {
    const batch = plan.batches.find((b) => b.key === s.batch);
    await prisma.giftSet.create({
      data: {
        versionId: version.id,
        position,
        code: s.code,
        tier: batch?.label ?? s.batch,
        recipeKey: s.recipeKey,
        recipe: s.recipe,
        site: s.site,
        total: s.total,
        bag: s.bag,
        source: "built",
        items: {
          create: s.items.map((i, n) => ({
            position: n,
            role: i.role,
            slot: i.slotLabel,
            code: i.code,
            barcode: i.barcode,
            productId: i.pid,
            name: i.name,
            brand: i.brand,
            categ: i.categ,
            price: i.price,
            landedCost: i.landed,
            site: i.site ?? null,
            bin: i.bin ?? null,
            weekly: i.weekly,
            cover: i.cover,
            dims: i.dims ? i.dims.join("×") : null,
          })),
        },
      },
    });
  }
  await prisma.project.update({ where: { id: projectId }, data: { status: "built" } });
  return version;
}

export type VersionSet = Prisma.GiftSetGetPayload<{ include: { items: true } }>;

export async function getVersion(projectId: number, number?: number) {
  const where = number ? { projectId_number: { projectId, number } } : undefined;
  const v = where ? await prisma.version.findUnique({ where, include: { sets: { include: { items: true }, orderBy: { position: "asc" } } } }) : await prisma.version.findFirst({ where: { projectId }, orderBy: { number: "desc" }, include: { sets: { include: { items: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } } } });
  return v;
}

export function checksOf(v: { checks: unknown }): Check[] {
  return (v.checks as Check[] | null) ?? [];
}

/** Reserve the units of a version in the ledger (replaces this project's earlier reservation). */
export async function reserveVersion(projectId: number, number: number) {
  const v = await getVersion(projectId, number);
  if (!v) throw new Error(`V${number} not found`);
  const rows = v.sets.flatMap((s) => s.items.filter((i) => i.site && i.bin && i.productId).map((i) => ({ projectId, versionId: v.id, code: i.code, productId: i.productId!, site: i.site!, bin: i.bin!, qty: i.qty })));
  if (!rows.length) throw new Error("This version has no bin allocation (stock reservation is off in its rules)");
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({ where: { projectId } }),
    prisma.ledgerEntry.createMany({ data: rows }),
    prisma.version.updateMany({ where: { projectId }, data: { committed: false } }),
    prisma.version.update({ where: { id: v.id }, data: { committed: true } }),
  ]);
  return rows.length;
}

export async function releaseReservation(projectId: number) {
  await prisma.$transaction([prisma.ledgerEntry.deleteMany({ where: { projectId } }), prisma.version.updateMany({ where: { projectId }, data: { committed: false } })]);
}
