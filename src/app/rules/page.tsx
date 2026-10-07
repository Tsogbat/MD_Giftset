import { prisma } from "@/lib/db";
import RulesEditor from "./rules-editor";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await prisma.memoryRule.findMany({ orderBy: { id: "asc" } });
  return (
    <div className="card" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Rules the agent remembers</h1>
      <p className="muted">
        The agent applies these in every new project without asking again. It adds a rule here only after you say yes. Switch one off to stop using it.
      </p>
      <RulesEditor initial={rules.map((r) => ({ id: r.id, title: r.title, text: r.text, enabled: r.enabled, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() }))} />
    </div>
  );
}
