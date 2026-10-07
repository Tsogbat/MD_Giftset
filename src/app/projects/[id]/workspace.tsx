"use client";
import { useCallback, useEffect, useState } from "react";
import AgentPanel from "./agent-panel";
import { ChecksTab, FinanceTab, RecipesTab, SetsTab, VersionsTab } from "./tabs";
import ExportTab from "./export-tab";
import type { ProjectData, VersionDetail } from "./shared";

const TABS = ["Sets", "Recipes", "Checks", "Finance", "Versions", "Export"] as const;
type Tab = (typeof TABS)[number];

export default function Workspace({ projectId, me }: { projectId: number; me: string }) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [tab, setTab] = useState<Tab>("Sets");
  const [versionNo, setVersionNo] = useState<number | null>(null);
  const [version, setVersion] = useState<VersionDetail | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [projectId]);

  const running = !!data?.project.lockedBy;
  useEffect(() => {
    load();
    const t = setInterval(load, running ? 1500 : 8000);
    return () => clearInterval(t);
  }, [load, running]);

  // who else has this project open (office network)
  const [others, setOthers] = useState<string[]>([]);
  useEffect(() => {
    const sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); // not randomUUID: LAN pages are plain http
    let stop = false;
    const ping = async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid }) });
        if (r.ok && !stop) setOthers((await r.json()).others);
      } catch {
        /* offline for a moment */
      }
    };
    ping();
    const t = setInterval(ping, 15_000);
    const leave = () => void fetch(`/api/projects/${projectId}/presence?sid=${sid}`, { method: "DELETE", keepalive: true }).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [projectId]);

  const latest = data?.versions[0]?.number ?? null;
  const shown = versionNo ?? latest;
  useEffect(() => {
    if (!shown) {
      setVersion(null);
      return;
    }
    if (version?.number === shown) return;
    fetch(`/api/projects/${projectId}/versions/${shown}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setVersion);
  }, [projectId, shown, version?.number]);

  // a newly built version appears: follow it unless the user picked an older one
  useEffect(() => {
    if (latest && versionNo === null) setTab((t) => t);
  }, [latest, versionNo]);

  if (!data) return <p className="muted">Loading…</p>;
  const p = data.project;
  return (
    <div className="ws">
      <aside className="ws-agent card">
        <div className="ws-head">
          <h1>{p.name}</h1>
          {p.lockedBy ? <span className="pill warn">● agent working{p.lockedBy !== me ? ` for ${p.lockedBy}` : ""}</span> : null}
        </div>
        {others.length ? <p className="small muted presence">Also open: {others.join(", ")}</p> : null}
        <AgentPanel data={data} projectId={projectId} me={me} reload={load} openVersion={(n) => { setVersionNo(n); setTab("Sets"); }} />
      </aside>
      <section className="ws-main card">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "tab on" : "tab"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {data.versions.length ? (
            <select value={shown ?? ""} onChange={(e) => setVersionNo(Number(e.target.value))} title="Version shown in Sets / Checks / Finance / Export">
              {data.versions.map((v) => (
                <option key={v.number} value={v.number}>
                  V{v.number}
                  {v.label ? ` — ${v.label}` : ""}
                  {v.committed ? " (stock reserved)" : ""}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {tab === "Sets" ? <SetsTab version={version} /> : null}
        {tab === "Recipes" ? <RecipesTab plan={data.plan} projectId={projectId} reload={load} locked={running} /> : null}
        {tab === "Checks" ? <ChecksTab version={version} /> : null}
        {tab === "Finance" ? <FinanceTab version={version} /> : null}
        {tab === "Versions" ? <VersionsTab data={data} projectId={projectId} reload={load} open={(n) => { setVersionNo(n); setTab("Sets"); }} /> : null}
        {tab === "Export" ? <ExportTab projectId={projectId} version={version} /> : null}
      </section>
    </div>
  );
}
