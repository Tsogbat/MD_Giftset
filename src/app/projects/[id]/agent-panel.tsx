"use client";
import { useEffect, useRef, useState } from "react";
import { describeTool, type ProjectData, type Question, type Turn, type TurnResult } from "./shared";

type Props = { data: ProjectData; projectId: number; me: string; reload: () => void; openVersion: (n: number) => void };

export default function AgentPanel({ data, projectId, reload, openVersion }: Props) {
  const [error, setError] = useState("");
  const [chat, setChat] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const running = !!data.project.lockedBy;
  const turns = data.turns;
  const lastAgent = [...turns].reverse().find((t) => t.role === "agent");

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastAgent?.events?.length]);

  async function send(body: unknown) {
    setError("");
    const r = await fetch(`/api/projects/${projectId}/turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setError((await r.json()).error ?? "Could not reach the agent");
    reload();
  }

  return (
    <div className="agent">
      <div className="turns">
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} isLast={t.id === lastAgent?.id} running={running} send={send} openVersion={openVersion} />
        ))}
        <div ref={bottom} />
      </div>
      {error ? <p className="bad small">{error}</p> : null}
      {data.project.uploads.length ? (
        <div className="uploads small">
          Files:{" "}
          {data.project.uploads.map((u) => (
            <span key={u.id} className="pill" title={`#${u.id} · ${u.kind} · ${u.createdBy}`}>
              {u.filename}
            </span>
          ))}
        </div>
      ) : null}
      <form
        className="chat"
        onSubmit={(e) => {
          e.preventDefault();
          if (!chat.trim()) return;
          send({ kind: "chat", text: chat.trim() });
          setChat("");
        }}
      >
        <textarea
          value={chat}
          onChange={(e) => setChat(e.target.value)}
          placeholder={running ? "The agent is working…" : "Tell the agent what to change, e.g. “no D.Tale”, “move 2 boxes to Figure Hunter”"}
          rows={2}
          disabled={running}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        <div className="chat-btns">
          <button className="primary" disabled={running || !chat.trim()}>
            Send
          </button>
          <label className={`btn small ${running ? "disabled" : ""}`} title="Attach an .xlsx: team-made sets to include as given, or a sample / bonus list">
            Attach
            <input
              type="file"
              accept=".xlsx"
              hidden
              disabled={running}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const fd = new FormData();
                fd.append("file", file);
                const r = await fetch(`/api/projects/${projectId}/uploads`, { method: "POST", body: fd });
                const j = await r.json();
                if (!r.ok) setError(j.error ?? "Upload failed");
                else setChat((c) => `${c ? c + "\n" : ""}I attached "${j.filename}" (upload #${j.id}): `);
                reload();
              }}
            />
          </label>
        </div>
      </form>
    </div>
  );
}

function TurnView({ turn, isLast, running, send, openVersion }: { turn: Turn; isLast: boolean; running: boolean; send: (b: unknown) => void; openVersion: (n: number) => void }) {
  const p = turn.payload as Record<string, unknown>;
  if (turn.role === "user") {
    if (turn.kind === "brief")
      return (
        <div className="bubble user">
          <div className="who">{turn.author} · brief</div>
          {(["priceRange", "count", "description", "notes"] as const).map((k) => (p[k] ? <div key={k}><span className="muted">{k === "priceRange" ? "Price" : k === "count" ? "Sets" : k === "description" ? "What" : "Notes"}:</span> {String(p[k])}</div> : null))}
          {p.autoBuild ? <div className="muted small">Build right after the answers</div> : null}
        </div>
      );
    if (turn.kind === "answers")
      return (
        <div className="bubble user">
          <div className="who">{turn.author} · answers</div>
          {(turn.payload as unknown as Array<{ id: string; question: string; value: unknown }>).map((a) => (
            <div key={a.id} className="small">
              <span className="muted">{a.question}</span>
              <br />→ <b>{Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}</b>
            </div>
          ))}
        </div>
      );
    return (
      <div className="bubble user">
        <div className="who">{turn.author}</div>
        {turn.kind === "approve" ? <b>Approved — build it{p.note ? `: ${p.note}` : ""}</b> : String(p.text ?? "")}
      </div>
    );
  }

  const events = turn.events ?? [];
  const tools = events.filter((e) => e.type === "tool");
  const out = p as unknown as TurnResult;
  return (
    <div className={`bubble agent ${turn.kind === "error" ? "error" : ""}`}>
      <div className="who">
        Agent{turn.durationMs ? <span className="muted"> · {Math.round(turn.durationMs / 1000)}s</span> : null}
      </div>
      {turn.kind === "running" ? (
        <div>
          <div className="spinner">Working…</div>
          <ul className="events">
            {tools.slice(-8).map((e, i) => (
              <li key={i}>{describeTool(e)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{String(p.message ?? "")}</p>
          {out.assumptions?.length ? (
            <details className="small">
              <summary className="muted">Assumptions ({out.assumptions.length})</summary>
              <ul>
                {out.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {out.warnings?.length ? (
            <ul className="small warn">
              {out.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {tools.length ? (
            <details className="small">
              <summary className="muted">{tools.length} steps</summary>
              <ul className="events">
                {tools.map((e, i) => (
                  <li key={i}>{describeTool(e)}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {turn.kind === "questions" && out.questions?.length ? <Questions questions={out.questions} active={isLast && !running} send={send} /> : null}
          {turn.kind === "proposal" && isLast && !running ? (
            <div className="actions">
              <button className="primary" onClick={() => send({ kind: "approve" })}>
                Approve &amp; build
              </button>
              <span className="muted small">or type changes below (see the Recipes tab)</span>
            </div>
          ) : null}
          {turn.kind === "built" && out.versionNumber ? (
            <button onClick={() => openVersion(out.versionNumber!)}>Open V{out.versionNumber}</button>
          ) : null}
          {turn.kind === "error" && isLast && !running ? (
            <button onClick={() => send({ kind: "chat", text: "Please continue where you stopped." })}>Try again</button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Questions({ questions, active, send }: { questions: Question[]; active: boolean; send: (b: unknown) => void }) {
  const init = () =>
    Object.fromEntries(
      questions.map((q) => {
        const rec = q.options?.filter((o) => o.recommended).map((o) => o.label) ?? [];
        return [q.id, { picked: q.type === "multi" ? rec : rec.slice(0, 1), other: "", text: "" }];
      }),
    ) as Record<string, { picked: string[]; other: string; text: string }>;
  const [state, setState] = useState(init);
  const set = (id: string, v: Partial<{ picked: string[]; other: string; text: string }>) => setState((s) => ({ ...s, [id]: { ...s[id], ...v } }));

  function submit() {
    const answers = questions.map((q) => {
      const s = state[q.id];
      let value: unknown;
      if (q.type === "number" || q.type === "text" || !q.options?.length) value = s.text || s.other;
      else {
        const picked = s.picked.filter((x) => x !== "__other");
        const other = s.picked.includes("__other") && s.other.trim() ? [`Other: ${s.other.trim()}`] : [];
        value = q.type === "multi" ? [...picked, ...other] : (other[0] ?? picked[0] ?? "");
      }
      return { id: q.id, question: q.text, value };
    });
    send({ kind: "answers", answers });
  }

  return (
    <div className={`questions ${active ? "" : "done"}`}>
      {questions.map((q) => {
        const s = state[q.id];
        return (
          <fieldset key={q.id} disabled={!active}>
            <legend>{q.text}</legend>
            {q.why ? <div className="muted small">{q.why}</div> : null}
            {q.options?.length && (q.type === "single" || q.type === "multi") ? (
              <>
                {q.options.map((o) => (
                  <label key={o.label} className="opt">
                    <input
                      type={q.type === "multi" ? "checkbox" : "radio"}
                      name={q.id}
                      checked={s.picked.includes(o.label)}
                      onChange={(e) => set(q.id, { picked: q.type === "multi" ? (e.target.checked ? [...s.picked, o.label] : s.picked.filter((x) => x !== o.label)) : [o.label] })}
                    />
                    <span>
                      {o.label}
                      {o.recommended ? <span className="rec">recommended</span> : null}
                      {o.description ? <span className="muted small"> — {o.description}</span> : null}
                    </span>
                  </label>
                ))}
                {q.allowOther !== false ? (
                  <label className="opt">
                    <input
                      type={q.type === "multi" ? "checkbox" : "radio"}
                      name={q.id}
                      checked={s.picked.includes("__other")}
                      onChange={(e) => set(q.id, { picked: q.type === "multi" ? (e.target.checked ? [...s.picked, "__other"] : s.picked.filter((x) => x !== "__other")) : ["__other"] })}
                    />
                    <input className="other" placeholder="Other…" value={s.other} onFocus={() => !s.picked.includes("__other") && set(q.id, { picked: q.type === "multi" ? [...s.picked, "__other"] : ["__other"] })} onChange={(e) => set(q.id, { other: e.target.value })} />
                  </label>
                ) : null}
              </>
            ) : q.type === "number" ? (
              <input type="number" value={s.text} onChange={(e) => set(q.id, { text: e.target.value })} />
            ) : (
              <textarea rows={2} value={s.text} onChange={(e) => set(q.id, { text: e.target.value })} />
            )}
          </fieldset>
        );
      })}
      {active ? (
        <button className="primary" onClick={submit}>
          Send answers
        </button>
      ) : null}
    </div>
  );
}
