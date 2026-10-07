import { prisma } from "@/lib/db";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const b = (await req.json()) as { enabled?: boolean; title?: string; text?: string };
  const r = await prisma.memoryRule.update({ where: { id }, data: { enabled: b.enabled, title: b.title, text: b.text } });
  return Response.json(r);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await prisma.memoryRule.delete({ where: { id: Number((await ctx.params).id) } });
  return Response.json({ ok: true });
}
