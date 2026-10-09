// Mongolian report: a self-contained web page (filters, search, hover zoom) and a separate A4 print
// layout for the PDF (the user finds the browser's own export of a web page ugly).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { photoPath } from "../catalog";
import { money, recipeMn, ROLE_MN, rulesMn, SITE_MN, type ExportData } from "./data";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function photoCss(d: ExportData, px: number): Promise<string> {
  const codes = [...new Set(d.sets.flatMap((s) => s.items.map((i) => i.code)))];
  const rules: string[] = [];
  for (const code of codes) {
    const f = photoPath(code);
    if (!f) continue;
    const b64 = (await sharp(f).resize(px, px, { fit: "contain", background: "#ffffff" }).jpeg({ quality: 72 }).toBuffer()).toString("base64");
    rules.push(`.i-${code}{background-image:url(data:image/jpeg;base64,${b64})}`);
  }
  return rules.join("\n");
}

function stats(d: ExportData) {
  const totals = d.sets.map((s) => s.total);
  const failed = d.checks.filter((c) => !c.ok).length;
  return [
    ["Багц", String(d.sets.length)],
    ["Түвшин", String(new Set(d.sets.map((s) => s.tier)).size)],
    ["Барааны үнэ", totals.length ? `${money(Math.min(...totals))}–${money(Math.max(...totals))}₮` : "—"],
    ["Бохир ашиг", d.finance ? `${(d.finance.total.margin * 100).toFixed(1)}%` : "—"],
    ["Шалгалт", failed ? `${failed} унасан` : `${d.checks.length}/${d.checks.length} давсан`],
  ];
}

function recipesHtml(d: ExportData): string {
  return d.batches
    .map(
      (b) => `<h3>${esc(b.label)} · ${money(b.target)}₮ ± ${money(b.tolerance)}${b.sellPrice ? ` · борлуулах ${money(b.sellPrice)}₮` : ""}</h3>
<div class="recipes">${b.recipes
        .map(
          (r) => `<div class="rc"><div class="rc-h"><b>${esc(r.key)} · ${esc(r.nameMn ?? r.name)}</b><span>${r.boxes} багц</span></div>
${r.pitchMn ?? r.pitch ? `<p>${esc(r.pitchMn ?? r.pitch)}</p>` : ""}
<ul>${[...(r.hero ? [{ role: "★ Онцлох", s: r.hero }] : []), ...r.slots.map((s) => ({ role: "Нэмэлт", s }))]
            .map(({ role, s }) => `<li><span class="role">${role}</span> ${esc(s.labelMn ?? s.label)} <span class="band">${money(s.band[0])}–${money(s.band[1])}₮</span><div class="kinds">${s.kinds.map(esc).join(" · ")}</div></li>`)
            .join("")}</ul></div>`,
        )
        .join("")}</div>`,
    )
    .join("");
}

function setCard(d: ExportData, s: ExportData["sets"][number], print: boolean): string {
  const r = recipeMn(d.batches, s.tier, s.recipeKey);
  return `<article class="set" data-tier="${esc(s.tier)}" data-recipe="${esc(r.name)}" data-site="${esc(s.site)}" data-text="${esc([s.code, ...s.items.map((i) => `${i.code} ${i.barcode ?? ""} ${i.name}`)].join(" ").toLowerCase())}">
<header><b>${esc(s.code)}</b><span class="rn">${esc(r.name)}</span>${s.source === "team" ? '<span class="tag">баг</span>' : ""}${s.site ? `<span class="tag">${esc(SITE_MN[s.site] ?? s.site)}</span>` : ""}${s.bag ? `<span class="tag">уут ${esc(s.bag)}</span>` : ""}<span class="tot">${money(s.total)}₮</span></header>
<ul>${s.items
    .map(
      (i) => `<li class="${i.role}"><i class="ph i-${esc(i.code)}"${print ? "" : ' tabindex="0"'}></i><span class="nm">${i.role === "hero" ? "★ " : ""}${esc(i.name)}<small>${esc(i.code)}${i.bin ? ` · ${esc(i.bin)}` : ""}${i.role === "bonus" ? " · бонус" : ""}</small></span><span class="pr">${money(i.role === "bonus" ? i.value : i.price)}</span></li>`,
    )
    .join("")}</ul></article>`;
}

function financeHtml(d: ExportData): string {
  if (!d.finance) return "";
  const rows = [...d.finance.rows, { ...d.finance.total, label: "НИЙТ" }];
  return `<table class="fin"><thead><tr><th>Түвшин</th><th>Багц</th><th>Орлого ₮</th><th>Цэвэр орлого ₮</th><th>Барааны үнэ ₮</th><th>Өртөг ₮</th><th>Бохир ашиг ₮</th><th>Ашиг %</th></tr></thead><tbody>${rows
    .map((r) => `<tr${r.batch === "all" ? ' class="sum"' : ""}><td>${esc(r.label)}</td><td>${r.sets}</td><td>${money(r.revenue)}</td><td>${money(r.net)}</td><td>${money(r.contentsValue)}</td><td>${money(r.landed)}</td><td>${money(r.gross)}</td><td>${(r.margin * 100).toFixed(1)}%</td></tr>`)
    .join("")}</tbody></table><p class="note">Үнэ НӨАТ (10%)-тэй. Ашиг % = (орлого ÷ 1.1 − буулгасан өртөг) ÷ (орлого ÷ 1.1). Сав баглаа боодол тооцоогүй.</p>`;
}

function checksHtml(d: ExportData): string {
  return `<ul class="checks">${d.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}"><b>${c.ok ? "ДАВСАН" : "УНАСАН"}</b> ${esc(c.nameMn || c.name)}<div>${esc(c.detailMn || c.detail)}</div></li>`).join("")}</ul>`;
}

const BASE_CSS = `
:root{--bg:#f6f5f2;--panel:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e4e2dc;--accent:#c8102e;--soft:#fbe9ec;--ok:#1f7a4d;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17171a;--panel:#212125;--ink:#ececef;--muted:#a0a0a8;--line:#34343a;--soft:#3a1f25}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 'Golos Text','Segoe UI',system-ui,sans-serif}
h1,h2,h3{font-family:'Unbounded','Golos Text',sans-serif;font-weight:600;letter-spacing:-.01em}h2{margin:28px 0 10px}h3{font-size:15px;margin:18px 0 8px}
.recipes{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}.rc{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.rc-h{display:flex;justify-content:space-between;gap:8px}.rc p{margin:4px 0;color:var(--muted);font-size:13px}.rc ul{list-style:none;margin:6px 0 0;padding:0}.rc li{font-size:13px;padding:3px 0;border-top:1px dashed var(--line)}.role{color:var(--accent);font-weight:600;font-size:12px}.band{float:right;font-family:'JetBrains Mono',monospace;font-size:12px}.kinds{color:var(--muted);font-size:11px}
.set{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px}.set header{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:5px;margin-bottom:5px}.set .rn{color:var(--muted)}.set .tot{margin-left:auto;font-weight:700}.tag{font-size:11px;background:var(--soft);color:var(--accent);border-radius:99px;padding:0 7px}
.set ul{list-style:none;margin:0;padding:0}.set li{display:grid;grid-template-columns:var(--ph) 1fr auto;gap:8px;align-items:center;padding:2px 0;font-size:13px}.set li.hero .nm{font-weight:600}.set li.bonus{color:var(--accent)}.nm small{display:block;color:var(--muted);font-size:11px}.pr{font-family:'JetBrains Mono',monospace;font-size:12px}
.ph{display:block;width:var(--ph);height:var(--ph);background:#fff center/contain no-repeat;border-radius:6px;border:1px solid var(--line)}
.fin{border-collapse:collapse;width:100%;background:var(--panel)}.fin th,.fin td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right}.fin th:first-child,.fin td:first-child{text-align:left}.fin tr.sum{font-weight:700}.note{color:var(--muted);font-size:12px}
.checks{list-style:none;padding:0}.checks li{padding:6px 0;border-bottom:1px solid var(--line)}.checks li b{display:inline-block;width:80px}.checks .ok b{color:var(--ok)}.checks .bad b{color:var(--bad)}.checks div{color:var(--muted);font-size:12px;margin-left:80px}
.rules{columns:2;column-gap:28px}.rules li{break-inside:avoid;margin-bottom:6px}`;

export async function reportHtml(d: ExportData, mode: "web" | "print"): Promise<string> {
  const print = mode === "print";
  const css = await photoCss(d, print ? 140 : 260);
  const title = `${d.project.name} · V${d.version.number}`;
  const date = d.version.createdAt.toISOString().slice(0, 10);
  const tiers = [...new Set(d.sets.map((s) => s.tier ?? ""))].filter(Boolean);
  const recipes = [...new Set(d.sets.map((s) => recipeMn(d.batches, s.tier, s.recipeKey).name))].filter(Boolean);
  const sites = [...new Set(d.sets.map((s) => s.site ?? ""))].filter(Boolean);
  const fonts = print ? fs.readFileSync(path.resolve("assets/fonts/fonts.css"), "utf8") : "";
  const statTiles = stats(d)
    .map(([k, v]) => `<div class="st"><span>${k}</span><b>${esc(v)}</b></div>`)
    .join("");
  const snap = d.project.snapshot ? `Odoo мэдээлэл ${d.project.snapshot.takenAt.toISOString().slice(0, 16).replace("T", " ")} · борлуулалт ${d.project.snapshot.salesFrom?.toISOString().slice(0, 10)} → ${d.project.snapshot.salesTo?.toISOString().slice(0, 10)}` : "";

  if (!print) {
    const chips = (name: string, vals: string[]) => (vals.length > 1 ? `<div class="chips" data-f="${name}"><button class="on" data-v="">Бүгд</button>${vals.map((v) => `<button data-v="${esc(v)}">${esc(name === "site" ? (SITE_MN[v] ?? v) : v)}</button>`).join("")}</div>` : "");
    return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;700&family=Unbounded:wght@500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${BASE_CSS}
main{max-width:1400px;margin:0 auto;padding:24px 16px}.hero-h{display:flex;flex-wrap:wrap;gap:16px;align-items:end;justify-content:space-between}.hero-h h1{margin:0;font-size:26px}.sub{color:var(--muted)}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.st{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px}.st span{display:block;color:var(--muted);font-size:12px}.st b{font-size:17px}
.bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.bar input{flex:1;min-width:200px;font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)}
.chips{display:flex;gap:4px;flex-wrap:wrap}.chips button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:99px;padding:3px 10px;cursor:pointer}.chips button.on{background:var(--ink);color:var(--bg)}
.sets{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}.set{--ph:40px}
.ph{transition:transform .15s;transform-origin:left center;position:relative}.ph:hover,.ph:focus{transform:scale(4.4);z-index:9;box-shadow:0 6px 24px rgba(0,0,0,.25)}@media (prefers-reduced-motion:reduce){.ph{transition:none}}
details summary{cursor:pointer;color:var(--muted)}
${css}</style></head><body><main>
<div class="hero-h"><div><h1>${esc(d.project.name)}</h1><div class="sub">V${d.version.number}${d.version.label ? ` · ${esc(d.version.label)}` : ""} · ${date} · ${esc(d.version.createdBy)}</div></div><div class="sub">${esc(snap)}</div></div>
<div class="stats">${statTiles}</div>
<h2>Арга зүй</h2><details><summary>Бүх дүрэм (${rulesMn(d.rules, d.batches).length})</summary><ul class="rules">${rulesMn(d.rules, d.batches).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>
<h2>Жорууд</h2>${recipesHtml(d)}
<h2 id="all">Бүх ${d.sets.length} багц</h2>
<div class="bar"><input id="q" placeholder="Багц, код, баркод, нэрээр хайх">${chips("tier", tiers)}${chips("recipe", recipes)}${chips("site", sites)}</div>
<div class="sets">${d.sets.map((s) => setCard(d, s, false)).join("")}</div>
<h2>Санхүүгийн тооцоо</h2>${financeHtml(d)}
<h2>Шалгалт</h2>${checksHtml(d)}
</main><script>
const f={tier:"",recipe:"",site:""};const q=document.getElementById("q");
function run(){const t=q.value.trim().toLowerCase();document.querySelectorAll(".set").forEach(e=>{const ok=(!f.tier||e.dataset.tier===f.tier)&&(!f.recipe||e.dataset.recipe===f.recipe)&&(!f.site||e.dataset.site===f.site)&&(!t||e.dataset.text.includes(t));e.style.display=ok?"":"none"})}
document.querySelectorAll(".chips").forEach(c=>c.addEventListener("click",ev=>{const b=ev.target.closest("button");if(!b)return;c.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));f[c.dataset.f]=b.dataset.v;run()}));q.addEventListener("input",run);
</script></body></html>`;
  }

  // --- A4 print layout -----------------------------------------------------------------------
  const byTier = tiers.length ? tiers : [""];
  const pick = new Map<string, { site: string; bin: string; code: string; name: string; qty: number; sets: string[] }>();
  for (const s of d.sets)
    for (const i of s.items) {
      if (i.role === "bonus") continue;
      const k = `${i.site ?? ""}|${i.bin ?? ""}|${i.code}`;
      const p = pick.get(k) ?? { site: i.site ?? "", bin: i.bin ?? "", code: i.code, name: i.name, qty: 0, sets: [] };
      p.qty += i.qty;
      p.sets.push(s.code);
      pick.set(k, p);
    }
  const pickRows = [...pick.values()].sort((a, b) => a.site.localeCompare(b.site) || a.bin.localeCompare(b.bin));
  const toc = [
    ["method", "Арга зүй"],
    ["recipes", "Жорууд"],
    ...byTier.map((t, i) => [`sets-${i}`, t ? `${t} багцууд` : "Багцууд"]),
    ["finance", "Санхүүгийн тооцоо"],
    ["checks", "Шалгалт"],
    ...(pickRows.some((p) => p.bin) ? [["pick", "Хавсралт: цуглуулах жагсаалт"]] : []),
  ];
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${fonts}
${BASE_CSS}
@page{size:A4;margin:14mm 12mm 16mm;@bottom-left{content:"${esc(d.project.name)} · V${d.version.number}";font:8pt 'Golos Text';color:#888}@bottom-right{content:counter(page) " / " counter(pages);font:8pt 'Golos Text';color:#888}}
@page:first{@bottom-left{content:none}@bottom-right{content:none}}
:root{--bg:#fff;--panel:#fff}body{font-size:10pt;background:#fff;color:#1d1d1f;-webkit-print-color-adjust:exact;print-color-adjust:exact}
section{break-before:page}h2{font-size:15pt;margin:0 0 8pt;border-bottom:2pt solid var(--accent);padding-bottom:3pt}
.cover{height:250mm;display:flex;flex-direction:column;justify-content:center}.cover .k{color:var(--accent);font:600 11pt 'Unbounded'}.cover h1{font-size:28pt;margin:6pt 0}.cover .sub{color:#666}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:6pt;margin:20pt 0}.st{border:1px solid var(--line);border-radius:8pt;padding:6pt 8pt}.st span{display:block;color:#777;font-size:8pt}.st b{font-size:12pt}
.toc{list-style:none;padding:0;margin-top:20pt}.toc li{display:flex;border-bottom:1px dotted #bbb;padding:4pt 0}.toc a{color:inherit;text-decoration:none;flex:1}.toc a::after{content:target-counter(attr(href),page);float:right}
.recipes{grid-template-columns:1fr 1fr}.rc{break-inside:avoid}
.sets{display:grid;grid-template-columns:1fr 1fr;gap:6pt}.set{--ph:26px;break-inside:avoid;padding:6pt 7pt}.set li{font-size:8.2pt;padding:1pt 0}.nm small{font-size:7pt}.pr{font-size:8pt}
.fin{font-size:9pt}.checks li{break-inside:avoid}
.pick{border-collapse:collapse;width:100%;font-size:8pt}.pick th,.pick td{border-bottom:1px solid #ddd;padding:2pt 4pt;text-align:left}.pick td.q{text-align:right}
${css}</style></head><body>
<div class="cover"><div class="k">ARTBOX Mongolia · Gift Set Studio</div><h1>${esc(d.project.name)}</h1><div class="sub">V${d.version.number}${d.version.label ? ` · ${esc(d.version.label)}` : ""} · ${date} · ${esc(d.version.createdBy)}</div><div class="sub">${esc(snap)}</div>
<div class="stats">${statTiles}</div><ul class="toc">${toc.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join("")}</ul></div>
<section id="method"><h2>Арга зүй</h2><ul class="rules">${rulesMn(d.rules, d.batches).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>
<section id="recipes"><h2>Жорууд</h2>${recipesHtml(d)}</section>
${byTier.map((t, i) => `<section id="sets-${i}"><h2>${esc(t || "Багцууд")}</h2><div class="sets">${d.sets.filter((s) => !t || s.tier === t).map((s) => setCard(d, s, true)).join("")}</div></section>`).join("")}
<section id="finance"><h2>Санхүүгийн тооцоо</h2>${financeHtml(d)}</section>
<section id="checks"><h2>Шалгалт</h2>${checksHtml(d)}</section>
${pickRows.some((p) => p.bin) ? `<section id="pick"><h2>Хавсралт: цуглуулах жагсаалт</h2><table class="pick"><thead><tr><th>Байршил</th><th>Бин</th><th>Код</th><th>Нэр</th><th>Тоо</th><th>Багцууд</th></tr></thead><tbody>${pickRows.map((p) => `<tr><td>${esc(SITE_MN[p.site] ?? p.site)}</td><td>${esc(p.bin)}</td><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td class="q">${p.qty}</td><td>${esc(p.sets.join(", "))}</td></tr>`).join("")}</tbody></table></section>` : ""}
</body></html>`;
}

export { ROLE_MN };
