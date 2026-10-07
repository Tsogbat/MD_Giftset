// POST {sid}: the workspace checks in every 15 s and learns who else has the project open. DELETE ?sid=: leaving.
import { checkIn, leave, whoIsOn } from "@/lib/presence";
import { currentUser } from "@/lib/user";

const validSid = (s: unknown): s is string => typeof s === "string" && /^[\w-]{6,64}$/.test(s);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const { sid } = (await req.json().catch(() => ({}))) as { sid?: unknown };
  if (!validSid(sid)) return Response.json({ error: "Give sid" }, { status: 400 });
  const me = await currentUser();
  checkIn(id, sid, me);
  return Response.json({ others: whoIsOn(id, me) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const sid = new URL(req.url).searchParams.get("sid");
  if (validSid(sid)) leave(id, sid);
  return new Response(null, { status: 204 });
}
