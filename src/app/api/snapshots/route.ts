// GET: snapshots, newest first. POST: take a new one from Odoo (runs in the background).
import { prisma } from "@/lib/db";
import { takeSnapshot } from "@/lib/snapshot";
import { currentUser } from "@/lib/user";

export async function GET() {
  const list = await prisma.snapshot.findMany({ orderBy: { id: "desc" }, take: 20 });
  return Response.json(list);
}

export async function POST() {
  const running = await prisma.snapshot.findFirst({ where: { status: "running", takenAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (running) return Response.json({ id: running.id, status: "running" });
  const who = await currentUser();
  void takeSnapshot(who).catch(() => undefined);
  return Response.json({ status: "started" }, { status: 202 });
}
