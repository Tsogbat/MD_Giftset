// POST multipart (file, kind?): keep an uploaded workbook with the project for the agent to read.
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/uploads";
import { currentUser } from "@/lib/user";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const list = await prisma.upload.findMany({ where: { projectId: id }, orderBy: { id: "asc" }, select: { id: true, filename: true, kind: true, createdBy: true, createdAt: true } });
  return Response.json(list);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return Response.json({ error: "Only .xlsx workbooks can be read" }, { status: 400 });
  if (file.size > 30 * 1024 * 1024) return Response.json({ error: "File is larger than 30 MB" }, { status: 400 });
  const up = await saveUpload(id, String(form.get("kind") ?? "other"), file.name, Buffer.from(await file.arrayBuffer()), await currentUser());
  return Response.json({ id: up.id, filename: up.filename }, { status: 201 });
}
