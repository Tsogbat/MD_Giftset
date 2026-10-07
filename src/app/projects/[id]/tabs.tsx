"use client";
import { useMemo, useState } from "react";
import { money, type Plan, type ProjectData, type VersionDetail } from "./shared";

const photo = (code: string) => `/media/photos/${code}.jpg`;

function NoVersion() {
  return <p className="muted">Nothing built yet. Answer the agent&apos;s questions and approve its proposal; the sets appear here.</p>;
}

export function SetsTab({ version }: { version: VersionDetail | null }) {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [recipe, setRecipe] = useState("");
  const [site, setSite] = useState("");
  const sets = useMemo(() => version?.sets ?? [], [version]);
  const tiers = [...new Set(sets.map((s) => s.tier ?? ""))].filter(Boolean);
  const recipes = [...new Set(sets.filter((s) => !tier || s.tier === tier).map((s) => s.recipe ?? ""))].filter(Boolean);
  const sites = [...new Set(sets.map((s) => s.site ?? ""))].filter(Boolean);
  const term = q.trim().toLowerCase();
  const shown = sets.filter(
    (s) =>
      (!tier || s.tier === tier) &&
      (!recipe || s.recipe === recipe) &&
      (!site || s.site === site) &&
      (!term || s.code.toLowerCase().includes(term) || s.items.some((i) => i.code.includes(term) || i.name.toLowerCase().includes(term))),
  );
  if (!version) return <NoVersion />;
  const failed = (version.checks ?? []).filter((c) => !c.ok);
  return (
    <div>
      <div className="filters">
        <input placeholder="Search set code, SKU code or product name" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <Chips label="Tier" values={tiers} value={tier} set={(v) => { setTier(v); setRecipe(""); }} />
        <Chips label="Recipe" values={recipes} value={recipe} set={setRecipe} />
        <Chips label="Site" values={sites} value={site} set={setSite} />
      </div>
      <p className="muted small">
        V{version.number}: {shown.length} of {sets.length} sets ·{" "}
        {failed.length ? <span className="bad">{failed.length} failed checks</span> : <span className="ok">all {(version.checks ?? []).length} checks passed</span>}
      </p>
      <div className="sets">
        {shown.map((s) => (
          <article key={s.id} className="set">
            <header>
              <b>{s.code}</b> <span className="muted">{s.recipe}</span>
              <span style={{ flex: 1 }} />
              {s.site ? <span className="pill">{s.site}</span> : null}
              {s.bag ? <span className="pill">bag {s.bag}</span> : null}
              <b>{money(s.total)}₮</b>
            </header>
            <ul>
              {s.items.map((i) => (
                <li key={i.id} className={i.role === "hero" ? "hero" : ""}>
                  <img className="ph" src={photo(i.code)} alt="" width={40} height={40} tabIndex={0} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  <span className="nm">
                    {i.role === "hero" ? "★ " : ""}
                    {i.name}
                    <span className="muted small">
                      {" "}
                      · {i.code}
                      {i.bin ? ` · ${i.bin}` : ""}
                    </span>
                  </span>
                  <span className="num">{money(i.price)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

function Chips({ label, values, value, set }: { label: string; values: string[]; value: string; set: (v: string) => void }) {
  if (values.length < 2) return null;
  return (
    <span className="chips" title={label}>
      <button className={!value ? "chip on" : "chip"} onClick={() => set("")}>
        All {label.toLowerCase()}s
      </button>
      {values.map((v) => (
        <button key={v} className={v === value ? "chip on" : "chip"} onClick={() => set(v)}>
          {v}
        </button>
      ))}
    </span>
  );
}

export function RecipesTab({ plan, projectId, reload, locked }: { plan: Plan | null; projectId: number; reload: () => void; locked: boolean }) {
  const [draft, setDraft] = useState<Plan["batches"] | null>(null);
  const [rulesText, setRulesText] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  if (!plan) return <p className="muted">The agent writes the recipes after your answers.</p>;
  const batches = draft ?? plan.batches;
  const edit = (bi: number, ri: number, f: (r: Plan["batches"][number]["recipes"][number]) => void) => {
    const next = structuredClone(batches);
    f(next[bi].recipes[ri]);
    setDraft(next);
  };
  async function save() {
    setMsg("");
    let rulesPatch: unknown;
    if (rulesText !== null) {
      try {
        rulesPatch = JSON.parse(rulesText);
      } catch {
        setMsg("Rules JSON is not valid.");
        return;
      }
    }
    const r = await fetch(`/api/projects/${projectId}/plan`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batches, rulesPatch }) });
    const j = await r.json();
    if (!r.ok) setMsg(`Not saved: ${(j.errors ?? []).join("; ")}`);
    else {
      setDraft(null);
      setRulesText(null);
      setMsg("Saved. Ask the agent to build (e.g. “build with my edits”).");
      reload();
    }
  }
  const r = plan.rules;
  return (
    <div>
      <div className="rules-summary">
        <b>{r.kind}</b>
        <div className="small muted">
          Hero: {r.hero.enabled ? `top ${Math.round(r.hero.topShare * 100)}% sellers${r.hero.minUnits ? `, ≥ ${r.hero.minUnits} units` : ""}` : "none"} · Fillers:{" "}
          {r.filler.coverQuantile ? "slow movers (cover ≥ median)" : "any"}
          {r.filler.minUnits ? `, ≥ ${r.filler.minUnits} units` : ""} · SKU in ≤ {r.reuse.maxUsesPerSku} set(s)
          {r.reuse.maxShared !== undefined ? ` · two sets share ≤ ${r.reuse.maxShared}` : ""} · Sites {r.stock.sites.join("/")}
          {r.stock.oneSitePerSet ? ", one site per set" : ""}
          {r.stock.allocate ? ", stock reserved" : ""}
          {r.packaging.enabled ? ` · bag fit (${r.packaging.bags.map((b) => `${b.w}×${b.h}`).join(", ")})` : ""}
        </div>
        <div className="small muted">
          Excluded: {[...r.exclusions.topCategories, ...r.exclusions.categ.map((x) => x.label), ...r.exclusions.name.map((x) => x.label), ...r.exclusions.brand.map((x) => x.label), ...r.exclusions.codes.map((c) => `${c.code} (${c.reason})`)].join("; ")}
        </div>
      </div>
      {batches.map((b, bi) => (
        <div key={b.key} className="batch">
          <h3>
            {b.label} — {money(b.target)}₮ ± {money(b.tolerance)}
            {b.sellPrice ? `, sold at ${money(b.sellPrice)}₮` : ""} · {b.recipes.reduce((a, x) => a + x.boxes, 0)} sets
          </h3>
          <table className="recipes">
            <thead>
              <tr>
                <th>Recipe</th>
                <th className="num">Sets</th>
                <th>Hero</th>
                <th>Fillers (kind · band ₮)</th>
              </tr>
            </thead>
            <tbody>
              {b.recipes.map((rc, ri) => (
                <tr key={rc.key}>
                  <td>
                    <b>{rc.key}</b> {rc.name}
                    {rc.nameMn ? <div className="muted small">{rc.nameMn}</div> : null}
                    {rc.segment ? <span className="pill">{rc.segment}</span> : null}
                  </td>
                  <td className="num">
                    <input type="number" min={1} value={rc.boxes} disabled={locked} onChange={(e) => edit(bi, ri, (x) => (x.boxes = Math.max(1, Number(e.target.value))))} style={{ width: 56 }} />
                  </td>
                  <td>{rc.hero ? <SlotCell slot={rc.hero} disabled={locked} onBand={(band) => edit(bi, ri, (x) => (x.hero!.band = band))} /> : <span className="muted">none</span>}</td>
                  <td>
                    {rc.slots.map((s, si) => (
                      <SlotCell key={si} slot={s} disabled={locked} onBand={(band) => edit(bi, ri, (x) => (x.slots[si].band = band))} />
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <details>
        <summary className="muted small">Edit rules as JSON (advanced)</summary>
        <textarea rows={14} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={rulesText ?? JSON.stringify(plan.rules, null, 2)} onChange={(e) => setRulesText(e.target.value)} disabled={locked} />
      </details>
      <div className="actions">
        <button className="primary" disabled={locked || (!draft && rulesText === null)} onClick={save}>
          Save edits
        </button>
        {draft || rulesText !== null ? (
          <button onClick={() => { setDraft(null); setRulesText(null); }}>Discard</button>
        ) : null}
        <span className="small">{msg}</span>
      </div>
    </div>
  );
}

function SlotCell({ slot, onBand, disabled }: { slot: Plan["batches"][number]["recipes"][number]["slots"][number]; onBand: (b: [number, number]) => void; disabled: boolean }) {
  return (
    <div className="slot">
      <span title={slot.kinds.join("\n")}>
        {slot.label}
        {slot.require ? <span className="pill">must match /{slot.require}/</span> : null}
      </span>
      <span className="band">
        <input type="number" step={100} value={slot.band[0]} disabled={disabled} onChange={(e) => onBand([Number(e.target.value), slot.band[1]])} />–
        <input type="number" step={100} value={slot.band[1]} disabled={disabled} onChange={(e) => onBand([slot.band[0], Number(e.target.value)])} />
      </span>
    </div>
  );
}

export function ChecksTab({ version }: { version: VersionDetail | null }) {
  if (!version) return <NoVersion />;
  return (
    <table>
      <tbody>
        {(version.checks ?? []).map((c, i) => (
          <tr key={i}>
            <td className={c.ok ? "ok" : "bad"} style={{ width: 70 }}>
              <b>{c.ok ? "PASS" : "FAIL"}</b>
            </td>
            <td>
              {c.name}
              <div className="muted small">{c.nameMn}</div>
            </td>
            <td className="small">{c.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FinanceTab({ version }: { version: VersionDetail | null }) {
  if (!version?.finance) return <NoVersion />;
  const rows = [...version.finance.rows, version.finance.total];
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Batch</th>
            <th className="num">Sets</th>
            <th className="num">Revenue ₮</th>
            <th className="num">VAT ₮</th>
            <th className="num">Net ₮</th>
            <th className="num">Contents value ₮</th>
            <th className="num">Landed cost ₮</th>
            <th className="num">Gross profit ₮</th>
            <th className="num">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.batch} style={r.batch === "all" ? { fontWeight: 600 } : undefined}>
              <td>{r.label}</td>
              <td className="num">{r.sets}</td>
              <td className="num">{money(r.revenue)}</td>
              <td className="num">{money(r.vat)}</td>
              <td className="num">{money(r.net)}</td>
              <td className="num">{money(r.contentsValue)}</td>
              <td className="num">{money(r.landed)}</td>
              <td className="num">{money(r.gross)}</td>
              <td className="num">{(r.margin * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Prices include 10% VAT; margin = (revenue ÷ 1.1 − landed cost) ÷ (revenue ÷ 1.1). Packaging is not included.</p>
    </div>
  );
}

export function VersionsTab({ data, projectId, reload, open }: { data: ProjectData; projectId: number; reload: () => void; open: (n: number) => void }) {
  const [msg, setMsg] = useState("");
  async function act(url: string, method: string, done: string) {
    setMsg("");
    const r = await fetch(url, { method });
    const j = await r.json();
    setMsg(r.ok ? done.replace("{n}", String(j.units ?? "")) : (j.error ?? "Failed"));
    reload();
  }
  if (!data.versions.length) return <NoVersion />;
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>By</th>
            <th className="num">Sets</th>
            <th>Checks</th>
            <th>Margin</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.versions.map((v) => {
            const failed = (v.checks ?? []).filter((c) => !c.ok).length;
            return (
              <tr key={v.id}>
                <td>
                  <b>V{v.number}</b> {v.label}
                  {v.committed ? <span className="pill ok">stock reserved</span> : null}
                </td>
                <td className="small">
                  {v.createdBy} · {v.createdAt.slice(0, 16).replace("T", " ")}
                </td>
                <td className="num">{v._count.sets}</td>
                <td className={failed ? "bad" : "ok"}>{failed ? `${failed} failed` : "all passed"}</td>
                <td>{v.finance ? `${(v.finance.total.margin * 100).toFixed(1)}%` : ""}</td>
                <td className="actions">
                  <button onClick={() => open(v.number)}>View</button>
                  <button onClick={() => act(`/api/projects/${projectId}/versions/${v.number}/restore`, "POST", `V${v.number}'s recipes and rules are the current plan again.`)}>Restore plan</button>
                  {v.committed ? (
                    <button onClick={() => act(`/api/projects/${projectId}/versions/${v.number}/reserve`, "DELETE", "Reservation released.")}>Release stock</button>
                  ) : (
                    <button onClick={() => act(`/api/projects/${projectId}/versions/${v.number}/reserve`, "POST", `Reserved {n} units for V${v.number}. Other projects won't use them.`)}>Reserve stock</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small">{msg}</p>
    </div>
  );
}
