// Make a project from a preset without the agent (for checking exports):
//   npx tsx scripts/demo-project.ts redBox|tsagaanGar
import { prisma } from "../src/lib/db";
import { createProject, saveVersion } from "../src/lib/projects";
import { PRESETS } from "../src/lib/engine/presets";
import { loadInputs, runBuild } from "../src/lib/engine/run";
import type { Prisma } from "../src/generated/prisma/client";

const key = (process.argv[2] ?? "redBox") as keyof typeof PRESETS;
const p = PRESETS[key];
const plan = { rules: p.rules(), batches: p.batches() };
const project = await createProject({ name: `${p.title} — demo`, description: "Built straight from the preset (no agent) to check exports." }, "demo");
await prisma.project.update({ where: { id: project.id }, data: { rules: plan.rules as unknown as Prisma.InputJsonValue, recipes: plan.batches as unknown as Prisma.InputJsonValue } });
const inputs = await loadInputs(plan, project.snapshotId!, project.id);
const r = runBuild(plan, inputs);
if (!r.ok) throw new Error(r.error);
const v = await saveVersion(project.id, plan, r, "demo", "preset as-is");
console.log(`project #${project.id} V${v.number}: ${r.sets.length} sets, ${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks`);
await prisma.$disconnect();
