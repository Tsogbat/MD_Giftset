// POST: reserve this version's units in the ledger so other projects cannot promise them. DELETE: release.
import { releaseReservation, reserveVersion } from "@/lib/projects";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  try {
    const units = await reserveVersion(Number(id), Number(n));
    return Response.json({ ok: true, units });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  await releaseReservation(Number((await ctx.params).id));
  return Response.json({ ok: true });
}
