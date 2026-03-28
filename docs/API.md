# REST API Reference

Tess exposes a small REST API via Hono. All endpoints return JSON unless otherwise noted.

**Base URL**: `http://localhost:8082` (configurable via `PORT` env var)

---

## Health & Admin

### GET /api/health

Server health check. Use for monitoring and load balancer probes.

**Response** `200 OK`

```json
{
  "status": "ok",
  "uptime": 3600,
  "activeGames": 2,
  "memoryMB": 45
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` |
| `uptime` | number | Server uptime in seconds |
| `activeGames` | number | Number of active game rooms |
| `memoryMB` | number | Heap memory usage in MB |

---

### GET /api/admin

Detailed server statistics.

**Response** `200 OK`

```json
{
  "uptime": 3600,
  "activeGames": 2,
  "memory": {
    "heapUsed": 45,
    "heapTotal": 64,
    "rss": 120
  },
  "pid": 12345,
  "nodeVersion": "v22.0.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `uptime` | number | Server uptime in seconds |
| `activeGames` | number | Active game room count |
| `memory.heapUsed` | number | V8 heap used (MB) |
| `memory.heapTotal` | number | V8 heap total (MB) |
| `memory.rss` | number | Resident set size (MB) |
| `pid` | number | Server process ID |
| `nodeVersion` | string | Node.js version |

---

## Game History

### GET /api/games

List recent completed games.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Maximum number of games to return |
| `type` | string | — | Filter by game type: `chess`, `go`, `janggi` |
| `user` | string | — | Filter by user ID (matches white or black player) |

**Example Request**

```
GET /api/games?limit=5&type=chess
```

**Response** `200 OK`

```json
{
  "games": [
    {
      "id": "abc123",
      "game_type": "chess",
      "white_user_id": "user-1",
      "black_user_id": null,
      "difficulty": "club",
      "result": "white",
      "result_reason": "checkmate",
      "moves": "[{\"uci\":\"e2e4\",\"san\":\"e4\"}, ...]",
      "pgn": "1. e4 e5 2. Nf3 ...",
      "board_size": null,
      "accuracy_white": 87,
      "accuracy_black": 62,
      "acpl_white": 35,
      "acpl_black": 92,
      "skill_label": "Club",
      "skill_rating": "~1600",
      "game_summary": "A solid game with a tactical finish...",
      "move_count": 42,
      "duration_ms": 180000,
      "completed_at": "2026-03-28T12:00:00Z"
    }
  ]
}
```

---

### GET /api/games/:id

Get a single game by ID.

**Response** `200 OK`

```json
{
  "game": {
    "id": "abc123",
    "game_type": "chess",
    "...": "same fields as list response"
  }
}
```

**Response** `404 Not Found`

```json
{
  "error": "Game not found"
}
```

---

### GET /api/games/:id/export

Export a game in standard notation format.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | Auto | `pgn` for Chess/Janggi, `sgf` for Go. Auto-detected from game type if omitted. |

**Example**: Export chess game as PGN

```
GET /api/games/abc123/export?format=pgn
```

**Response** `200 OK`

```
Content-Type: application/x-chess-pgn
Content-Disposition: attachment; filename="abc123.pgn"

1. e4 e5 2. Nf3 Nc6 ...
```

**Example**: Export Go game as SGF

```
GET /api/games/def456/export?format=sgf
```

**Response** `200 OK`

```
Content-Type: application/x-go-sgf
Content-Disposition: attachment; filename="def456.sgf"

(;GM[1]FF[4]SZ[19]DT[2026-03-28]AP[Tess]RE[B+R];B[pd];W[dd]...)
```

If the requested format is unavailable, the response falls back to JSON.

**Response** `404 Not Found`

```json
{
  "error": "Game not found"
}
```

---

## Users

### POST /api/users

Register or update an anonymous user.

**Request Body**

```json
{
  "id": "user-abc123",
  "displayName": "Player 1",
  "browserKey": "optional-browser-fingerprint"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique user identifier |
| `displayName` | string | Yes | Display name |
| `browserKey` | string | No | Browser fingerprint for session tracking |

**Response** `200 OK`

```json
{
  "ok": true
}
```

**Response** `400 Bad Request`

```json
{
  "error": "id and displayName required"
}
```

If the user already exists, `last_seen` is updated.

---

### GET /api/users/:id/stats

Get player statistics.

**Response** `200 OK`

```json
{
  "gamesPlayed": 15,
  "wins": 8,
  "losses": 5,
  "draws": 2,
  "avgAccuracy": 74
}
```

| Field | Type | Description |
|-------|------|-------------|
| `gamesPlayed` | number | Total completed games |
| `wins` | number | Games won |
| `losses` | number | Games lost |
| `draws` | number | Games drawn |
| `avgAccuracy` | number or null | Average accuracy percentage across all games, or null if no accuracy data |

---

## WebSocket Protocol

The real-time game protocol runs over WebSocket, not REST. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full message schema.

**Endpoint**: `ws://localhost:8082/game-ws`

All messages are JSON with a `type` discriminator field, validated by Zod schemas.

### Client to Server

| Type | Description |
|------|-------------|
| `NEW_GAME` | Start a new game (gameType, difficulty, color) |
| `JOIN_GAME` | Join an existing game by ID |
| `PLAY_MOVE` | Submit a move |
| `RESIGN` | Resign the current game |
| `PASS` | Pass (Go only) |
| `REQUEST_ANALYSIS` | Request AI coaching analysis |

### Server to Client

| Type | Description |
|------|-------------|
| `GAME_STATE` | Full game state (sent on connect/reconnect) |
| `MOVE` | Confirmed move with updated state |
| `GAME_OVER` | Game result with reason |
| `ANALYSIS` | AI coaching text |
| `SUGGESTIONS` | Engine move suggestions |
| `ERROR` | Error message |

---

## CORS

All API endpoints have CORS enabled (all origins allowed). In production behind a reverse proxy, configure CORS at the proxy level instead.

## Static Files

In production, the server serves the built Svelte client from `packages/client/dist/` at the root path. All unmatched routes fall back to `index.html` for client-side routing.
