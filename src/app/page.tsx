import Link from "next/link";
import { prisma } from "@/lib/db";
import { claudeAuth } from "@/lib/ai/claude";
import { latestSnapshot } from "@/lib/snapshot";
import { whoIsOn } from "@/lib/presence";
import NewProject from "./new-project";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { brief: "Brief", interview: "Agent asking questions", proposal: "Proposal ready", building: "Building", built: "Sets built" };

export default async function Home() {
  const [projects, auth, snap] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { versions: true } } } }),
    claudeAuth(),
    latestSnapshot(),
  ]);
  return (
    <div className="home">
      <section className="card">
        <h1 style={{ marginTop: 0 }}>New gift set project</h1>
        <p className="muted">
          Give the basics. The agent then asks you questions, and builds the sets from your answers.
        </p>
        <NewProject />
        <p className="muted small" style={{ marginTop: 14 }}>
          Claude: {auth.loggedIn ? <span className="ok">ready ({auth.method})</span> : <span className="bad">not logged in on this PC</span>} · Odoo data:{" "}
          {snap ? `${snap.takenAt.toISOString().slice(0, 16).replace("T", " ")}, ${snap.products.toLocaleString()} products` : <span className="bad">no snapshot yet (Catalog → Refresh from Odoo)</span>}
        </p>
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Projects</h2>
        {projects.length === 0 ? <p className="muted">No projects yet.</p> : null}
        <table>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/projects/${p.id}`}>
                    <b>{p.name}</b>
                  </Link>
                  <div className="muted small">{(p.brief as { description?: string })?.description?.slice(0, 120)}</div>
                </td>
                <td className="small">
                  {p.lockedBy ? <span className="warn">● agent running for {p.lockedBy}</span> : STATUS[p.status] ?? p.status}
                  {whoIsOn(p.id).length ? <div className="muted">open: {whoIsOn(p.id).join(", ")}</div> : null}
                </td>
                <td className="small muted">{p._count.versions ? `${p._count.versions} version${p._count.versions > 1 ? "s" : ""}` : ""}</td>
                <td className="small muted">
                  {p.createdBy} · {p.updatedAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
