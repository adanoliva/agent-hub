# Agent Hub — Project Instructions (GEMINI.md)

> Current Version: **2.3.0** · Update this field on every release.

This file provides project-specific instructions, conventions, and workflows for Gemini CLI.
Full technical documentation: [`docs/backend.md`](docs/backend.md), [`docs/frontend.md`](docs/frontend.md).

## Project Overview

**Agent Hub** is a desktop application (**Electron + Express + React 19 + TypeScript**) for managing AI agents and development projects. Portable `.exe` for Windows x64.

It allows organizing projects by categories, creating and synchronizing AI agents (`.md` with YAML frontmatter), managing **skills** (technology context blocks injected into agent prompts at execution time), chatting with AI (CLI / Anthropic API / GitHub Copilot / Gemini…), generating project context, executing agents directly on a project, orchestrating multi-agent pipelines via a DAG engine, and integrating external tools via MCP servers (stdio and HTTP/SSE).

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron (main process + preload) |
| API | Express 4 on `localhost:3737` |
| Renderer | React 19 + Vite 8 + TypeScript |
| State | Zustand 5 |
| Styles | Global CSS (`styles.css`) + CSS variables, no preprocessors |
| Icons | Tabler Icons CDN v3.6.0 (`ti ti-*`) |
| Fonts | JetBrains Mono + Syne (Google Fonts) |
| AI | Claude CLI · Anthropic SDK · GitHub Models · Gemini CLI · Aider · Goose · DeepSeek · Groq · OpenRouter |
| MCP | stdio · HTTP/SSE · process pool with refcounting · `$env:VAR` resolution |
| Build | electron-builder → portable `.exe` x64 |

## Commands

```bash
npm run dev      # Electron + Vite dev server (DevTools open)
npm run build    # Portable .exe in dist/
npm run release  # Build + publish to GitHub Releases
```

Environment variables:
- `CDM_DATA_DIR` — custom data directory (defaults to app root in dev)
- `GH_TOKEN` — required for `npm run release`

## Project Structure

```
src/
  backend/
    main.js           ← entry point, BrowserWindow, IPC handlers
    server.js         ← all /api/* routes (Express)
    agents.js         ← agent CRUD (.md with YAML frontmatter)
    skills.js         ← skill CRUD (context blocks)
    projects.js       ← project CRUD, agent sync
    ai.js             ← multi-provider AI calls
    mcp.js            ← MCP client: pool, CRUD, CLI sync
    orchestrator.js   ← DAG execution engine + SSE streaming
    workflows.js      ← orchestration CRUD (.agent-hub/*.json)
    scripts-registry.js ← deterministic scripts (no AI)
    git-checkpointer.js ← auto-commits per step
    ops-ledger.js     ← append-only atomic operation log
  renderer/
    pages/            ← Dashboard, Projects, Agents, Chat, Orchestrations, Settings
    components/       ← layout, ui, projects, agents, orchestrations
    store/index.ts    ← Zustand global store
    api.ts            ← req<T>() helper for HTTP calls
    styles.css        ← single global CSS file
```

## Key Modules

### Agents
- Format: `.md` file with YAML frontmatter (`name`, `description`, `model`, `tools`, `system`, `mcp_servers?`).
- Three levels: `global` (all projects), `section` (category), `project` (single project).
- `mcp_servers` field (CSV): names of MCP servers activated when the agent runs.

### Skills
- Markdown blocks in `agents/skills/*.md`.
- Injected into the agent system prompt at execution time for projects that have them assigned.
- Code skills in English; documentation skills in Spanish.

### MCP (Model Context Protocol)
- Config in `config.json` → `mcpServers` (global) or `projects[i].mcpServers` (per project).
- Transport: `stdio` (default) or `http`.
- Env vars use `$env:VAR` syntax — actual credential values are never stored.
- Process pool: `acquireServers()` / `releaseServers()` with 30 s idle timeout.
- Auto-sync to providers: `.claude/settings.json`, `~/.gemini/settings.json`, CLI flags.
- REST: `GET/POST/PUT/DELETE /api/mcp/servers`, `POST /api/mcp/servers/:name/test`.

### DAG Orchestrations (v2.3.0)
- Each node: `id`, `agentName`, `dependsOn[]`, `dataFlow`, `contextExtra`, `gateAfter?`, `scriptParams?`.
- Engine computes topological levels and runs each level with `Promise.allSettled` (parallel).
- Floating nodes (`isRoot: false`, `dependsOn: []`) are excluded from execution.
- Scripts: `agentName` starting with `__script:` delegates to `scripts-registry.js` (no AI, zero tokens).
- HITL gates: `gateAfter: true` pauses after the step. Actions: `approve`, `revise`, `cancel`.
- Git checkpointing: automatic commit after each step when `project.gitEnabled === true`.
- Budget guard: `__script:budget-guard` with `maxBudgetUSD` param cancels if cumulative cost exceeds limit.

### Previous features (v2.1.0)
- **Quality Score**: auto-calculated after each AI step. Score 0–100 with green/amber/red grade.
- **Ops Ledger**: append-only file-operation log per orchestration. `GET /api/orchestrations/:id/ops`.
- **Resume executions**: `POST /executions/:execId/resume` restores completed steps and continues.

## Development Conventions

- **Language:** Spanish in UI, English in code, types, and technical comments.
- **State:** Centralized in Zustand (`store/index.ts`). Use `useState` only for strictly local state.
- **Styles:** Single `styles.css`. No CSS Modules or preprocessors.
- **No optimistic updates:** Always wait for server confirmation before updating local state.
- **`window.api` optional chaining:** `api?.method?.()` — renderer may run outside Electron.
- **API communication (CRITICAL):**
  - ALWAYS use the `req()` helper from `src/renderer/api.ts`.
  - NEVER include the `/api` prefix in the path passed to `req()`.
  - For native APIs (e.g., `EventSource`), ALWAYS use the exported `API_BASE` constant.
- **Modal `onConfirm`:** must `throw` (not return) to keep the modal open when validation fails.

## Version Checklist

When bumping version, update:
1. `version` in `package.json`
2. `version` in `DEFAULT_CONFIG` in `src/backend/config.js`
3. Version line at the top of `CLAUDE.md` and `GEMINI.md`
4. Commit + tag → `npm run release`

## Golden Rules

1. **Self-documenting code** — comments explain *why*, not *what*.
2. **Minimalism** — no abstraction, flag, or parameter beyond what the current requirement demands.
3. **Active conversation takes priority** — user instructions in the current session override these guidelines.
4. **Always update docs** — any new or modified feature must be reflected in `docs/backend.md` or `docs/frontend.md` before closing the task.
