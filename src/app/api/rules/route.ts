// Rule memory: what the user taught once, applied to every future project.
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/user";

export async function GET() {
  return Response.json(await prisma.memoryRule.findMany({ orderBy: { id: "asc" } }));
}

export async function POST(req: Request) {
  const b = (await req.json()) as { title?: string; text?: string };
  if (!b.title?.trim() || !b.text?.trim()) return Response.json({ error: "Title and text are required." }, { status: 400 });
  const r = await prisma.memoryRule.create({ data: { title: b.title.trim(), text: b.text.trim(), createdBy: await currentUser() } });
  return Response.json(r, { status: 201 });
}
