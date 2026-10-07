import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/user";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();
  return <Workspace projectId={id} me={await currentUser()} />;
}
