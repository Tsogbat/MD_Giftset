// Bring an older version's plan back as the current plan. Its sets stay in that version; nothing is deleted.
import { prisma } from "@/lib/db";
import { getVersion } from "@/lib/projects";
import type { Prisma } from "@/generated/prisma/client";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const v = await getVersion(Number(id), Number(n));
  if (!v) return Response.json({ error: "not found" }, { status: 404 });
  await prisma.project.update({ where: { id: Number(id) }, data: { rules: v.rules as Prisma.InputJsonValue, recipes: v.recipes as Prisma.InputJsonValue } });
  return Response.json({ ok: true });
}
