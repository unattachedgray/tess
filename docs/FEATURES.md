# Tess - Features

The goal is a **learning-first board game platform**. Every feature should help someone get better at Go, Chess, or Janggi — whether that's through AI coaching, post-game review, puzzles, or just having opponents available 24/7.

---

## Phase 1: Play One Game Against AI

Get a single game (Chess) working end-to-end. Playable, polished, with AI opponent.

### Scaffolding
- [ ] pnpm workspace: `packages/shared`, `packages/client`, `packages/server`
- [ ] TypeScript strict mode, Biome for lint+format
- [ ] Svelte 5 + Vite + Tailwind v4 for client
- [ ] Hono + ws + tsx for server
- [ ] Shared Zod schemas for WS protocol
- [ ] start.sh (install/dev/prod), .gitignore, CLAUDE.md
- [ ] Git init

### Chess
- [ ] ChessGame class in shared (wraps chess.js)
- [ ] ChessBoard.svelte with chessground (drag-drop, highlights, coordinates)
- [ ] Fairy-Stockfish UCI adapter + process pool
- [ ] 5 difficulty tiers (movetime-calibrated)
- [ ] Game view: board + status + captured pieces + move history
- [ ] New game / resign / undo controls
- [ ] Human-like AI move delay

### Baseline UX
- [ ] Responsive layout (mobile-first)
- [ ] One theme (Midnight — dark default)
- [ ] Move sounds (place, capture, check)
- [ ] Game over screen with result

**Milestone**: Open browser, play chess against Stockfish, hear move sounds, see captured pieces.

---

## Phase 2: All Three Games + Coaching

Add Go and Janggi. Add AI coaching so users actually learn.

### Go
- [ ] GoGame class in shared: board state, captures, Ko, suicide, pass, scoring
- [ ] GoBoard.svelte: SVG 19x19 grid, click-to-place, captured stone count
- [ ] Board size options: 9x9, 13x13, 19x19
- [ ] KataGo GTP adapter with concurrent analysis queries
- [ ] Difficulty tiers (visit count calibration)
- [ ] Territory estimation display (when game ends)

### Janggi
- [ ] JanggiGame class in shared: FEN, all piece movement rules, palace, check/checkmate
- [ ] JanggiBoard.svelte: DOM grid, SVG pieces, click-select-click-move
- [ ] Fairy-Stockfish largeboard variant integration
- [ ] Difficulty tiers

### Game Selector
- [ ] Home view: pick game type → starts game vs AI
- [ ] Game type + difficulty persisted in localStorage
- [ ] Side panels adapt to game type

### AI Coaching (Claude Code CLI)
- [ ] AiService: spawns `claude --print` with game-specific prompts
- [ ] Context injection: FEN, move history, game phase, top engine suggestions
- [ ] Analysis panel in game view (collapsible)
- [ ] Auto-request analysis after each move (toggleable)
- [ ] Rate limiting (1 concurrent, 5s cooldown)
- [ ] Glossary: 50+ terms per game, auto-highlighted in analysis text
- [ ] Tooltip on hover/click for highlighted terms
- [ ] Loading skeleton while analysis pending

### Engine Suggestions
- [ ] Top-3 moves with win rate (Go) or centipawn score (Chess/Janggi)
- [ ] Principal variation display
- [ ] Suggestion staleness (dim when position changes)
- [ ] Suggestions panel (toggleable)

**Milestone**: Play any of the 3 games vs AI with real-time coaching explaining your moves and suggesting better ones.

---

## Phase 3: Multiplayer + Persistence

Let people play each other. Save their games.

### Multiplayer
- [ ] Lobby view: create game (type, time control, color preference)
- [ ] Join via shareable link (no matchmaking queue — keep it simple)
- [ ] GameRoom: 2 players, authoritative state, clocks, spectators
- [ ] Server-side move validation
- [ ] Move clock (configurable: untimed / 5+3 / 10+5 / 30+0)
- [ ] Clock display component
- [ ] Resignation, draw offer/accept
- [ ] Rematch button
- [ ] Reconnection with 60s grace period
- [ ] Spectator mode (read-only, live updates)
- [ ] Player count indicator

### Database + Accounts
- [ ] SQLite via better-sqlite3, WAL mode
- [ ] Migration system (numbered SQL files, auto-run on startup)
- [ ] Guest accounts (auto-created, cookie-tracked)
- [ ] Registration (username + password, bcrypt)
- [ ] Login/logout with session cookies
- [ ] Auth middleware on Hono routes

### Game History
- [ ] Save completed games (players, moves, result, timestamps)
- [ ] Game archive view with filters (game type, result, date)
- [ ] Click any game to replay move-by-move
- [ ] Export: PGN (chess), SGF (Go)

### Ratings
- [ ] Glicko-2 per game type
- [ ] Update after rated multiplayer games
- [ ] Rating on profile + in lobby
- [ ] Initial rating: 1500

**Milestone**: Two people can play each other via a shared link with time controls. Games are saved and replayable.

---

## Phase 4: Learning Tools

Make the AI coaching deeper. Give people structured ways to improve.

### Post-Game Review
- [ ] Review view: full game replay with analysis
- [ ] AI-generated game summary (claude --print with full move list)
- [ ] Key moments highlighted (biggest eval swings)
- [ ] Move quality badges: blunder / mistake / inaccuracy / good / brilliant
- [ ] "What was the best move?" comparison
- [ ] Shareable review links

### Opening Explorer
- [ ] For Chess: show named openings when moves match (ECO codes)
- [ ] For Go: common joseki patterns recognition
- [ ] Opening name displayed during game
- [ ] Brief opening description from glossary

### Mistake Patterns
- [ ] Track recurring mistake types per player (e.g. "drops pieces in time pressure")
- [ ] AI-generated improvement suggestions based on pattern history
- [ ] Simple chart: accuracy over last N games

### Puzzles (Stretch)
- [ ] Extract tactical positions from played games
- [ ] "Find the best move" mode
- [ ] Puzzle rating (separate from game rating)

**Milestone**: Players can review games with AI commentary, see their improvement trends, and study openings.

---

## Phase 5: Polish

### Themes
- [ ] 6 themes via CSS custom properties: Midnight, Twilight, Sakura, Ocean, Timber, Frost
- [ ] Theme switcher in header/settings
- [ ] Persisted to localStorage / account

### Internationalization
- [ ] 5 languages: English, Korean, Spanish, Vietnamese, Mongolian
- [ ] All UI strings in translation files
- [ ] Language picker, persisted
- [ ] AI analysis output follows language preference

### Sound
- [ ] Move, capture, check, game start/end, clock warning sounds
- [ ] Volume control + mute
- [ ] Different sounds per game type

### Mobile
- [ ] Touch refinement: 44px tap targets everywhere
- [ ] Panels stack vertically on mobile
- [ ] Swipe move history navigation
- [ ] Mobile-friendly lobby

### Admin
- [ ] /api/admin: active games, player count, engine status, uptime
- [ ] Structured JSON logging throughout
- [ ] PM2 ecosystem config for production

### MCP Server (Bonus)
- [ ] Expose engines as MCP tools for Claude agents
- [ ] Tools: init_game, play_move, get_suggestions, get_analysis
- [ ] Enables Claude agents to play/analyze games programmatically
