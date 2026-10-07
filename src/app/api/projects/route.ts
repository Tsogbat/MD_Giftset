// GET: all projects. POST: create one from a brief and start the agent's first turn (its questions).
import { prisma } from "@/lib/db";
import { createProject, type Brief } from "@/lib/projects";
import { lockProject, runAgentTurn } from "@/lib/agent/turn";
import { currentUser } from "@/lib/user";

export async function GET() {
  const list = await prisma.project.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { versions: true } } } });
  return Response.json(list);
}

export async function POST(req: Request) {
  const b = (await req.json()) as Partial<Brief> & { start?: boolean };
  if (!b.name?.trim() || !b.description?.trim()) return Response.json({ error: "Name and description are required." }, { status: 400 });
  const who = await currentUser();
  const brief: Brief = {
    name: b.name.trim(),
    priceRange: b.priceRange?.trim() || undefined,
    count: b.count?.trim() || undefined,
    description: b.description.trim(),
    notes: b.notes?.trim() || undefined,
    autoBuild: !!b.autoBuild,
  };
  const project = await createProject(brief, who);
  // start=false: the page uploads the attached files first, then starts the first turn itself
  if (b.start !== false) {
    await lockProject(project.id, who);
    void runAgentTurn(project.id, who, { kind: "brief" });
  }
  return Response.json({ id: project.id, slug: project.slug }, { status: 201 });
}
