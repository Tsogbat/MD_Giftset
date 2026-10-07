# Gift Set Studio

ARTBOX Mongolia's gift set and mystery box builder. You give the basics (price, how many, what it is for). An AI agent asks you the questions that are still open, proposes recipes and builds the sets from live Odoo data. It then checks its own result and exports Excel, an HTML report and a print PDF in Mongolian. Rules you give once (no D.Tale, USB-C only, team sets as given…) are kept under **Rules** and applied to every later project.

- The agent asks first, then builds. There is no set-type picker: mystery box versus gift bundle behaviour comes from your answers.
- AI decides (questions, recipes, review); a deterministic solver picks the exact SKUs (price within tolerance, stock, reuse and overlap limits, category mix, bag fit).
- Claude runs through this PC's Claude Code login (`claude -p`), not an API key. At most `AGENT_MAX_PARALLEL` (2) agent turns run at once, and only one per project.

## Use it

| Who | Address |
| --- | --- |
| On this PC (HQ-SJ07) | http://127.0.0.1:3200 |
| Colleagues on the office network | http://HQ-SJ07:3200, then type your name and the shared password (`LAN_PASSWORD` in `.env`) |

**Start:** double-click `Start Gift Set Studio.cmd`. It starts the app and the office-network gateway in the background; they keep running after the window closes.
**Stop:** `powershell -ExecutionPolicy Bypass -File scripts\stop-servers.ps1`

Logs are in `data\logs\` (`dev-server.log`, `lan-gateway.log` with sign-ins and wrong passwords).

### Working together
- Everyone signs in with their own name. Answers, agent turns, versions and uploaded files record who made them.
- A project shows who else has it open. While someone's agent turn runs, the project is locked for others (shown as "agent working for …"). If the app is restarted during a turn, the lock is released at start-up and the turn is marked as interrupted.
- Changing `LAN_PASSWORD` signs everyone out. A sign-in lasts 30 days. Use **Change name** / **Sign out** in the top bar.
- 10 wrong passwords from one PC within 10 minutes block that PC for 10 minutes.

### A project, step by step
1. **New project:** name, price or tiers, how many, what it is, and optionally team-made set files or a sample/bonus list (.xlsx).
2. **Questions:** answer the agent's cards (the recommended option is preselected). Up to three rounds.
3. **Proposal:** recipes and rules. Approve them, or say what to change. Tick "Build right after my answers" to skip this step.
4. **Sets:** the agent builds, reviews the photos, fixes and rebuilds. Every build is a new version (V1, V2…); older ones can be restored.
5. **Revise by chat:** e.g. "no D.Tale", "move 2 boxes to Figure Hunter". The agent asks whether to save a new rule for future projects.
6. **Export:** Excel (photos and a pick list), an HTML report and an A4 PDF in `exports\<project>\V<n>\`. Reserving stock for a version records it in the ledger, so other projects do not reuse those units.

## Set up on a new PC
Needs Node 24 (user install is fine), Claude Code logged in (`claude` → `/login`), and Microsoft Edge (for the PDF).
```
npm install
copy .env.example .env        # fill DB_* (Odoo read-only), ARTBOX_IMG_*, LAN_PASSWORD
npm run db:push               # creates data\app.db
npm run seed:rules            # rule memory from the Red Box / Tsagaan gar sessions
npm run seed:catalog          # optional: photo/size cache from the old Red Box and Tsagaan gar folders
npm run check                 # Odoo, Claude and img.artbox logins
npm run snapshot              # first Odoo snapshot (or Catalog → Refresh from Odoo)
```
Secrets stay in `.env` only (git ignores it, together with `data\` and `exports\`).

## For developers
- Next.js 16 (App Router) + Prisma 7 / libsql SQLite + pg (Odoo, read-only) + exceljs + zod + vitest.
- `npm run dev` runs the app alone on 127.0.0.1:3200; `npm run lan` runs the gateway alone (`scripts/lan-gateway.ts`).
- The gateway forwards the signed-in name as `x-gs-user` and strips that header from incoming requests. `src/proxy.ts` refuses `/api` writes coming from other websites.
- Agent: `src/lib/agent/` (prompt, turn loop, tools); the MCP server the CLI talks to is `scripts/mcp-server.ts`. Solver: `src/lib/engine/`. Exports: `src/lib/exports/`.
- `npm test`: solver and bonus balancer tests. `npx tsx scripts/agent-e2e.ts "<brief>"` runs the agent end to end without the UI. `npx tsx scripts/demo-project.ts redBox|tsagaanGar` builds from a preset without the agent.
