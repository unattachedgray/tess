# Tess - Specification

## What It Is

A web app for playing Go, Chess, and Janggi against AI opponents with real-time coaching. Multiplayer (human vs human) is a secondary mode.

The predecessor project (`../boardgames/`) was a vanilla TS monolith (~8k lines) that proved the concept. Tess is a clean rebuild with a proper component model, persistence, and multiplayer support.

## Supported Games

### Go (Baduk)
- 19x19 standard board (9x9, 13x13 for quick games)
- Full rules: captures, Ko, suicide prevention, territory scoring
- Pass mechanism, double-pass game end
- Coordinate notation (A1-T19, excluding I)

### Chess
- Standard FIDE rules
- Special moves: castling, en passant, promotion
- Draw detection: stalemate, threefold repetition, fifty-move rule, insufficient material
- SAN and UCI notation

### Janggi (Korean Chess)
- 9x10 board with palace/fortress zones
- Pieces: General, Advisor, Elephant, Horse, Chariot, Cannon, Soldier
- Piece-specific movement (horse/elephant leg blocking, cannon jump captures)
- Bikjang (facing generals) rule
- Custom FEN representation

## Core Experience

### Singleplayer (Primary)
- Pick a game, pick a difficulty, play
- 5 difficulty tiers: Beginner, Casual, Club, Pro, Superhuman
- AI powered by dedicated engines (KataGo for Go, Fairy-Stockfish for Chess/Janggi)
- AI coaching via Claude Code CLI: move explanations, tactical tips, phase detection
- Engine suggestions panel: top-3 moves with win rates / centipawn scores
- Post-game review with AI-generated summary
- Game stats tracked locally and (when logged in) on server

### Multiplayer (Secondary)
- Share a link to invite someone to play
- Real-time moves over WebSocket
- Optional time controls (untimed, blitz, rapid, classical)
- Spectator mode
- Reconnection on disconnect (grace period)
- No matchmaking queue initially — just create/join via link

### AI Coaching (Claude Code CLI)
- Real-time: after each move, get a brief analysis
- Game phase detection (opening/middlegame/endgame)
- Move quality hints (blunder/mistake/good/brilliant)
- Technical terms auto-highlighted with glossary tooltips
- Multi-language: English, Korean, Spanish, Vietnamese, Mongolian
- All LLM calls via `claude --print` — no API keys, no external services
- Graceful degradation: game works fine without analysis

### User Experience
- Responsive: mobile-first (375px), tablet (768px), desktop (1024px+)
- Touch-friendly: 44px minimum tap targets
- 6 themes: Midnight, Twilight, Sakura, Ocean, Timber, Frost
- 5 languages
- Sound effects (moves, captures, check, game end)
- Move history panel with clickable navigation
- Captured pieces display

### Persistence
- Works without an account (settings in localStorage)
- Optional accounts for cross-device sync, game history, ratings
- SQLite on server — added when account system is built, not before

## Non-Functional

- **Latency**: < 100ms move propagation in multiplayer
- **Engine sharing**: single KataGo + Fairy-Stockfish pool for all sessions
- **Graceful degradation**: AI analysis is optional; engines are required only for AI opponents
- **Security**: server-side move validation in multiplayer, input sanitization
- **Deployment**: single server, PM2 managed, dev/prod modes via start.sh
