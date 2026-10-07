// Send the agent the user's answers, an approval or a chat message. The turn runs in the background;
// the workspace polls GET /api/projects/[id] for its progress.
import { lockProject, ProjectBusyError, runAgentTurn, type UserInput } from "@/lib/agent/turn";
import { currentUser } from "@/lib/user";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const input = (await req.json()) as UserInput;
  if (!["answers", "approve", "chat", "brief"].includes(input.kind)) return Response.json({ error: "bad input" }, { status: 400 });
  if (input.kind === "chat" && !input.text?.trim()) return Response.json({ error: "empty message" }, { status: 400 });
  const who = await currentUser();
  try {
    await lockProject(id, who);
  } catch (e) {
    if (e instanceof ProjectBusyError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
  void runAgentTurn(id, who, input);
  return Response.json({ ok: true }, { status: 202 });
}
