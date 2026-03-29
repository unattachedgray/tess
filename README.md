# Tess

Board game learning platform — play Go, Chess, and Janggi against AI with real-time coaching.

## Quick Start

```bash
./tess.sh          # Install, build, and launch (opens browser)
```

Or step by step:

```bash
./tess.sh install   # Install dependencies + check engines
./tess.sh dev       # Development mode (hot reload)
./tess.sh prod      # Production mode
```

## What You Need

- **Node.js** 20+ and **pnpm** (auto-installed if missing)
- **Claude Code CLI** (`claude`) — for AI coaching (optional, install from https://docs.anthropic.com/en/docs/claude-code)
- **Engine binaries** — auto-downloaded on first install, or manually:

```bash
./scripts/download-engines.sh          # Download all engines
./scripts/download-engines.sh --chess-only   # Chess + Janggi only
./scripts/download-engines.sh --go-only      # KataGo only
```

Engines are placed in `assets/engines/` (gitignored). If auto-download fails for your platform, the script prints manual download instructions with links to the correct GitHub releases.

## Games

| Game | Engine | Board | AI Coaching |
|------|--------|-------|-------------|
| **Chess** | Fairy-Stockfish (UCI) | Chessground (drag-drop) | ECO openings, move analysis |
| **Go** | KataGo (JSON analysis) | SVG grid (click-to-place) | Win rate, territory, influence |
| **Janggi** | Fairy-Stockfish LB (UCI) | SVG board (click-select-move) | Piece activity, strategy |

## Features

- **5 difficulty levels** with realistic Elo (800-2800+ via UCI_LimitStrength)
- **AI coaching** via Claude CLI in 5 languages (EN/KO/ES/VI/MN)
- **Engine suggestions** with adjustable depth (Fast/Mid/Deep)
- **Post-game evaluation** using Lichess accuracy formula
- **LLM game review** with narrative feedback
- **Chess opening explorer** (172 ECO openings)
- **Autoplay mode** — watch AI vs AI at configurable Elo
- **Game history** saved to SQLite with PGN/SGF export
- **MCP server** — expose engines as tools for Claude agents

## Architecture

```
packages/shared/   — Game logic, WS protocol, Zod schemas, evaluation
packages/client/   — Svelte 5 SPA, Tailwind v4, chessground
packages/server/   — Hono HTTP + ws WebSocket, engine adapters, AI, SQLite
assets/engines/    — Engine binaries (gitignored)
data/              — SQLite database (gitignored)
```

## API

```
GET  /api/health              — Server status
GET  /api/admin               — Detailed stats
GET  /api/games               — Game history
GET  /api/games/:id           — Single game
GET  /api/games/:id/export    — PGN/SGF download
GET  /api/users/:id/stats     — Player stats
POST /api/users               — Register anonymous user
```

## MCP Server

```bash
pnpm --filter server mcp    # Start MCP on stdio
```

Tools: `new_game`, `play_move`, `get_position`, `get_legal_moves`, `get_opening`, `get_pgn`

## Development

```bash
pnpm --filter shared test    # Run game logic tests (52 tests)
pnpm biome check .           # Lint + format
pnpm run build               # Build client + shared
```

## License

MIT
