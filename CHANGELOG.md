# Changelog

All notable changes to Tess are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-03-28

### Added

- **Chess vs AI** — Full scaffold with Fairy-Stockfish UCI engine, chessground board with drag-drop, 5 difficulty tiers
- **Go vs AI** — GoGame with captures, Ko detection, suicide prevention, SVG board with click-to-place, KataGo GTP adapter
- **Janggi vs AI** — JanggiGame with all 7 piece types, palace constraints, check/checkmate, Fairy-Stockfish largeboard variant
- **AI coaching** — Real-time move analysis via Claude Code CLI (`claude --print`) with game-specific prompts
- **Engine suggestions** — Top-N engine moves with centipawn/win-rate scores, click-to-play, configurable depth (Fast/Mid/Deep)
- **Player skill evaluation** — Post-game accuracy using Lichess formula, batch position replay through engine
- **LLM game narrative** — AI-generated game summary with eval display in coaching panel
- **Autoplay mode** — Watch AI vs AI at configurable Elo levels
- **Realistic difficulty** — UCI_LimitStrength with Elo range 800-2800+ for Chess/Janggi, KataGo visit budgets for Go
- **GPU acceleration** — KataGo CUDA support for faster Go analysis
- **Settings panel** — Persistent settings, auto-start game, configurable suggestion count
- **Anonymous users** — Persistent user identity with live player counts
- **SQLite database** — Game history storage, admin API, user persistence
- **Chess opening explorer** — 172 ECO openings with detection during play
- **PGN/SGF export** — Standard format export for Chess and Go games
- **MCP server** — Expose game engines as tools for Claude and other AI agents (new_game, play_move, get_position, get_legal_moves, get_opening, get_pgn)
- **Internationalization** — 5 languages (English, Korean, Spanish, Vietnamese, Mongolian) with language selection
- **AI coaching in user's language** — Claude analysis output follows language preference
- **Post-game replay** — Move-by-move navigation through completed games
- **WebSocket protocol** — Typed JSON messages with Zod validation, auto-reconnect, message queuing
- **Deployment tooling** — `tess.sh` launcher (install/dev/prod/stop/status), PM2 config, LICENSE, env configuration

### Fixed

- Janggi AI coaching timeout
- Janggi coordinate parsing and engine output handling
- Go stone placement and click-to-move behavior
- KataGo timeout and UCI carriage return handling
- WebSocket path conflict with Vite HMR (renamed /ws to /game-ws)
- WebSocket message queuing while disconnected, flush on connect
- Stale coaching from previous game leaking into new game
- AI coaching timing (switched to Haiku for speed)
- Pawn promotion auto-promoting to queen when no piece specified
- UCI buffer handling bug
- Game freeze on AI move failures
- `bestmove (none)` crash
- First-load suggestion failure (removed timeout, added retry)
- Duplicate suggestions, tooltip rendering, analysis ordering
- Skill eval crash, coaching toggle race condition, stale suggestion clicks
- Accessibility warnings
