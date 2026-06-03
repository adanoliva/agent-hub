# Agent Hub — Project Instructions (GEMINI.md)

> Current Version: **2.1.0** · Update this field on every release.

This file provides project-specific instructions, conventions, and workflows for Gemini CLI.

## Project Overview

**Agent Hub** is a desktop application (**Electron + Express + React 19 + TypeScript**) for managing AI agents and development projects. It generates a portable `.exe` for Windows x64.

It allows organizing projects by categories, creating and synchronizing Claude Code agents (`.md` with YAML frontmatter), managing **skills** (technology context blocks injected into agent prompts at execution time), chatting with AI (CLI / Anthropic API / GitHub Copilot), generating project context, and executing agents directly on a project.

Full technical documentation: [`docs/backend.md`](docs/backend.md), [`docs/frontend.md`](docs/frontend.md) and [`docs/visual_styles.md`](docs/visual_styles.md).

## Key architectural changes (v2.1.0)

### Orchestrations — advanced pipeline features

- **Deterministic scripts**: nodes prefixed `__script:{name}__` execute Node.js logic without AI calls. Available scripts: `prepare-context`, `generate-file-index`, `diff-since-step`, `validate-json`, `quality-score`, `validate-output`. Zero token consumption.
- **HITL gates**: `node.gateAfter = true` pauses execution after that step. SSE event `gate-open` triggers frontend review UI. Actions: `approve` (continue), `revise` (revert + re-run with feedback text), `cancel`. Gate wait time does NOT count against the global timeout.
- **Quality Score**: calculated automatically after each AI step without AI calls. Score 0–100 with green/amber/red grade. Stored in `stepResult.qualityScore`.
- **Git Checkpointer** (`git-checkpointer.js`): when `project.gitEnabled === true` and the project is a git repo, commits each completed step automatically. SHA stored in `stepResult.gitCommitSha` for precise rollback via `git reset --hard`.
- **Ops Ledger** (`ops-ledger.js`): append-only record of every atomic file operation per orchestration. Persists in `.agent-hub/ops/{orchId}-ledger.json`. Each entry tracks file, agent, step, and status (`applied`/`reverted`). Accessible via `GET /api/orchestrations/:id/ops`.
- **Resume interrupted executions**: execution state persisted after each step in `execution-state.json`. `POST /executions/:execId/resume` restores completed steps from state and continues from the interruption point.
- **Skills injected in orchestration agents**: agents with `skills[]` in their frontmatter have skill content appended to their system prompt automatically.
- **`maxContextChars`**: new `executionConfig` field (default 4 000) limits user message size per step to avoid token window overflow.

### Previous changes (v1.9.5)

- **Skills system**: replaces the removed `tech` hierarchy level. Skills are Markdown blocks in `agents/skills/*.md` injected into agent system prompts at execution.
- **No `techId`**: projects no longer have `techId`. Technology specificity comes from `project.skills[]`.
- **Agent hierarchy**: global → section → project (no `tech` level).
- **Unified search**: agents and skills searchable by name+description with 250ms debounce.

## Tech Stack

- **Shell:** Electron (main process + preload)
- **API:** Express 4 on `localhost:3737`
- **Renderer:** React 19 + Vite + TypeScript
- **State Management:** Zustand 5
- **Styling:** Global CSS (`styles.css`) + CSS variables (no preprocessors)
- **Icons:** Tabler Icons CDN v3.6.0 (`ti ti-*`)
- **Fonts:** JetBrains Mono + Syne (Google Fonts)
- **AI Integration:** Claude CLI, Anthropic SDK, GitHub Models (Azure)
- **Build:** electron-builder → portable `.exe` x64

## Critical Commands

```bash
npm run dev      # Launch Electron + Vite dev server
npm run build    # Build portable .exe in dist/
npm run release  # Build and publish to GitHub Releases
```

### Environment Variables
- `CDM_DATA_DIR`: Custom data directory (defaults to app root).
- `GH_TOKEN`: Required for `npm run release`.

## Development Conventions

- **Language:** **Spanish in UI**, English in code, types, and documentation.
- **State:** Centralized in Zustand (`src/renderer/store/index.ts`). Use `useState` only for strictly local component state.
- **Styles:** Use `src/renderer/styles.css`. Do not use CSS Modules or preprocessors.
- **Validation:** `onConfirm` in Modals should `throw` errors (not return) to keep the modal open on failure.
- **Electron Safety:** Always use optional chaining for `window.api` (e.g., `api?.method?.()`) as the renderer might run in a browser context during development.
- **API Communication (CRITICAL):**
    - ALWAYS use the `req()` helper from `src/renderer/api.ts`.
    - NEVER include the `/api` prefix in the path passed to `req()` (e.g., use `/projects` instead of `/api/projects`).
    - If using native APIs (e.g., `EventSource`), ALWAYS use the exported `API_BASE` constant to construct the URL.
- **No Optimistic Updates:** Always wait for server confirmation before updating local state.
- **Testing:** Add/update tests in `tests/` after making changes. Use existing tests as a reference.

## Documentation & Updates

- **Documentation:** Always update `docs/backend.md` or `docs/frontend.md` when adding or modifying features.
- **Version Updates:** When bumping version, update:
    1. `package.json`
    2. `DEFAULT_CONFIG` in `src/backend/config.js`
    3. Version line at the top of this file and `CLAUDE.md`.

## Golden Rules

1. **Self-Documenting Code:** Prioritize clear code over comments. Comments should explain "why", not "what".
2. **Minimalism:** Avoid unnecessary abstractions, flags, or parameters.
3. **User Priority:** Active conversation instructions take precedence over these guidelines.
4. **Verification:** Always verify changes by running the project or relevant tests.
