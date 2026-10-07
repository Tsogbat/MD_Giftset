// Deterministic check of uploads → team sets as given → rebuild → bonus balancing, on the Red Box files.
//   npx tsx scripts/team-bonus-check.ts <projectId>
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { saveUpload } from "../src/lib/uploads";
import { importTeamSets } from "../src/lib/team";
import { importBonusPool, classifyBonus, applyBonus } from "../src/lib/bonus";
import { getPlan, saveVersion } from "../src/lib/projects";
import { loadInputs, runBuild } from "../src/lib/engine/run";

const projectId = Number(process.argv[2]);
const docs = path.resolve(process.env.USERPROFILE ?? "", "Documents", "Redbox");
const team = await saveUpload(projectId, "team_sets", "Red Box_299k_499K.xlsx", fs.readFileSync(path.join(docs, "Red Box_299k_499K.xlsx")), "check");
for (const [sheet, tier, prefix, price] of [["299K", "Red Box 299k", "RB299", 299_000], ["499K", "Red Box 499k", "RB499", 499_000]] as const) {
  const t = sheet === "299K" ? team : await saveUpload(projectId, "team_sets", "Red Box_299k_499K.xlsx", fs.readFileSync(path.join(docs, "Red Box_299k_499K.xlsx")), "check");
  const r = await importTeamSets({ uploadId: t.id, sheet, headerRow: 3, setColumn: "Box", codeColumn: "Дотоод сурвалж", nameColumn: "Нэр", priceColumn: "Борлуулах Үнэ", totalColumn: "Total Price", qtyColumn: " тоо хэмжээ", tier, prefix, sellPrice: price });
  console.log(r.summary);
}

const plan = (await getPlan(projectId))!;
const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
const r = runBuild(plan, await loadInputs(plan, project.snapshotId!, projectId));
if (!r.ok) throw new Error(r.error);
const v = await saveVersion(projectId, plan, r, "check", "with team 299k/499k");
const full = await prisma.version.findUniqueOrThrow({ where: { id: v.id }, include: { sets: true } });
console.log(`V${v.number}: ${full.sets.filter((s) => s.source === "built").length} built + ${full.sets.filter((s) => s.source === "team").length} team sets`);
for (const c of (full.checks as Array<{ name: string; ok: boolean; detail: string }>).filter((c) => c.name.startsWith("Team"))) console.log(`  ${c.ok ? "PASS" : "INFO"} ${c.name} — ${c.detail}`);
console.log("  finance:", (full.finance as { rows: Array<{ label: string; margin: number }> }).rows.map((x) => `${x.label} ${(x.margin * 100).toFixed(1)}%`).join(", "));

const samples = await saveUpload(projectId, "bonus_pool", "sample_baraanud_artbox_v2.xlsx", fs.readFileSync(path.join(docs, "sample_baraanud_artbox_v2.xlsx")), "check");
const pool = await importBonusPool({ uploadId: samples.id, sheet: "үйлдвэрлэхээ больсон", headerRow: 3, nameColumn: "Бүтээгдэхүүний нэр", qtyColumn: "Qty", valueColumn: "Үнэ (₩)", rate: 3.24, codeColumn: "Artbox code", barcodeColumn: "Bar code", expiryColumn: "Expiry date" });
console.log(pool.summary);
// crude labels for the check (the agent does this properly): lips once per set, the user's V3 exclusions
await classifyBonus(
  samples.id,
  pool.pool.items.map((i) => ({ id: i.id, kind: /lip|уруул/i.test(i.name) ? "lip" : "other", family: i.name.split(" ").slice(0, 2).join(" ").toLowerCase(), exclude: /dog|нохой|kuromi|melody|grafen|graden|isoi/i.test(i.name) })),
);
const b = await applyBonus(projectId, samples.id, {
  version: v.number,
  bands: [
    { tier: "Red Box 199k", lo: 15_000, hi: 20_000 },
    { tier: "Red Box 299k", lo: 25_000, hi: 30_000 },
    { tier: "Red Box 499k", lo: 75_000, hi: 80_000, minItems: 3 },
  ],
  maxPerKind: { lip: 1 },
  createdBy: "check",
});
console.log(`bonus → V${b.version}:`, b.report.join(" | "));
await prisma.$disconnect();
