# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in Tess, please report it responsibly.

**Email**: Open a private issue or contact the maintainer directly. Do not open a public issue for security vulnerabilities.

When reporting, include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You can expect an initial response within 72 hours.

## Scope

### In Scope

- **Server-side move validation bypass** — Tess uses authoritative server validation for all game moves. Any way to submit illegal moves that the server accepts is a valid finding.
- **WebSocket message injection** — Crafted messages that crash the server, corrupt game state, or affect other users' sessions.
- **SQL injection** — The SQLite database uses parameterized queries, but any bypass is in scope.
- **Path traversal** — Access to files outside the intended static file root or data directory.
- **Denial of service** — Resource exhaustion through the WebSocket protocol, engine pool, or API endpoints.
- **Cross-site scripting (XSS)** — Injection of scripts through game data, usernames, or API responses.
- **Engine process escape** — Any way to execute arbitrary commands through the engine adapters (UCI/GTP protocol injection).

### Out of Scope

- **AI coaching content quality** — Claude CLI output is not sanitized for correctness, only for safety. Inaccurate game advice is not a security issue.
- **Engine binary vulnerabilities** — Fairy-Stockfish and KataGo are third-party binaries. Report those to their respective projects.
- **Local development environments** — Attacks that require local access to the development machine.
- **Social engineering** — Tricking users into sharing game links is not in scope.

## Architecture Security Notes

### Server Validation

All game moves are validated server-side using shared game logic before being applied. The client sends moves, but the server is the authority. This applies to both singleplayer (vs AI) and multiplayer modes.

### Engine Communication

Engines run as child processes communicating over stdin/stdout using UCI (Fairy-Stockfish) and GTP/JSON (KataGo) protocols. Input to engines is constructed from validated game state, not from raw user input.

### Database

SQLite with WAL mode. All queries use parameterized statements via better-sqlite3. The database file is stored in `data/tess.db` and should not be publicly accessible.

### WebSocket Protocol

All WebSocket messages are validated against Zod schemas before processing. Unknown message types are rejected. Each client has an isolated session.

### Static File Serving

In production, the Hono server serves the built Svelte client from `packages/client/dist/`. No directory listing is enabled.

### Dependencies

- Run `pnpm audit` periodically to check for known vulnerabilities in dependencies.
- Engine binaries are gitignored and must be obtained separately from their official sources.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
