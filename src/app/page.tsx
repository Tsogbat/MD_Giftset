import { claudeAuth } from "@/lib/ai/claude";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await claudeAuth();
  return (
    <div className="card">
      <h1>Gift Set Studio</h1>
      <p className="muted">M0 scaffold. Projects, the agent panel and the solver arrive in the next milestones.</p>
      <p>
        Claude: {auth.loggedIn ? <span className="ok">logged in via {auth.via} ({auth.method})</span> : <span className="bad">not logged in</span>}
      </p>
    </div>
  );
}
