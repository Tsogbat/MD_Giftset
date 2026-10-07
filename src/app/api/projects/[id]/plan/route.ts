// Manual edits from the Recipes tab (same validation as the agent's save_plan).
import { savePlan } from "@/lib/projects";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const b = (await req.json()) as { rulesPatch?: unknown; batches?: unknown };
  const r = await savePlan(id, b);
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
