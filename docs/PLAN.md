# Tess - Development Plan

## Approach

Build incrementally. Each phase produces a working app you can use. The `../boardgames/` codebase is a cheatsheet for engine protocols, prompt patterns, and game logic — but all code is fresh.

We use Claude Code CLI for development (this tool) and for the app's AI features (`claude --print`).

---

## Phase 1: Chess vs AI

**Ship**: Playable chess game against Stockfish in the browser.

### 1.1 — Scaffolding
```
pnpm workspace with packages/shared, packages/client, packages/server
TypeScript strict, Biome, Vitest
Svelte 5 + Vite + Tailwind v4 (client)
Hono + ws + tsx (server)
start.sh, .gitignore, CLAUDE.md
```

Do this first so everything else has a place to land.

### 1.2 — Shared Protocol + Chess Logic
- Zod schemas for WS messages in `packages/shared`
- `ChessGame` class wrapping chess.js: makeMove, getLegalMoves, getFen, getPgn, getStatus, getCaptured
- Unit tests for game logic
- Type exports for client + server

### 1.3 — WebSocket Plumbing
- Server: Hono HTTP + ws WebSocket on same port
- Client: WS client with typed send/receive + auto-reconnect
- Message routing by type
- Heartbeat (30s ping/pong)
- Structured logger

### 1.4 — Fairy-Stockfish Integration
- UCI adapter: spawn process, send/receive UCI commands
- Process pool (2 workers default)
- Difficulty config: 5 tiers mapped to movetime (50ms → 5000ms)
- Engine move request with configurable params

### 1.5 — Game Session
- Server `GameRoom`: holds ChessGame state + engine as AI player
- Flow: client sends NEW_GAME → server creates room → client sends PLAY_MOVE → server validates → queries engine → sends both moves back
- Human-like delay on AI moves (300ms-1500ms by tier)

### 1.6 — Chess UI
- `ChessBoard.svelte`: chessground with drag-drop, legal moves, last-move highlight, coordinates
- `Game.svelte`: board + status bar + captured pieces + move history
- `Home.svelte`: game type picker (only chess active), difficulty picker, "Play" button
- `App.svelte`: simple router (home / game)
- Responsive: board scales to viewport, panels below on mobile / beside on desktop
- Midnight theme (dark) as default
- Move sounds (place, capture, check)
- Game over overlay with result + new game button

**Test**: Open localhost, pick difficulty, play full chess game, hear sounds, see captures.

---

## Phase 2: Go + Janggi + Coaching

**Ship**: All 3 games playable with AI coaching.

### 2.1 — Go
- `GoGame` in shared: 19x19 board, stone placement, capture (flood-fill liberty counting), Ko detection (board hash), suicide prevention, pass, double-pass game end
- `GoBoard.svelte`: SVG grid, click-to-place, stone animations, captured count, coordinate labels
- KataGo GTP adapter: spawn process, analysis command with concurrent query IDs
- Difficulty tiers (visit counts: 10 → 8000)
- Board size selector (9x9 / 13x13 / 19x19)
- Unit tests (captures, Ko, scoring)

### 2.2 — Janggi
- `JanggiGame` in shared: FEN parsing, all 7 piece types with movement rules, palace constraints, check/checkmate
- `JanggiBoard.svelte`: DOM grid, SVG piece images, click-select-click-move, legal move dots
- Fairy-Stockfish largeboard variant config
- Difficulty tiers (movetime)
- Unit tests (piece movement, check detection)

### 2.3 — Game Selector + Home
- Home view shows 3 game options (Go / Chess / Janggi)
- Each has difficulty picker
- Board swaps cleanly on game change
- Settings persisted per game type in localStorage
- Side panels adapt (captured stones vs captured pieces vs score)

### 2.4 — AI Coaching
- `AiService` on server: `claude --print` with timeout (30s), rate limiting (1 concurrent / 5s cooldown)
- Prompt templates per game with context: FEN, move history, phase, top-3 engine suggestions
- Multi-language instruction in prompt
- `Analysis.svelte`: panel showing AI text with markdown rendering
- `Suggestions.svelte`: top-3 engine moves with scores
- Glossary system: term → definition map, longest-match highlighting in analysis text
- Tooltips on highlighted terms (hover/click)
- Toggle analysis on/off
- Loading state while analysis is in-flight

**Test**: Play Go against KataGo, see analysis explain why your move was good/bad, hover a term like "atari" to see definition.

---

## Phase 3: Multiplayer + Persistence

**Ship**: Play against friends via link. Games saved to account.

### 3.1 — Multiplayer
- `Lobby.svelte`: create game form (type, time control, color) → get shareable link
- `lobby.ts` on server: game creation, join by ID, game listing
- `GameRoom` extended: 2 human players, server-side move clocks, spectator list
- Move validation: server rejects illegal moves, broadcasts valid ones
- Clock component with countdown + increment
- Draw offer / accept / decline
- Resignation
- Reconnection: 60s grace period, state restore
- Rematch flow
- Spectator mode (join as observer, read-only)

### 3.2 — Database
- SQLite + better-sqlite3, WAL mode
- Migrations: `001_users.sql`, `002_games.sql`, `003_ratings.sql`
- Auto-run pending migrations on server startup

### 3.3 — Accounts
- Guest: auto-created on first visit, tracked by secure cookie
- Register: username + password (bcrypt), converts guest account
- Login / logout
- Session cookies (httpOnly, secure)
- Auth middleware for protected routes

### 3.4 — Game History + Ratings
- Save every completed game: players, moves, result, timestamps, game type
- `Profile.svelte`: game archive, filters, win/loss stats per game type
- Click to replay (Review view, move-by-move navigation)
- Glicko-2 ratings per game type, updated after rated multiplayer games
- Rating displayed in lobby and profile
- Export: PGN for chess, SGF for Go

**Test**: Share a link with a friend, play chess with 10+5 time control, see it saved in your profile afterward.

---

## Phase 4: Learning Tools

**Ship**: Post-game review, opening recognition, improvement tracking.

### 4.1 — Post-Game Review
- `Review.svelte`: step through game move-by-move with board + eval bar
- Engine eval at each position (batch compute or on-demand)
- Move quality badges (blunder/mistake/inaccuracy/good/brilliant) based on eval delta
- Key moments: positions where eval swung the most
- AI summary: `claude --print` with full game for natural-language review
- Shareable review link

### 4.2 — Opening Explorer
- Chess: ECO code database, match opening moves → show name + description
- Go: recognize common joseki patterns
- Display opening name in game header during play
- Brief description in analysis panel

### 4.3 — Improvement Tracking
- Track accuracy per game (% of moves that match engine's top choice)
- Accuracy trend chart (last 20 games)
- Common mistake categories (from AI analysis of game history)

**Test**: Finish a game, enter review, step through seeing blunders highlighted, read AI summary of what went wrong.

---

## Phase 5: Polish

### 5.1 — Themes + i18n
- 6 themes (CSS custom properties), theme switcher
- 5 languages, translation files, language picker
- AI analysis follows user language

### 5.2 — Sound + Mobile
- Full sound set (per-game-type sounds), volume/mute control
- Mobile touch polish (44px targets, stacked panels, swipe nav)

### 5.3 — Admin + Deploy
- Admin API: player count, active games, engine health
- PM2 config, structured logging
- Production build (Vite → static + Hono serves)

---

## Development Workflow

We build each phase with Claude Code CLI:
1. Read the phase plan
2. Implement each step, testing as we go
3. Reference `../boardgames/` for engine protocol patterns and prompt templates
4. All new code — no copy-paste from boardgames

Each phase ends with a working, testable app. We don't move to the next phase until the current one works.
