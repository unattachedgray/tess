# Contributing to Tess

Thank you for your interest in contributing to Tess. This guide covers setup, conventions, and the process for submitting changes.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (auto-installed by `tess.sh` if missing)
- Engine binaries in `assets/engines/` (see [docs/ENGINES.md](docs/ENGINES.md))
- Claude Code CLI (`claude`) for AI coaching features (optional)

### Setup

```bash
git clone <repo-url>
cd tess
./tess.sh install    # Install deps, check engines, build client
./tess.sh dev        # Start dev servers (client :5174, server :8082)
```

### Project Structure

```
packages/shared/   — Game logic, WS protocol types, Zod schemas
packages/client/   — Svelte 5 SPA (Vite + Tailwind v4)
packages/server/   — Hono HTTP + ws WebSocket, engine adapters, AI, SQLite
assets/engines/    — Engine binaries (gitignored)
docs/              — Specification, architecture, features, plan
```

## Code Style

### TypeScript

- Strict mode is enabled in all packages.
- Use explicit types for function parameters and return values in public APIs.
- Prefer `type` over `interface` unless declaration merging is needed.

### Biome

Tess uses [Biome](https://biomejs.dev/) for both formatting and linting (no Prettier, no ESLint).

```bash
pnpm biome check .          # Check formatting + lint
pnpm biome check --write .  # Auto-fix
```

Key Biome settings:
- **Indent**: tabs
- **Line width**: 100 characters
- **Organize imports**: enabled
- **Unused variables/imports**: warn

Biome does not process `.svelte` files. Svelte components follow the same conventions manually.

### Svelte Components

- One component per file, PascalCase filenames (e.g., `ChessBoard.svelte`).
- Use Svelte 5 runes: `$state()`, `$derived()`, `$effect()`.
- Tailwind utility classes for styling. CSS custom properties for theme values.

### Game Logic

- Game-specific code goes in dedicated files. Never mix Go, Chess, and Janggi logic in the same file.
- Shared game logic lives in `packages/shared/src/games/`.
- All WebSocket messages validated with Zod schemas in `packages/shared/src/protocol.ts`.

### Server

- Structured JSON logging via `createLogger()`.
- Engine adapters in `packages/server/src/engine/`.
- New REST endpoints go in `packages/server/src/http.ts`.

## Testing

Run tests before submitting changes:

```bash
pnpm --filter shared test    # Game logic tests (52+ tests)
pnpm --filter server test    # Server tests
```

Tests use Vitest. Write tests for:
- New game logic (captures, move validation, edge cases)
- Protocol schema changes
- Utility functions

UI components do not currently have tests. Manual testing is expected for client changes.

## Commit Messages

Use concise, descriptive commit messages that explain the change:

```
Add post-game replay view with move-by-move navigation
Fix UCI buffer bug, add autoplay mode with configurable Elo
Fix stale coaching from previous game leaking into new game
```

Guidelines:
- Start with a verb: Add, Fix, Update, Remove, Refactor
- Keep the first line under 72 characters
- Mention the affected game or subsystem when relevant
- Combine related small fixes in a single commit when they are part of the same logical change

## Pull Request Process

1. Create a branch from `main` with a descriptive name (e.g., `fix-janggi-coordinates`, `add-puzzle-mode`).
2. Make your changes, ensuring `pnpm biome check .` passes with no errors.
3. Run the relevant test suites.
4. Write a clear PR description explaining what changed and why.
5. If your change affects the API or WebSocket protocol, update the relevant docs.

### What to Include in a PR

- Code changes with passing tests
- Updated Zod schemas if the WS protocol changes
- Updated `docs/` if you change architecture or add features

### What Not to Include

- Engine binaries (gitignored)
- SQLite database files (gitignored)
- IDE configuration files
- Unrelated formatting changes

## Architecture Notes

Before making significant changes, read these docs:

- [docs/SPEC.md](docs/SPEC.md) — What Tess is and how it works
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Stack choices and system design
- [docs/FEATURES.md](docs/FEATURES.md) — Feature roadmap by phase
- [docs/PLAN.md](docs/PLAN.md) — Implementation plan

Key design decisions:
- **Authoritative server**: All moves are validated server-side, even in singleplayer.
- **Engine pool**: KataGo and Fairy-Stockfish are shared processes, not per-client.
- **Claude CLI only**: AI analysis uses `claude --print`. No API keys, no fallback services.
- **Shared game logic**: Rules in `packages/shared/` are used by both client and server.

## Reporting Issues

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS/Node version
- Game type (Chess/Go/Janggi) if relevant
- Console output or server logs if available
