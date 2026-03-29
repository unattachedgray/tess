<p align="center">
  <img src="assets/hero.svg" alt="Tess — Play Chess, Go, and Janggi against AI" width="100%"/>
</p>

Tess is a self-hosted board game platform where you play **Chess**, **Go**, and **Janggi** against AI opponents that adapt to your skill level — with real-time coaching that explains *why* moves are good or bad, not just which one to play.

Every game is analyzed. Every move is scored. You get better by playing.

## Quick Start

```bash
git clone https://github.com/your-repo/tess
cd tess
./tess.sh        # Installs everything, downloads engines, opens browser
```

That's it. Engines are auto-downloaded. If something fails, the script tells you exactly what to do.

```bash
./tess.sh dev      # Development mode (hot reload)
./tess.sh prod     # Production mode
./tess.sh status   # Check what's running
./tess.sh stop     # Stop everything
```

## What You Need

| Requirement | Status | Notes |
|-------------|--------|-------|
| **Node.js 20+** | Required | Checked automatically |
| **pnpm** | Auto-installed | Via npm if missing |
| **Claude Code CLI** | Optional | Enables AI coaching + game summaries |
| **Engine binaries** | Auto-downloaded | Chess, Go, Janggi engines from GitHub |

Engines download automatically on first install. If auto-download fails (ARM, macOS, etc.), the script prints manual download instructions with direct links.

```bash
./scripts/download-engines.sh          # Re-download all engines
./scripts/download-engines.sh --help   # See options
```

## What Makes Tess Different

### Coaching, Not Just Playing

Most board game apps tell you the best move. Tess tells you *why* — in your language. The AI coach (powered by Claude) explains tactics, patterns, and strategy in context. After the game, you get a narrative review of your strengths and mistakes.

### One Skill Scale Across Everything

Play chess at "Club" level, switch to Go, and your evaluation uses the same calibrated scale. The **SKILL_SCALE** system maps your actual move quality (ACPL) to consistent tiers — Beginner through Superhuman — independently calibrated per game from engine simulations.

| Tier | Chess | Go | Janggi |
|------|-------|----|--------|
| Superhuman | 2800+ | 9 dan+ | 2800+ |
| Pro | 2200-2500 | 1-3 dan | 2200-2500 |
| Club | 1600-1800 | 4-8 kyu | 1600-1800 |
| Casual | 1200-1400 | 13-15 kyu | 1200-1400 |
| Beginner | Under 1200 | 16+ kyu | Under 1200 |

### 5 Languages, Real Translation

UI, coaching, game summaries, chat messages — everything works in English, Korean, Spanish, Vietnamese, and Mongolian. Preset multiplayer messages are sent as i18n keys and translated on the receiver's client in *their* language.

### Self-Hosted and Private

Your games, your data. Tess runs on your machine. The SQLite database stays local. No accounts, no cloud, no tracking. You're assigned a random bird name (Falcon4821) and that's your identity.

## Multiplayer

### Same Machine

Two browser tabs on the same machine. One creates a challenge, the other accepts via the 6-character game code. Works immediately.

### Local Network

Share your machine's local IP (e.g., `http://192.168.1.50:8082`) with someone on the same WiFi. They open it in their browser, enter the game code, and play. No port forwarding needed for LAN.

### Cross-Internet

If you expose your Tess instance (via port forwarding, Tailscale, Cloudflare Tunnel, etc.), anyone with the URL + game code can join your game.

### Federation (Planned)

Tess instances will discover each other automatically on LAN via mDNS, and across the internet via manual peer registration. Remote challenges appear in your lobby with a server tag. Each server validates its own player's moves — no trust required between peers. See `docs/engine-calibration.md` for the full federation protocol design.

## Security

- **Server-authoritative**: All moves validated server-side. Clients cannot cheat.
- **No peer-to-peer**: Players never connect directly. All traffic goes through your Tess server.
- **No code execution**: Federation only exchanges JSON metadata (challenge info, moves). No eval, no binary data.
- **Local data**: SQLite database, engine binaries, and game history stay on your machine.
- **Opt-out**: Set `TESS_DISCOVERY=off` in `.env` to completely disable federation and network discovery. Local multiplayer still works.

```bash
# .env
TESS_DISCOVERY=off    # Disable federation (default: on)
TESS_SERVER_NAME=MyTess  # Custom server name for federation
```

## Games

| Game | Engine | AI Difficulty | Board |
|------|--------|---------------|-------|
| **Chess** | Fairy-Stockfish | 800-2800+ Elo (UCI_LimitStrength) | Chessground (drag-drop) |
| **Go** | KataGo | 16+ kyu to 9 dan+ (visit budgets) | SVG grid (click-to-place) |
| **Janggi** | Fairy-Stockfish LB | 800-2800+ Elo | SVG board (click-select-move) |

## Features

- **5 difficulty levels** per game, calibrated from autoplay simulations
- **Real-time AI coaching** via Claude CLI (5 languages)
- **Engine suggestions** with adjustable depth (Fast / Mid / Deep)
- **Post-game evaluation** — accuracy, ACPL, skill label
- **LLM game review** — narrative summary of your play
- **Chess opening explorer** (172 ECO openings)
- **Multiplayer** with Fischer clocks + idle timeout for untimed games
- **In-game chat** — emoji reactions + preset messages (i18n translated)
- **Player stats** — win/loss/draw, accuracy tracking
- **Autoplay mode** — watch AI vs AI at configurable Elo
- **Game history** in SQLite with PGN/SGF export
- **MCP server** — expose engines as tools for Claude agents
- **3 themes** — Midnight, Forest, Sandstorm

## Architecture

```
packages/shared/   — Game logic (IGame interface), WS protocol, evaluation (SKILL_SCALE)
packages/client/   — Svelte 5 SPA, Tailwind v4, board components
packages/server/   — Hono HTTP + ws WebSocket, GameEngine abstraction, AI coaching, SQLite
assets/engines/    — Engine binaries (auto-downloaded, gitignored)
scripts/           — Engine download, deployment helpers
data/              — SQLite database (auto-created, gitignored)
```

Games are modular via the `IGame` interface + `GameEngine` abstraction. Adding a new game (xiangqi, shogi, etc.) requires implementing `IGame`, registering in `GameRegistry`, and creating a `GameEngine` — zero changes to the game room infrastructure.

## API

```
GET  /api/health                — Server status
GET  /api/games                 — Game history
GET  /api/games/:id/export      — PGN/SGF download
GET  /api/users/:id/stats       — Player stats (W/L/D, accuracy)
POST /api/federation/peers      — Register a peer server
POST /api/federation/heartbeat  — Health check for peers
```

## Development

```bash
pnpm --filter shared test    # Run game logic + evaluation tests (56 tests)
pnpm biome check .           # Lint + format
pnpm run build               # Build client + shared
node test-mp-autoplay.cjs chess 800 2200   # Run autoplay simulation
```

## License

MIT
