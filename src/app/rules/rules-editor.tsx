"use client";
import { useState } from "react";

type Rule = { id: number; title: string; text: string; enabled: boolean; createdBy: string; createdAt: string };

export default function RulesEditor({ initial }: { initial: Rule[] }) {
  const [rules, setRules] = useState(initial);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  async function toggle(r: Rule) {
    const res = await fetch(`/api/rules/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !r.enabled }) });
    if (res.ok) setRules((all) => all.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)));
  }
  async function remove(r: Rule) {
    const res = await fetch(`/api/rules/${r.id}`, { method: "DELETE" });
    if (res.ok) setRules((all) => all.filter((x) => x.id !== r.id));
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, text }) });
    if (res.ok) {
      const r = await res.json();
      setRules((all) => [...all, { ...r, createdAt: r.createdAt }]);
      setTitle("");
      setText("");
    }
  }

  return (
    <div>
      <table>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
              <td style={{ width: 230 }}>
                <b>{r.title}</b>
                <div className="muted small">
                  {r.createdBy} · {r.createdAt.slice(0, 10)}
                </div>
              </td>
              <td>{r.text}</td>
              <td className="actions" style={{ justifyContent: "flex-end" }}>
                <button onClick={() => toggle(r)}>{r.enabled ? "Switch off" : "Switch on"}</button>
                <button onClick={() => remove(r)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={add} className="brief" style={{ marginTop: 16 }}>
        <b>Add a rule</b>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title, e.g. No erasers in kids bundles" required />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="The rule in plain words" required />
        <button className="primary" style={{ justifySelf: "start" }}>
          Add
        </button>
      </form>
    </div>
  );
}
