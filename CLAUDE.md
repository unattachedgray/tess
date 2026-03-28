# Tess

Board game learning platform — play Go, Chess, and Janggi against AI with real-time coaching. Multiplayer via shared links.

## Tech Stack
- **Client**: Svelte 5 + Vite + Tailwind CSS v4
- **Server**: Node.js + Hono (HTTP) + ws (WebSocket) + tsx (dev)
- **Shared**: TypeScript workspace package with Zod schemas + game logic
- **Database**: SQLite (better-sqlite3) — added in Phase 3
- **Engines**: KataGo (Go, GTP protocol), Fairy-Stockfish (Chess/Janggi, UCI protocol)
- **AI Analysis**: Claude Code CLI (`claude --print`) — no API keys
- **Tooling**: Biome (lint+format), Vitest (testing), pnpm (package manager)

## Structure
```
packages/shared/   — Game logic, WS protocol types, Zod schemas
packages/client/   — Svelte 5 SPA
packages/server/   — Hono + ws backend, engine adapters, AI service
assets/engines/    — KataGo + Fairy-Stockfish binaries (gitignored)
docs/              — Spec, architecture, features, plan
```

## Commands
```bash
./start.sh install          # Install deps + check engines
./start.sh dev              # Client :5174 + Server :8082
./start.sh prod             # Single server :8082

pnpm --filter shared test   # Shared package tests
pnpm --filter server test   # Server tests
pnpm --filter client build  # Build client
pnpm biome check .          # Lint + format check
```

## Key Decisions
- **Singleplayer-first**: AI opponents are the core experience. Multiplayer is secondary.
- **Authoritative server**: All moves validated server-side, even in singleplayer.
- **Shared game logic**: Rules in `packages/shared/`, used by both client and server.
- **Svelte 5 components**: Each game board is its own component. No monolith files.
- **Claude CLI only**: `claude --print` for AI analysis. No API keys, no fallback services.
- **No DB until Phase 3**: localStorage for settings/stats until accounts are needed.
- **Engine pool**: KataGo + Stockfish are shared processes, not per-client.

## Reference
`../boardgames/` is the predecessor. Use as a cheatsheet for:
- Engine protocols (GTP commands for KataGo, UCI for Stockfish)
- Prompt templates (game-specific context injection for AI analysis)
- Game logic patterns (Go captures, Janggi piece movement, Ko detection)
- Piece SVG assets

Do not copy code directly. Write fresh.

## Conventions
- TypeScript strict mode
- Biome for formatting (no Prettier)
- Zod schemas for all WS messages
- Structured JSON logging on server
- Game-specific code in dedicated files (GoGame, ChessGame, JanggiGame — never mixed)
- Svelte components: PascalCase filenames, one component per file
- CSS: Tailwind utilities + CSS custom properties for themes
