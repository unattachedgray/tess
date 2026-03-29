# Tess

Board game learning platform — play Go, Chess, and Janggi against AI with real-time coaching. Multiplayer via shared links or federated cross-server play.

## Tech Stack
- **Client**: Svelte 5 + Vite + Tailwind CSS v4
- **Server**: Node.js + Hono (HTTP) + ws (WebSocket) + tsx (dev)
- **Shared**: TypeScript workspace package with Zod schemas + game logic
- **Database**: SQLite (better-sqlite3)
- **Engines**: KataGo (Go, GTP), Fairy-Stockfish (Chess/Janggi, UCI)
- **AI Analysis**: Claude Code CLI (`claude --print`) — no API keys
- **Federation**: Hyperswarm (DHT + NAT traversal), Bonjour (mDNS), UPnP
- **Tooling**: Biome (lint+format), Vitest (testing), pnpm (package manager)

## Structure
```
packages/shared/   — Game logic (IGame interface), WS protocol, evaluation (SKILL_SCALE)
packages/client/   — Svelte 5 SPA, board components, i18n (5 languages)
packages/server/   — Hono + ws backend, GameEngine abstraction, AI, federation, SQLite
assets/engines/    — Engine binaries (auto-downloaded, gitignored)
scripts/           — Engine download, deployment helpers
docs/              — Spec, architecture, calibration, federation
data/              — SQLite database (auto-created, gitignored)
```

## Commands
```bash
./tess.sh              # Install, build, launch (opens browser)
./tess.sh install      # Install deps + download engines
./tess.sh dev          # Client :5174 + Server :8082 (hot reload)
./tess.sh prod         # Production: single server :8082
./tess.sh status       # Show health + engine + federation status
./tess.sh stop         # Stop all processes

pnpm --filter shared test   # Game logic + evaluation tests (56 tests)
pnpm --filter client build  # Build client SPA
pnpm biome check .          # Lint + format check

node test-mp-autoplay.cjs chess 800 2200   # Run autoplay simulation
```

## Key Architecture Decisions
- **IGame interface**: All games implement `IGame` from `game-interface.ts`. `GameRoom` uses `IGame` + `GameEngine` polymorphically — no game-type branching.
- **GameEngine abstraction**: `UciGameEngine` (chess/janggi) and `KataGoGameEngine` (go) wrap engine details. `GameRoom` never talks to engines directly.
- **SKILL_SCALE**: Single source of truth in `evaluation.ts` for all skill tiers, ACPL thresholds, and AI targets. Per-game calibrated (chess/janggi/go independently).
- **Server-authoritative**: All moves validated server-side. Federation: each server validates its own player.
- **Federation**: Hyperswarm DHT for discovery + NAT traversal. UPnP for auto port-forward. mDNS for LAN. Game relay over encrypted Noise streams.
- **i18n**: All UI strings use `t()` function. 5 languages (en/ko/es/vi/mn). Chat messages sent as i18n keys, translated on receiver's client.
- **Claude CLI only**: `claude --print` for coaching. No API keys needed. Gracefully disabled if CLI not installed.

## Key Files
- `packages/shared/src/evaluation.ts` — SKILL_SCALE, getSkillLevel(), getDifficultyRating()
- `packages/shared/src/game-interface.ts` — IGame, GameRegistry, GameDefinition
- `packages/shared/src/games/adapters.ts` — ChessAdapter, GoAdapter, JanggiAdapter
- `packages/server/src/engine/gameEngine.ts` — GameEngine interface, UciGameEngine, KataGoGameEngine
- `packages/server/src/gameRoom.ts` — SP game room (IGame + GameEngine)
- `packages/server/src/multiplayerRoom.ts` — MP game room
- `packages/server/src/federation.ts` — Hyperswarm + UPnP + mDNS + game relay
- `packages/server/src/postGameEval.ts` — MP post-game evaluation
- `packages/client/src/lib/i18n.ts` — All translations (en/ko/es/vi/mn)

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
- Games are modular via IGame interface — new game = implement IGame, no GameRoom changes
- Svelte components: PascalCase filenames, one component per file
- CSS: Tailwind utilities + CSS custom properties for themes
- i18n: all user-facing strings go through `t()` — never hardcode English
- Security: validate all untrusted input (WS messages via Zod, federation via size/type checks, emojis/messages via whitelist)
