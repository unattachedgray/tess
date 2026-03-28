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
- **Claude Code CLI** (`claude`) — for AI coaching (optional)
- **Engine binaries** — placed in `assets/engines/`:
  - `fairy-stockfish` — Chess + Janggi (required)
  - `katago/` directory with `katago` or `katago-cuda`, `default_gtp.cfg`, `default_model.bin.gz` — Go (optional)

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
