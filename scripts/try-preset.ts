// Build one of the proven presets against the latest snapshot and print the checks.
//   npx tsx scripts/try-preset.ts redBox | tsagaanGar
import { prisma } from "../src/lib/db";
import { latestSnapshot } from "../src/lib/snapshot";
import { PRESETS } from "../src/lib/engine/presets";
import { loadInputs, runBuild } from "../src/lib/engine/run";
import type { Plan } from "../src/lib/engine/types";

const name = (process.argv[2] ?? "redBox") as keyof typeof PRESETS;
const p = PRESETS[name];
const plan: Plan = { rules: p.rules(), batches: p.batches() };
const snap = await latestSnapshot();
if (!snap) throw new Error("no snapshot");
let t = Date.now();
const inputs = await loadInputs(plan, snap.id, null, (m) => console.log(" ", m));
console.log(`${p.title}: ${inputs.items.length} eligible items (${((Date.now() - t) / 1000).toFixed(1)}s)`);
t = Date.now();
const r = runBuild(plan, inputs);
console.log(`build ${((Date.now() - t) / 1000).toFixed(1)}s`);
for (const rec of r.diagnostics.recipes) if (!rec.feasible) console.log("  diag", rec.key, rec.name, rec.problems.join(" | "));
if (!r.ok) {
  console.log("FAILED:", r.error);
} else {
  console.log(`seed ${r.seed}, ${r.sets.length} sets`);
  for (const s of r.sets.slice(0, 3)) console.log(`  ${s.code} ${s.recipe} ${s.site ?? ""} ${s.total}₮ ${s.bag ?? ""} :: ${s.items.map((i) => `${i.role === "hero" ? "★" : ""}${i.name.slice(0, 22)} ${i.price}`).join(" | ")}`);
  for (const c of r.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.name} — ${c.detail}`);
}
await prisma.$disconnect();
