// One version with its sets and items (for the Sets / Checks / Finance tabs).
import { getVersion } from "@/lib/projects";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const v = await getVersion(Number(id), Number(n));
  if (!v) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(v);
}
