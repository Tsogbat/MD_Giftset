"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProject() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        priceRange: f.get("priceRange"),
        count: f.get("count"),
        description: f.get("description"),
        notes: f.get("notes"),
        autoBuild: f.get("autoBuild") === "on",
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setError(j.error ?? "Could not create the project");
      setBusy(false);
      return;
    }
    router.push(`/projects/${j.id}`);
  }
  return (
    <form className="brief" onSubmit={submit}>
      <label>
        Project name
        <input name="name" required placeholder="e.g. Red Box New Year 2027" />
      </label>
      <div className="row2">
        <label>
          Price range / tiers
          <input name="priceRange" placeholder="e.g. 199k, 299k  or  20–25K" />
        </label>
        <label>
          How many sets
          <input name="count" placeholder="e.g. 40 / 15  or  50" />
        </label>
      </div>
      <label>
        What is it?
        <textarea name="description" required rows={3} placeholder="e.g. Mystery box like Korea's — contents worth more than the price. Or: Tsagaan gar gifts for kids and young adults." />
      </label>
      <label>
        Notes (optional)
        <textarea name="notes" rows={2} placeholder="Anything the agent should know: team sets to include, things to avoid, deadline…" />
      </label>
      <label className="check">
        <input type="checkbox" name="autoBuild" /> Build right after my answers (skip the proposal step)
      </label>
      {error ? <p className="bad">{error}</p> : null}
      <button className="primary" disabled={busy}>
        {busy ? "Starting the agent…" : "Start — the agent will ask questions"}
      </button>
    </form>
  );
}
