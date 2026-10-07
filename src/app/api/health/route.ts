import { claudeAuth } from "@/lib/ai/claude";
import { prisma } from "@/lib/db";

export async function GET() {
  const [auth, projects] = await Promise.all([claudeAuth(), prisma.project.count()]);
  return Response.json({ ok: true, claude: auth, projects });
}
