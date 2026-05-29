# Agent Hub — Project Instructions (GEMINI.md)

> Current Version: **1.9.3** · Update this field on every release.

This file provides project-specific instructions, conventions, and workflows for Gemini CLI.

## Project Overview

**Agent Hub** is a desktop application (**Electron + Express + React 19 + TypeScript**) for managing AI agents and development projects. It generates a portable `.exe` for Windows x64.

It allows organizing projects by categories, creating and synchronizing Claude Code agents (`.md` with YAML frontmatter), chatting with AI (CLI / Anthropic API / GitHub Copilot), generating project context, and executing agents directly on a project.

Full technical documentation: [`docs/backend.md`](docs/backend.md) and [`docs/frontend.md`](docs/frontend.md).

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
