// Client-side shapes of the workspace API responses.
import type { Question, TurnResult } from "@/lib/agent/prompt";
import type { Check, Plan } from "@/lib/engine/types";
import type { FinanceRow } from "@/lib/projects";

export type { Question, TurnResult, Check, Plan, FinanceRow };

export type AgentEvent = { type: "tool" | "tool_result" | "text"; name?: string; input?: Record<string, unknown>; ok?: boolean; preview?: string; text?: string; at: number };

export type Turn = { id: number; seq: number; role: string; author: string; kind: string; payload: Record<string, unknown>; events: AgentEvent[] | null; durationMs: number | null; createdAt: string };

export type VersionRow = { id: number; number: number; label: string | null; createdBy: string; createdAt: string; committed: boolean; checks: Check[] | null; finance: { rows: FinanceRow[]; total: FinanceRow } | null; seed: number | null; _count: { sets: number } };

export type ProjectData = {
  project: {
    id: number;
    name: string;
    status: string;
    lockedBy: string | null;
    brief: Record<string, unknown>;
    snapshot: { id: number; takenAt: string; products: number } | null;
    uploads: Array<{ id: number; filename: string; kind: string; createdBy: string }>;
  };
  turns: Turn[];
  versions: VersionRow[];
  plan: Plan | null;
};

export type SetItem = { id: number; position: number; role: string; slot: string | null; code: string; name: string; brand: string | null; categ: string | null; price: number; landedCost: number | null; site: string | null; bin: string | null };
export type GiftSet = { id: number; code: string; tier: string | null; recipeKey: string | null; recipe: string | null; site: string | null; total: number; bag: string | null; source: string; items: SetItem[] };
export type VersionDetail = VersionRow & { sets: GiftSet[]; rules: Plan["rules"]; recipes: Plan["batches"] };

export const money = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

const TOOL_LABEL: Record<string, string> = {
  get_project: "Reading the project",
  rule_memory: "Reading saved rules",
  remember_rule: "Saving a rule for future projects",
  list_presets: "Looking at Red Box / Tsagaan gar",
  catalog_stats: "Looking at the catalog",
  search_products: "Searching products",
  save_plan: "Saving the plan",
  check_pools: "Checking candidate pools",
  build_sets: "Building sets",
  inspect_sets: "Reviewing sets",
  finance: "Calculating margins",
  StructuredOutput: "Writing the answer",
};

export function describeTool(e: AgentEvent): string {
  const name = (e.name ?? "").replace(/^mcp__giftset__/, "");
  const label = TOOL_LABEL[name] ?? name;
  const i = e.input ?? {};
  const detail = [i.prefix, i.query, i.categoryPrefix, i.label, i.photos ? "with photos" : undefined, Array.isArray(i.codes) ? (i.codes as string[]).join(", ") : undefined].filter(Boolean).join(" · ");
  return detail ? `${label}: ${detail}` : label;
}
