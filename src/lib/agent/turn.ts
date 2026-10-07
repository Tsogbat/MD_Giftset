// One agent turn: lock the project, record what the user said, run `claude -p` (resumed session,
// our MCP tools only), stream tool events into the turn row for the live view, store the result.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { runClaude, UsageLimitError, type AgentEvent } from "../ai/claude";
import { addTurn, type Brief } from "../projects";
import { SYSTEM_PROMPT, TURN_SCHEMA, type Question, type TurnResult } from "./prompt";
import type { Prisma } from "@/generated/prisma/client";

export type UserInput =
  | { kind: "brief" }
  | { kind: "answers"; answers: Array<{ id: string; question: string; value: unknown }> }
  | { kind: "approve"; note?: string }
  | { kind: "chat"; text: string };

const STALE_LOCK_MS = 40 * 60_000;
const APP_ROOT = process.cwd();

export class ProjectBusyError extends Error {}

/** Take the project for this person's agent turn; refuses while someone else's turn runs. */
export async function lockProject(projectId: number, user: string): Promise<void> {
  const r = await prisma.project.updateMany({
    where: { id: projectId, OR: [{ lockedBy: null }, { lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }] },
    data: { lockedBy: user, lockedAt: new Date() },
  });
  if (r.count !== 1) {
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    throw new ProjectBusyError(`${p?.lockedBy ?? "Someone"} is running the agent on this project right now.`);
  }
}

async function unlock(projectId: number) {
  await prisma.project.update({ where: { id: projectId }, data: { lockedBy: null, lockedAt: null } });
}

function mcpConfig(projectId: number, user: string): string {
  const dir = path.join(APP_ROOT, "data", "agent");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `mcp-${projectId}.json`);
  const cfg = {
    mcpServers: {
      giftset: {
        command: process.execPath,
        args: [path.join(APP_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(APP_ROOT, "scripts", "mcp-server.ts")],
        env: { GS_PROJECT_ID: String(projectId), GS_USER: user, GS_APP_ROOT: APP_ROOT, DATABASE_URL: "file:data/app.db" },
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

function promptFor(input: UserInput, user: string, brief: Brief): string {
  switch (input.kind) {
    case "brief":
      return `New project from ${user}. Brief:\n${JSON.stringify(brief, null, 2)}\n\nStart: call get_project, rule_memory, list_presets and look at the relevant catalog areas, then ask your first round of questions.`;
    case "answers":
      return `${user} answered:\n${input.answers.map((a) => `- ${a.id} "${a.question}": ${typeof a.value === "string" ? a.value : JSON.stringify(a.value)}`).join("\n")}\n\nContinue: ask the next round only if something important is still open, otherwise design the plan (save_plan, check_pools) and propose it${brief.autoBuild ? " — autoBuild is on, so build and review it right away" : ""}.`;
    case "approve":
      return `${user} approved the proposal${input.note ? ` with this note: ${input.note}` : ""}. Build it now (build_sets), review with inspect_sets photos=true, fix and rebuild if needed, then report.`;
    case "chat":
      return `${user}: ${input.text}`;
  }
}

/** Runs a whole agent turn. Call lockProject first; this always releases the lock. */
export async function runAgentTurn(projectId: number, user: string, input: UserInput): Promise<void> {
  const started = Date.now();
  let agentTurnId: number | null = null;
  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const brief = project.brief as unknown as Brief;
    if (input.kind === "answers") {
      const t = await addTurn(projectId, "user", user, "answers", input.answers);
      for (const a of input.answers) await prisma.answer.create({ data: { projectId, turnId: t.id, questionId: a.id, question: a.question, value: a.value as Prisma.InputJsonValue, author: user } });
    } else if (input.kind === "approve") await addTurn(projectId, "user", user, "approve", { note: input.note ?? "" });
    else if (input.kind === "chat") await addTurn(projectId, "user", user, "chat", { text: input.text });

    const agentTurn = await addTurn(projectId, "agent", "agent", "running", { message: "Working…" }, { events: [] });
    agentTurnId = agentTurn.id;
    const events: AgentEvent[] = [];
    let dirty = false;
    const flush = setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      await prisma.turn.update({ where: { id: agentTurn.id }, data: { events: events.slice(-200) as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
    }, 1500);

    const run = async (fresh: boolean) => {
      const sessionId = fresh || !project.sessionId ? crypto.randomUUID() : project.sessionId;
      if (sessionId !== project.sessionId) await prisma.project.update({ where: { id: projectId }, data: { sessionId } });
      const text = fresh && project.sessionId ? `(The earlier conversation could not be resumed; get_project has everything decided so far.)\n\n${promptFor(input, user, brief)}` : promptFor(input, user, brief);
      return runClaude({
        text,
        systemPrompt: SYSTEM_PROMPT,
        jsonSchema: TURN_SCHEMA,
        sessionId,
        resume: !fresh && !!project.sessionId,
        mcpConfig: mcpConfig(projectId, user),
        allowedTools: ["mcp__giftset"],
        cwd: path.join(APP_ROOT, "data", "agent-work"),
        timeoutMs: 35 * 60_000,
        onEvent: (e) => {
          events.push(e);
          dirty = true;
        },
      });
    };
    let result = await run(false);
    if (!result.ok && project.sessionId && /no conversation found|session/i.test(result.error ?? "")) result = await run(true);
    clearInterval(flush);

    const out = (result.structured ?? null) as TurnResult | null;
    if (!result.ok || !out) {
      await prisma.turn.update({
        where: { id: agentTurn.id },
        data: { kind: "error", payload: { message: result.error ?? "The agent ended without an answer.", raw: result.result ?? null } as Prisma.InputJsonValue, events: events.slice(-200) as unknown as Prisma.InputJsonValue, durationMs: Date.now() - started },
      });
      return;
    }
    await prisma.turn.update({ where: { id: agentTurn.id }, data: { kind: out.kind, payload: out as unknown as Prisma.InputJsonValue, events: events.slice(-200) as unknown as Prisma.InputJsonValue, durationMs: Date.now() - started } });
    const status = out.kind === "questions" ? "interview" : out.kind === "proposal" ? "proposal" : out.kind === "built" ? "built" : undefined;
    if (status) await prisma.project.update({ where: { id: projectId }, data: { status } });
  } catch (e) {
    const msg = e instanceof UsageLimitError ? `Claude usage limit reached${e.resetsAt ? ` — resets ${e.resetsAt.toLocaleString()}` : ""}. Try again after that.` : (e as Error).message;
    if (agentTurnId) await prisma.turn.update({ where: { id: agentTurnId }, data: { kind: "error", payload: { message: msg }, durationMs: Date.now() - started } }).catch(() => undefined);
    else await addTurn(projectId, "agent", "agent", "error", { message: msg }).catch(() => undefined);
  } finally {
    await unlock(projectId).catch(() => undefined);
  }
}

export type { Question, TurnResult };
