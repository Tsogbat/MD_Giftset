// The agent's tools as an MCP server (stdio). `claude -p` starts it for each agent turn with
// GS_PROJECT_ID / GS_USER / GS_APP_ROOT in its environment (see src/lib/agent/turn.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// the app's relative paths (data/app.db, data/photos) must resolve before the lib modules load
if (process.env.GS_APP_ROOT) process.chdir(process.env.GS_APP_ROOT);
const T = await import("../src/lib/agent/tools");

const ctx = { projectId: Number(process.env.GS_PROJECT_ID), user: process.env.GS_USER ?? "agent" };
if (!ctx.projectId) throw new Error("GS_PROJECT_ID missing");

const server = new McpServer({ name: "giftset", version: "1.0.0" });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const safe =
  <A,>(fn: (a: A) => Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }>) =>
  async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return { content: [{ type: "text" as const, text: `ERROR: ${(e as Error).message}` }], isError: true };
    }
  };

server.registerTool(
  "get_project",
  { description: "The project: brief, every answer the user gave, the saved plan (rules + batches/recipes), versions built so far and uploads. Call this first in every turn." },
  safe(async () => text(await T.getProject(ctx))),
);

server.registerTool(
  "list_presets",
  { description: "The two proven designs (Red Box mystery box 199k×40; Tsagaan gar gift bundles 22.5K×50) with their rules and recipes. Offer them as recommended answers when they fit; they are starting points, not set types." },
  safe(async () => text(T.listPresets())),
);

server.registerTool(
  "rule_memory",
  { description: "Rules the user taught in earlier projects (e.g. 'no D.Tale', 'USB-C only'). Apply them by default and do NOT ask about them again; mention them as assumptions." },
  safe(async () => text(await T.ruleMemory())),
);

server.registerTool(
  "remember_rule",
  {
    description: "Save a rule for ALL future projects. Only after the user agreed to remember it (ask with a yes/no question first).",
    inputSchema: { title: z.string(), text: z.string().describe("Plain-English rule as the user would say it"), rule: z.any().optional().describe("Optional rulesPatch fragment that implements it") },
  },
  safe(async (a) => text(await T.rememberRule(ctx, a))),
);

server.registerTool(
  "catalog_stats",
  {
    description: "Counts of eligible in-stock products grouped by MIS category path (with best sellers, slow movers, price p10/median/p90 and units per site). Use it to pick recipe slot kinds and price bands from real data — never invent category paths.",
    inputSchema: {
      prefix: z.string().optional().describe('Category path prefix, e.g. "Kidult" or "Design Paper / Sticker"'),
      depth: z.number().int().min(1).max(5).optional().describe("Group by this many path levels (default: one below the prefix)"),
      priceMin: z.number().optional(),
      priceMax: z.number().optional(),
      site: z.string().optional().describe("WH, CEN or ENC"),
    },
  },
  safe(async (a) => text(await T.catalogStats(ctx, a))),
);

server.registerTool(
  "search_products",
  {
    description: "Find products (name, code, barcode, category prefix, brand, price, site) with weekly sales, weeks of cover and units per site.",
    inputSchema: {
      query: z.string().optional(),
      categoryPrefix: z.string().optional(),
      brand: z.string().optional(),
      priceMin: z.number().optional(),
      priceMax: z.number().optional(),
      site: z.string().optional(),
      sort: z.enum(["sales", "cover", "price"]).optional(),
      limit: z.number().int().optional(),
    },
  },
  safe(async (a) => text(await T.searchProducts(ctx, a))),
);

server.registerTool(
  "save_plan",
  {
    description:
      "Save the design: rules (as a patch onto the current rules, or onto a preset's rules when `preset` is given) and the full batches array (each batch: key, label, prefix, target, tolerance, optional close/hardRange/sellPrice, recipes[]; each recipe: key, name, nameMn, pitch, pitchMn, segment, codeGroup, boxes, heroShare, exclude, hero slot or null, slots[]; each slot: label, labelMn, kinds[], band [lo, hi], require). Validated; errors are returned so you can fix them.",
    inputSchema: {
      preset: z.enum(["redBox", "tsagaanGar"]).optional().describe("Start from this preset's rules (and its recipes when no batches are given and none are saved)"),
      rulesPatch: z.any().optional().describe("Partial Rules object; objects merge, arrays/values replace; null removes a field"),
      batches: z.any().optional().describe("Full batches array (replaces the saved one)"),
    },
  },
  safe(async (a) => text(await T.savePlanTool(ctx, a as never))),
);

server.registerTool(
  "check_pools",
  { description: "For the saved plan: candidates per hero/slot (per site when one-site is on), combinations that land on target, and problems. Fix every problem before proposing or building." },
  safe(async () => text(await T.checkPools(ctx))),
);

server.registerTool(
  "build_sets",
  {
    description: "Run the solver on the saved plan. On success it saves a new version (V1, V2…) and returns checks, value ranges and margins; on failure it says which recipe got stuck and why.",
    inputSchema: { label: z.string().optional().describe("Short version label, e.g. 'USB-C only, no D.Tale'") },
  },
  safe(async (a) => text(await T.buildSets(ctx, a))),
);

server.registerTool(
  "inspect_sets",
  {
    description: "Read built sets (latest version unless `version`). With photos=true each set comes with a contact-sheet image of its items in listed order (hero first) — use it to catch unsuitable items (cheap-looking, girl-specific in a neutral set, sharp items for kids, two colours of one product, mixed phone ports).",
    inputSchema: {
      version: z.number().int().optional(),
      codes: z.array(z.string()).optional().describe("Set codes, e.g. RB199-05"),
      recipe: z.string().optional().describe("Recipe key or name"),
      photos: z.boolean().optional(),
      limit: z.number().int().optional(),
    },
  },
  safe(async (a) => ({ content: await T.inspectSets(ctx, a) })),
);

server.registerTool(
  "finance",
  { description: "Revenue, VAT, landed cost and gross margin per batch for a version (latest by default).", inputSchema: { version: z.number().int().optional() } },
  safe(async (a) => text(await T.financeTool(ctx, a))),
);

server.registerTool(
  "export_version",
  {
    description: "Write the Mongolian Excel / A4 PDF / HTML report of a version (latest by default) into its own exports folder. Only when the user asks for files.",
    inputSchema: { version: z.number().int().optional(), formats: z.array(z.enum(["xlsx", "html", "pdf"])).optional() },
  },
  safe(async (a) => text(await T.exportVersion(ctx, a))),
);

const colRef = z.union([z.string(), z.number()]).describe("Header text, column letter (A, AB) or 1-based number");

server.registerTool(
  "read_upload",
  {
    description: "Without uploadId: list the project's uploaded files. With uploadId: sheet names and numbered rows (tab-separated) so you can find the header row and columns.",
    inputSchema: { uploadId: z.number().int().optional(), sheet: z.string().optional(), startRow: z.number().int().optional(), rows: z.number().int().optional() },
  },
  safe(async (a) => text(await T.readUploadTool(ctx, a))),
);

server.registerTool(
  "import_team_sets",
  {
    description:
      "Read team-made sets from an uploaded sheet: the set column names a set on its first row and is blank below. They are then included in every version EXACTLY as given (never changed), checked against Odoo, and their units are kept away from the solver.",
    inputSchema: {
      uploadId: z.number().int(),
      sheet: z.string(),
      headerRow: z.number().int(),
      setColumn: colRef,
      codeColumn: colRef,
      qtyColumn: colRef.optional(),
      nameColumn: colRef.optional(),
      priceColumn: colRef.optional(),
      totalColumn: colRef.optional(),
      tier: z.string().describe('Tier label, e.g. "Red Box 299k"'),
      prefix: z.string().describe('Set code prefix, e.g. "RB299"'),
      sellPrice: z.number().optional().describe("Box price the customer pays"),
    },
  },
  safe(async (a) => text(await T.importTeamSetsTool(ctx, a))),
);

server.registerTool(
  "import_bonus_pool",
  {
    description: "Read a bonus/sample list (items given free on top of the sets). value × rate = ₮ value (e.g. rate 3.24 for Korean won). Returns the items with ids for classify_bonus.",
    inputSchema: {
      uploadId: z.number().int(),
      sheet: z.string(),
      headerRow: z.number().int(),
      nameColumn: colRef,
      qtyColumn: colRef,
      valueColumn: colRef,
      rate: z.number(),
      codeColumn: colRef.optional(),
      barcodeColumn: colRef.optional(),
      expiryColumn: colRef.optional(),
    },
  },
  safe(async (a) => text(await T.importBonusPoolTool(ctx, a))),
);

server.registerTool(
  "classify_bonus",
  {
    description: "Label bonus items: kind (food, beauty, lip, nail, warmer…), family (variants of one product share it; never two in a set), exclude + reason (cheap-looking, one-gender, expired), tiers (only these tiers).",
    inputSchema: {
      uploadId: z.number().int(),
      labels: z.array(z.object({ id: z.string(), kind: z.string().optional(), family: z.string().optional(), exclude: z.boolean().optional(), reason: z.string().optional(), tiers: z.array(z.string()).optional() })),
    },
  },
  safe(async (a) => text(await T.classifyBonusTool(ctx, a))),
);

server.registerTool(
  "apply_bonus",
  {
    description:
      "Balance the bonus items onto a version's sets (contents unchanged) and save the result as a new version. bands per tier (tier = the set's tier label as shown in inspect_sets), e.g. 15000–20000. requireKind puts one of that kind in every set (e.g. food); maxPerKind caps a kind per set (e.g. {lip:1}).",
    inputSchema: {
      uploadId: z.number().int(),
      version: z.number().int().optional(),
      bands: z.array(z.object({ tier: z.string(), lo: z.number(), hi: z.number(), minItems: z.number().int().optional(), maxItems: z.number().int().optional() })),
      requireKind: z.string().optional(),
      maxPerKind: z.record(z.string(), z.number()).optional(),
      label: z.string().optional(),
    },
  },
  safe(async (a) => text(await T.applyBonusTool(ctx, a))),
);

await server.connect(new StdioServerTransport());
