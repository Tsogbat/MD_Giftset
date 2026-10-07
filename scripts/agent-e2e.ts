// End-to-end agent check without the UI: brief → questions → (recommended answers) → proposal → build.
//   npx tsx scripts/agent-e2e.ts "Mystery box 99,000₮ × 6 for teenagers"
import { prisma } from "../src/lib/db";
import { createProject } from "../src/lib/projects";
import { lockProject, runAgentTurn, type TurnResult } from "../src/lib/agent/turn";

const description = process.argv[2] ?? "Mystery box for teenagers, 99,000₮, 6 boxes";
const user = "e2e-test";
const project = await createProject({ name: `E2E ${new Date().toISOString().slice(0, 16)}`, priceRange: "99,000₮", count: "6", description }, user);
console.log(`project #${project.id} ${project.slug}`);

async function turn(input: Parameters<typeof runAgentTurn>[2]): Promise<TurnResult> {
  await lockProject(project.id, user);
  const t0 = Date.now();
  await runAgentTurn(project.id, user, input);
  const last = await prisma.turn.findFirstOrThrow({ where: { projectId: project.id, role: "agent" }, orderBy: { seq: "desc" } });
  const events = (last.events as Array<{ type: string; name?: string }> | null) ?? [];
  console.log(`\n=== agent turn (${((Date.now() - t0) / 1000).toFixed(0)}s, tools: ${events.filter((e) => e.type === "tool").map((e) => e.name?.replace("mcp__giftset__", "")).join(", ")})`);
  const out = last.payload as unknown as TurnResult;
  console.log(`[${last.kind}] ${out.message}`);
  for (const a of out.assumptions ?? []) console.log(`  assume: ${a}`);
  for (const q of out.questions ?? []) console.log(`  ${q.id} (${q.type}) ${q.text}\n     ${(q.options ?? []).map((o) => `${o.recommended ? "*" : ""}${o.label}`).join(" | ")}`);
  if (last.kind === "error") process.exit(1);
  return out;
}

let out = await turn({ kind: "brief" });
for (let round = 0; out.kind === "questions" && round < 3; round++) {
  const answers = (out.questions ?? []).map((q) => {
    const rec = q.options?.find((o) => o.recommended) ?? q.options?.[0];
    return { id: q.id, question: q.text, value: q.type === "multi" ? (q.options ?? []).filter((o) => o.recommended).map((o) => o.label) : (rec?.label ?? "Use your recommendation") };
  });
  out = await turn({ kind: "answers", answers });
}
if (out.kind === "proposal") out = await turn({ kind: "approve" });
const v = await prisma.version.findFirst({ where: { projectId: project.id }, orderBy: { number: "desc" }, include: { sets: true } });
console.log(`\nresult: ${out.kind}; latest version ${v ? `V${v.number} with ${v.sets.length} sets` : "none"}`);
await prisma.$disconnect();
