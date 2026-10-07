// Everything the workspace shows, polled while an agent turn runs.
import { prisma } from "@/lib/db";
import { getPlan } from "@/lib/projects";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const project = await prisma.project.findUnique({ where: { id }, include: { snapshot: true, uploads: { select: { id: true, filename: true, kind: true, createdBy: true }, orderBy: { id: "asc" } } } });
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  const [turns, versions, plan] = await Promise.all([
    prisma.turn.findMany({ where: { projectId: id }, orderBy: { seq: "asc" } }),
    prisma.version.findMany({
      where: { projectId: id },
      orderBy: { number: "desc" },
      select: { id: true, number: true, label: true, createdBy: true, createdAt: true, committed: true, checks: true, finance: true, seed: true, _count: { select: { sets: true } } },
    }),
    getPlan(id),
  ]);
  return Response.json({ project, turns, versions, plan });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const b = (await req.json()) as { name?: string };
  if (b.name?.trim()) await prisma.project.update({ where: { id }, data: { name: b.name.trim() } });
  return Response.json({ ok: true });
}
