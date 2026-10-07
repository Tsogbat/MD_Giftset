// Headless Claude via the Claude Code CLI on the user's subscription — never an API key.
// Adapted from POG Studio (src/lib/ai/claude.ts): ANTHROPIC_* variables are stripped, the CLI's own
// claude.ai login is used (a CLAUDE_CODE_OAUTH_TOKEN in .env overrides it only when it is a real token).
// Gift Set Studio adds what the agent loop needs: persistent sessions (--session-id / --resume),
// our MCP tool server (--mcp-config, --allowedTools) and a live event callback for progress.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env, redact } from "../env";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudeImage = { mediaType: "image/jpeg" | "image/png"; base64: string };

export type AgentEvent =
  | { type: "tool"; name: string; input: unknown; at: number }
  | { type: "tool_result"; name?: string; ok: boolean; preview: string; at: number }
  | { type: "text"; text: string; at: number };

export type ClaudeRun = {
  text: string;
  model?: string;
  effort?: Effort;
  systemPrompt?: string;
  jsonSchema?: object;
  images?: ClaudeImage[];
  /** New conversation with this id, or continue one. */
  sessionId?: string;
  resume?: boolean;
  /** MCP config file + the tools the agent may call (e.g. ["mcp__giftset__*"]). */
  mcpConfig?: string;
  allowedTools?: string[];
  cwd?: string;
  timeoutMs?: number;
  onEvent?: (e: AgentEvent) => void;
};

export type ClaudeResult = {
  ok: boolean;
  result?: string;
  structured?: unknown;
  sessionId?: string;
  durationMs: number;
  model: string;
  modelsUsed: string[];
  numTurns?: number;
  error?: string;
};

export class UsageLimitError extends Error {
  constructor(message: string, public resetsAt: Date | null) {
    super(message);
    this.name = "UsageLimitError";
  }
}

type StreamLine = {
  type?: string;
  subtype?: string;
  session_id?: string;
  rate_limit_info?: { status?: string; resetsAt?: number };
  result?: unknown;
  is_error?: boolean;
  num_turns?: number;
  api_error_status?: number | null;
  modelUsage?: Record<string, unknown>;
  structured_output?: unknown;
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> };
};

const WORK_DIR = path.resolve("data/claude");

export function claudeBin(): string {
  return env("CLAUDE_BIN") ?? "claude";
}

export function defaultModel(): string {
  return env("MODEL_AGENT") ?? "claude-opus-5-5";
}

export function defaultEffort(): Effort {
  return (env("EFFORT_AGENT") as Effort) ?? "high";
}

function systemPromptFile(text: string): string {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const file = path.join(WORK_DIR, `system-${crypto.createHash("sha1").update(text).digest("hex").slice(0, 12)}.txt`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, text, "utf8");
  return file;
}

export function buildArgs(run: ClaudeRun): string[] {
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--model", run.model ?? defaultModel(),
    "--effort", run.effort ?? defaultEffort(),
    "--tools", "",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
  if (run.sessionId) args.push(run.resume ? "--resume" : "--session-id", run.sessionId);
  else args.push("--no-session-persistence");
  if (run.mcpConfig) args.push("--mcp-config", run.mcpConfig);
  if (run.allowedTools?.length) args.push("--allowedTools", run.allowedTools.join(","));
  if (run.systemPrompt) args.push("--system-prompt-file", systemPromptFile(run.systemPrompt));
  if (run.jsonSchema) args.push("--json-schema", JSON.stringify(run.jsonSchema));
  return args;
}

export function childEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("ANTHROPIC_") || k === "CLAUDECODE" || k === "CLAUDE_CODE_ENTRYPOINT") delete e[k];
  const token = env("CLAUDE_CODE_OAUTH_TOKEN");
  if (token?.startsWith("sk-ant-oat")) e.CLAUDE_CODE_OAUTH_TOKEN = token;
  else delete e.CLAUDE_CODE_OAUTH_TOKEN; // a placeholder would override the CLI login
  return e;
}

export type ClaudeAuth = { loggedIn: boolean; method: string; subscription?: string; via: "token" | "cli-login" | "none"; error?: string };

/** How `claude -p` will authenticate (never an API key). Cached for 10 minutes. */
export async function claudeAuth(): Promise<ClaudeAuth> {
  const g = globalThis as unknown as { claudeAuth?: { at: number; value: Promise<ClaudeAuth> } };
  if (g.claudeAuth && Date.now() - g.claudeAuth.at < 600_000) return g.claudeAuth.value;
  const value = new Promise<ClaudeAuth>((resolve) => {
    const child = spawn(claudeBin(), ["auth", "status", "--json"], { env: childEnv(), windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ loggedIn: false, method: "none", via: "none", error: e.message }));
    child.on("close", () => {
      try {
        const j = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
        const viaToken = !!childEnv().CLAUDE_CODE_OAUTH_TOKEN;
        resolve({ loggedIn: !!j.loggedIn, method: j.authMethod ?? "unknown", subscription: j.subscriptionType, via: j.loggedIn ? (viaToken ? "token" : "cli-login") : "none" });
      } catch {
        resolve({ loggedIn: false, method: "unknown", via: "none", error: out.slice(0, 200) });
      }
    });
  });
  g.claudeAuth = { at: Date.now(), value };
  return value;
}

export function isUsageLimitText(text: string): boolean {
  return /limit/i.test(text) && /(usage|reached|hit|resets|exceeded)/i.test(text);
}

function parseLine(l: string): StreamLine | undefined {
  try {
    return JSON.parse(l) as StreamLine;
  } catch {
    return undefined;
  }
}

/** Turn one stream-json line into progress events for the UI. */
export function eventsOf(line: StreamLine, toolNames: Map<string, string>): AgentEvent[] {
  const at = Date.now();
  const out: AgentEvent[] = [];
  for (const c of line.message?.content ?? []) {
    if (line.type === "assistant" && c.type === "tool_use") {
      if (c.id && c.name) toolNames.set(c.id, c.name);
      out.push({ type: "tool", name: c.name ?? "?", input: c.input, at });
    } else if (line.type === "assistant" && c.type === "text" && c.text?.trim()) {
      out.push({ type: "text", text: c.text, at });
    } else if (line.type === "user" && c.type === "tool_result") {
      const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      out.push({ type: "tool_result", name: c.tool_use_id ? toolNames.get(c.tool_use_id) : undefined, ok: !c.is_error, preview: body.slice(0, 300), at });
    }
  }
  return out;
}

/** Parse the CLI's stream-json output; throws UsageLimitError when the subscription limit is hit. */
export function parseStream(stdout: string, stderr: string, code: number | null, model: string, durationMs: number): ClaudeResult {
  const lines = stdout.split("\n").filter(Boolean).flatMap((l) => parseLine(l) ?? []);
  const rejected = lines.find((l) => l.type === "rate_limit_event" && l.rate_limit_info?.status === "rejected");
  const result = lines.find((l) => l.type === "result");
  const sessionId = lines.find((l) => l.session_id)?.session_id;
  const errorText = redact(String(result?.result ?? stderr));
  if (rejected || result?.api_error_status === 429 || (result?.is_error && isUsageLimitText(errorText))) {
    const at = rejected?.rate_limit_info?.resetsAt;
    throw new UsageLimitError(errorText.slice(0, 300), at ? new Date(at * 1000) : null);
  }
  const modelsUsed = Object.keys(result?.modelUsage ?? {});
  if (!result) return { ok: false, sessionId, durationMs, model, modelsUsed, error: redact(`claude exited ${code}: ${(stderr || stdout).slice(-800)}`) };
  if (result.is_error) return { ok: false, sessionId, durationMs, model, modelsUsed, numTurns: result.num_turns, error: errorText.slice(0, 1500) };
  return {
    ok: true,
    result: typeof result.result === "string" ? result.result : undefined,
    structured: result.structured_output,
    sessionId,
    durationMs,
    model,
    modelsUsed,
    numTurns: result.num_turns,
  };
}

// At most AGENT_MAX_PARALLEL claude processes at once (subscription limits).
const gate = globalThis as unknown as { claudeGate?: { running: number; queue: Array<() => void> } };
const G = (gate.claudeGate ??= { running: 0, queue: [] });
function maxParallel(): number {
  return Math.max(1, Number(env("AGENT_MAX_PARALLEL") ?? 2));
}
async function acquire(): Promise<void> {
  if (G.running < maxParallel()) {
    G.running++;
    return;
  }
  await new Promise<void>((r) => G.queue.push(r));
  G.running++;
}
function release() {
  G.running--;
  G.queue.shift()?.();
}

export async function runClaude(run: ClaudeRun): Promise<ClaudeResult> {
  await acquire();
  try {
    return await runOnce(run);
  } finally {
    release();
  }
}

function runOnce(run: ClaudeRun): Promise<ClaudeResult> {
  const started = Date.now();
  const model = run.model ?? defaultModel();
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [
        ...(run.images ?? []).map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })),
        { type: "text", text: run.text },
      ],
    },
  };
  const cwd = run.cwd ?? WORK_DIR;
  fs.mkdirSync(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), buildArgs(run), { cwd, env: childEnv(), windowsHide: true });
    let out = "";
    let err = "";
    let pending = "";
    const toolNames = new Map<string, string>();
    const timer = setTimeout(() => child.kill(), run.timeoutMs ?? 30 * 60_000);
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      out += s;
      if (!run.onEvent) return;
      pending += s;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.trim() ? parseLine(p) : undefined;
        if (line) for (const e of eventsOf(line, toolNames)) run.onEvent(e);
      }
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, durationMs: Date.now() - started, model, modelsUsed: [], error: redact(e.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(parseStream(out, err, code, model, Date.now() - started));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(message) + "\n");
  });
}
