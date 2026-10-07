"use client";
import { useState } from "react";
import type { VersionDetail } from "./shared";

const FORMATS = [
  { f: "xlsx", title: "Excel", text: "All sets, recipes, items with photos, pick list by bin, checks, finance and rules — in Mongolian." },
  { f: "pdf", title: "PDF (A4 print layout)", text: "Cover, contents, method, recipes, every set with photos, finance, checks and the pick list." },
  { f: "html", title: "HTML report", text: "One self-contained page to share: filters, search, hover a photo to zoom." },
] as const;

export default function ExportTab({ projectId, version }: { projectId: number; version: VersionDetail | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  if (!version) return <p className="muted">Nothing built yet.</p>;
  async function go(f: string) {
    setBusy(f);
    setMsg("");
    const url = `/api/projects/${projectId}/versions/${version!.number}/export?format=${f}`;
    const r = await fetch(url);
    if (!r.ok) {
      setMsg((await r.json()).error ?? "Export failed");
      setBusy(null);
      return;
    }
    const saved = decodeURIComponent(r.headers.get("X-Saved-To") ?? "");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = saved.split(/[\\/]/).pop() ?? `export.${f}`;
    if (f === "xlsx") a.click();
    else window.open(a.href, "_blank");
    setMsg(`Saved on the server PC: ${saved}`);
    setBusy(null);
  }
  return (
    <div>
      <p className="muted">
        Files for <b>V{version.number}</b> are written to their own folder (<code>exports\…\V{version.number}</code>), so earlier versions stay as they were.
      </p>
      <div className="exports">
        {FORMATS.map((x) => (
          <div key={x.f} className="card">
            <h3 style={{ marginTop: 0 }}>{x.title}</h3>
            <p className="muted small">{x.text}</p>
            <button className="primary" disabled={!!busy} onClick={() => go(x.f)}>
              {busy === x.f ? "Making…" : `Download ${x.f.toUpperCase()}`}
            </button>
          </div>
        ))}
      </div>
      <p className="small">{msg}</p>
    </div>
  );
}
