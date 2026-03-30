# Tess - Architecture

## Stack Choices

| Layer | Choice | Why |
|-------|--------|-----|
| **Frontend** | Svelte 5 + Vite | Compiled reactivity with zero runtime overhead. Components keep 3 game types isolated instead of a 2000-line monolith. Runes ($state, $derived) are a natural fit for game state. |
| **Styling** | Tailwind CSS v4 | CSS-first config (no tailwind.config.js), utility classes, built-in responsive/dark mode. Theme switching via CSS custom properties. |
| **Backend** | Node.js + Hono | Hono is ~14kb, has good middleware, handles the few REST endpoints we need. Node.js required for child_process (engine spawning). tsx for dev. |
| **WebSocket** | ws | Industry standard. Hono doesn't do WS natively on Node, so ws runs alongside it on the same HTTP server. |
| **Shared types** | npm workspace package | `packages/shared` imported by both client and server. Type-safe protocol, game interfaces, validation schemas. |
| **Validation** | Zod | Runtime validation of WS messages and REST inputs. Schemas defined in shared package. |
| **Database** | SQLite (better-sqlite3) | Synchronous, zero-config, file-based. WAL mode for concurrent reads. Added in Phase 3 — not needed for singleplayer. |
| **Testing** | Vitest | Vite-native, fast, good TypeScript support. |
| **Linting** | Biome | Single tool replacing ESLint + Prettier. Fast, opinionated, less config. |
| **Chess board** | chessground | Proven chess board UI with drag-drop, animations, highlighting. |
| **Chess logic** | chess.js | Standard chess rule engine. |
| **Go engine** | KataGo (GTP) | Best open-source Go AI. Concurrent analysis via query IDs. |
| **Chess/Janggi engine** | Fairy-Stockfish (UCI) | Supports standard chess + variants including Janggi. |
| **AI analysis** | Claude Code CLI | `claude --print` subprocess. No API keys — uses the user's Claude subscription. |
| **Process manager** | PM2 | Production process management with restart/logging. |

### Why Svelte over Vanilla TS

Vanilla TS doesn't scale for a multi-game UI. Svelte gives us:

- **Component isolation**: each game board is its own `.svelte` file with scoped styles
- **Reactive state**: `$state()` and `$derived()` replace manual DOM updates
- **No virtual DOM**: Svelte compiles to direct DOM manipulation — same perf as vanilla
- **Built-in transitions**: smooth board/panel animations without manual CSS

### Why Hono over raw http

Hono gives routing, middleware (CORS, static files, logging), and request parsing for ~14kb. Not as heavy as Express/Fastify, but structured enough to avoid reinventing routing.

### Why No SvelteKit

SvelteKit adds SSR, file-based routing, form actions. We don't need SSR for a game app, and the WebSocket server can't run inside SvelteKit's server hooks cleanly. Plain Svelte + Vite is simpler — we handle the few "pages" (home, game, review) with a lightweight client-side router.

### Why Biome over ESLint + Prettier

One tool, one config file, 10x faster. Biome handles both formatting and linting. Less dependency surface.

## System Diagram

```
┌──────────────────────────────────────────────────┐
│                   Browser (SPA)                   │
│                                                   │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Svelte App  │ │ WS Client│ │ Local Storage │  │
│  │             │ │          │ │ (settings,    │  │
│  │ Views:      │ │ auto-    │ │  guest stats) │  │
│  │  - Home     │ │ reconnect│ │              │  │
│  │  - Game     │ │          │ │              │  │
│  │  - Review   │ │          │ │              │  │
│  │  - Profile  │ │          │ │              │  │
│  └──────┬──────┘ └────┬─────┘ └──────────────┘  │
│         │              │                          │
└─────────┼──────────────┼──────────────────────────┘
          │ HTTP         │ WS
          │              │
┌─────────┼──────────────┼──────────────────────────┐
│         │     Tess Server (Node.js)               │
│         ▼              ▼                          │
│  ┌────────────┐ ┌────────────┐                   │
│  │   Hono     │ │  WS Server │                   │
│  │ (REST API) │ │  (ws lib)  │                   │
│  │            │ │            │                   │
│  │ /api/admin │ │ Per-client │                   │
│  │ /api/auth  │ │ sessions   │                   │
│  │ static     │ │            │                   │
│  └────────────┘ └─────┬──────┘                   │
│                       │                           │
│         ┌─────────────┼──────────────┐           │
│         ▼             ▼              ▼           │
│  ┌────────────┐ ┌──────────┐ ┌────────────┐     │
│  │Game Session│ │  Engine  │ │ AI Service │     │
│  │  Manager   │ │  Pool    │ │            │     │
│  │            │ │          │ │ claude     │     │
│  │ - state    │ │ KataGo   │ │ --print    │     │
│  │ - clocks   │ │ (GTP)    │ │            │     │
│  │ - players  │ │          │ │ Rate limit │     │
│  │ - history  │ │ Stockfish│ │ Timeout    │     │
│  │            │ │ Pool     │ │ Fallback   │     │
│  └────────────┘ │ (UCI)    │ └────────────┘     │
│                 └──────────┘                     │
│                       │                          │
│              ┌────────▼────────┐                 │
│              │  SQLite (later) │                 │
│              │                 │                 │
│              │ users, games,   │                 │
│              │ ratings, history│                 │
│              └─────────────────┘                 │
└──────────────────────────────────────────────────┘
```

## Directory Structure

```
tess/
├── docs/                          # Design documents
├── CLAUDE.md                      # Claude Code instructions
├── biome.json                     # Linting + formatting config
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml            # Workspace definition
│
├── packages/
│   ├── shared/                    # Shared types & game logic
│   │   ├── src/
│   │   │   ├── protocol.ts        # WS message types (Zod schemas)
│   │   │   ├── types.ts           # GameType, Player, TimeControl, etc.
│   │   │   ├── games/
│   │   │   │   ├── go.ts          # Go rules, board state, validation
│   │   │   │   ├── chess.ts       # Chess wrapper (chess.js)
│   │   │   │   └── janggi.ts      # Janggi rules, piece movement
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── client/                    # Svelte 5 + Vite SPA
│   │   ├── src/
│   │   │   ├── App.svelte         # Root layout + router
│   │   │   ├── main.ts            # Entry point
│   │   │   ├── lib/
│   │   │   │   ├── ws.ts          # WebSocket client
│   │   │   │   ├── stores.ts      # Global state ($state)
│   │   │   │   ├── i18n.ts        # Translation system
│   │   │   │   ├── glossary.ts    # Term definitions
│   │   │   │   ├── sounds.ts      # Audio management
│   │   │   │   └── router.ts      # Simple client-side router
│   │   │   ├── views/
│   │   │   │   ├── Home.svelte    # Game selection + play vs AI
│   │   │   │   ├── Game.svelte    # Active game (board + panels)
│   │   │   │   ├── Lobby.svelte   # Multiplayer lobby
│   │   │   │   ├── Review.svelte  # Post-game review
│   │   │   │   └── Profile.svelte # Player stats & history
│   │   │   ├── boards/
│   │   │   │   ├── GoBoard.svelte
│   │   │   │   ├── ChessBoard.svelte
│   │   │   │   └── JanggiBoard.svelte
│   │   │   ├── components/
│   │   │   │   ├── Clock.svelte
│   │   │   │   ├── MoveHistory.svelte
│   │   │   │   ├── Analysis.svelte
│   │   │   │   ├── Suggestions.svelte
│   │   │   │   ├── CapturedPieces.svelte
│   │   │   │   ├── DifficultyPicker.svelte
│   │   │   │   ├── ThemeSwitcher.svelte
│   │   │   │   └── LanguagePicker.svelte
│   │   │   └── styles/
│   │   │       ├── app.css        # Global styles, Tailwind imports
│   │   │       └── themes.css     # Theme CSS custom properties
│   │   ├── index.html
│   │   ├── public/
│   │   │   ├── pieces/            # SVG piece sets
│   │   │   └── sounds/            # Audio files
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── server/                    # Node.js backend
│       ├── src/
│       │   ├── index.ts           # Entry: HTTP + WS server startup
│       │   ├── http.ts            # Hono app (REST routes, static files)
│       │   ├── ws.ts              # WebSocket server + message routing
│       │   ├── session.ts         # Game session manager
│       │   ├── gameRoom.ts        # Single game room (state, players, clocks)
│       │   ├── lobby.ts           # Multiplayer lobby
│       │   ├── ai.ts              # Claude Code CLI service
│       │   ├── engine/
│       │   │   ├── pool.ts        # Engine lifecycle + sharing
│       │   │   ├── katago.ts      # KataGo GTP adapter
│       │   │   ├── uci.ts         # UCI adapter (single process)
│       │   │   ├── uciPool.ts     # Fairy-Stockfish process pool
│       │   │   └── difficulty.ts  # Tier calibration config
│       │   ├── db.ts              # SQLite layer (Phase 3)
│       │   ├── auth.ts            # Auth logic (Phase 3)
│       │   └── logger.ts          # Structured JSON logging
│       ├── migrations/            # SQL migration files (Phase 3)
│       ├── package.json
│       └── tsconfig.json
│
├── assets/
│   └── engines/                   # Engine binaries (gitignored)
│       ├── katago/
│       │   ├── katago
│       │   ├── default_gtp.cfg
│       │   └── default_model.bin.gz
│       └── fairy-stockfish
│
├── start.sh                       # Install/dev/prod launcher
└── ecosystem.config.cjs           # PM2 production config
```

## Key Design Decisions

### 1. Game Logic in Shared Package
Game rules live in `packages/shared/` and run on both client and server. Client uses them for instant UI feedback (legal move highlighting, immediate piece movement). Server uses them as the authority — in multiplayer, the server validates every move.

For singleplayer vs AI, the server is still authoritative. The client sends the player's move, server validates, updates state, queries engine for AI response, sends both moves back. This means the same code path works for singleplayer and multiplayer.

### 2. Session-Based Architecture
Each active game (whether vs AI or vs human) is a `GameRoom` on the server:
- Holds authoritative game state (from shared game logic)
- Manages connected players (1 human + AI, or 2 humans)
- Runs move clocks server-side
- Handles spectators
- For AI games: engine adapter acts as the second player

### 3. WebSocket Protocol
Typed JSON messages with a `type` discriminator. Zod schemas in shared package validate messages on both sides.

```typescript
// Client → Server
| { type: 'NEW_GAME', gameType, difficulty?, vsHuman? }
| { type: 'JOIN_GAME', gameId }
| { type: 'PLAY_MOVE', move }
| { type: 'RESIGN' }
| { type: 'REQUEST_ANALYSIS' }
| { type: 'PASS' }                    // Go only

// Server → Client
| { type: 'GAME_STATE', state, color, clocks? }
| { type: 'MOVE', move, state, clocks? }
| { type: 'GAME_OVER', result, reason }
| { type: 'ANALYSIS', text, tooltips }
| { type: 'SUGGESTIONS', moves[] }
| { type: 'ERROR', message }
```

### 4. Engine Pool
Engines are expensive processes. Shared across all clients:
- **KataGo**: single process, concurrent queries via analysis command with unique IDs
- **Fairy-Stockfish**: pool of N workers, checkout/release pattern
- Queue system when all workers are busy
- Graceful shutdown on server exit

### 5. AI Analysis
Claude Code CLI (`claude --print`) is the only LLM integration:
- Spawned as subprocess with timeout (30s)
- Rate-limited: max 1 concurrent call per game, 5s cooldown
- Context includes: position (FEN), move history, game phase, top engine suggestions
- Output: styled markdown with bolded glossary terms
- Multi-language via prompt instruction
- Fire-and-forget: analysis arrives async, game doesn't block on it

### 6. No Database Until Needed
Phase 1 and 2 work without any database:
- Game state lives in memory (GameRoom instances)
- Client settings in localStorage
- Stats tracked in localStorage

SQLite is introduced in Phase 3 when we add accounts and persistent game history. This avoids premature complexity.

## Data Flow: Singleplayer Move

```
Player clicks/drags piece
    │
    ▼
Svelte board component detects move
    │
    ▼
WS: PLAY_MOVE { move }
    │
    ▼
Server GameRoom validates (shared game logic)
    │
    ├── Invalid → WS: ERROR
    │
    ▼ Valid
Update game state
    │
    ├── WS: MOVE → client (confirms player move)
    │
    ├── Engine query (Stockfish/KataGo with difficulty params)
    │   │
    │   ▼
    │   Engine returns best move
    │   │
    │   ▼ (+ human-like delay)
    │
    ├── WS: MOVE → client (AI response)
    │
    ├── If analysis enabled:
    │   └── Async: claude --print with game context
    │       └── WS: ANALYSIS → client
    │
    └── If game over:
        └── WS: GAME_OVER → client
```
