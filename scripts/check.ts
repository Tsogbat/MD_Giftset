// M0 smoke checks: Odoo (read-only), Claude CLI login + flags, img.artbox.kr login + lookup.
// Usage: npm run check            (all)
//        npm run check -- odoo     (one of: odoo, claude, artbox)
import { withOdoo, SQL } from "../src/lib/odoo/client";
import { claudeAuth, runClaude } from "../src/lib/ai/claude";
import { ArtboxSession } from "../src/lib/artbox/client";
import { redact } from "../src/lib/env";

const only = process.argv[2];
const results: Array<[string, boolean, string]> = [];

async function step(name: string, fn: () => Promise<string>) {
  if (only && only !== name) return;
  const t = Date.now();
  try {
    const msg = await fn();
    results.push([name, true, `${msg} (${((Date.now() - t) / 1000).toFixed(1)}s)`]);
  } catch (e) {
    results.push([name, false, redact((e as Error).message)]);
  }
}

await step("odoo", () =>
  withOdoo(async (q) => {
    const [ro] = await q<{ transaction_read_only: string }>("show transaction_read_only");
    if (ro.transaction_read_only !== "on") throw new Error("session is NOT read-only");
    const products = await q<{ n: string }>("select count(*) as n from readonly_md.product where active and sale_ok");
    const [range] = await q<{ first: Date; last: Date }>(SQL.salesRange);
    const stock = await q<{ warehouse: string; skus: string; units: string }>(
      `select warehouse, count(distinct product_id) as skus, round(sum(qty))::text as units from (${SQL.stock}) s group by 1 order by 1`,
    );
    const per = stock.map((s) => `${s.warehouse} ${s.skus} SKUs/${s.units} units`).join(", ");
    return `read-only ✓, ${products[0].n} active saleable products, POS ${range.first?.toISOString().slice(0, 10)} → ${range.last?.toISOString().slice(0, 10)}, stock: ${per}`;
  }),
);

await step("claude", async () => {
  const auth = await claudeAuth();
  if (!auth.loggedIn) throw new Error(`CLI not logged in (${auth.error ?? auth.method})`);
  const r = await runClaude({
    text: "Reply with ok=true and the word 'ready'.",
    systemPrompt: "You are a health check. Answer only through the structured output.",
    jsonSchema: { type: "object", properties: { ok: { type: "boolean" }, word: { type: "string" } }, required: ["ok", "word"] },
    model: "claude-haiku-4-5-20251001",
    effort: "low",
    timeoutMs: 120_000,
  });
  if (!r.ok) throw new Error(r.error ?? "claude failed");
  return `login via ${auth.via} (${auth.method}${auth.subscription ? ", " + auth.subscription : ""}), structured=${JSON.stringify(r.structured)}, ${r.modelsUsed.join(",")}`;
});

await step("artbox", async () => {
  const s = new ArtboxSession();
  await s.login();
  const hit = await s.lookup("01004784");
  if (!hit.found) throw new Error("login ok but test code 01004784 not found");
  return `login ✓, 01004784 → ${hit.krName ?? "?"} size ${hit.sizeRaw ?? "?"} dims ${hit.dims?.join("×") ?? "?"} photo ${hit.imgUrl ? "✓" : "✗"}`;
});

for (const [name, ok, msg] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(7)} ${msg}`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
