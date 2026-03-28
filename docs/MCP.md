# MCP Server

Tess includes a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that exposes board game engines as tools for Claude and other AI agents.

## Starting the MCP Server

```bash
pnpm --filter server mcp
```

This runs the MCP server on stdio, which is the standard transport for local MCP integrations.

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration (`~/.config/claude-desktop/config.json` on Linux, `~/Library/Application Support/Claude/config.json` on macOS):

```json
{
  "mcpServers": {
    "tess": {
      "command": "pnpm",
      "args": ["--filter", "server", "mcp"],
      "cwd": "/path/to/tess"
    }
  }
}
```

### Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "tess": {
      "command": "pnpm",
      "args": ["--filter", "server", "mcp"],
      "cwd": "/path/to/tess"
    }
  }
}
```

### Direct Invocation

The MCP server can also be run directly with tsx:

```bash
cd packages/server
npx tsx src/mcp.ts
```

## Available Tools

### new_game

Start a new board game session.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `game_type` | `"chess"` \| `"go"` \| `"janggi"` | Yes | Game type to play |
| `board_size` | number | No | Go board size: 9, 13, or 19 (default 19) |

**Example**

```
new_game(game_type: "chess")
```

**Response**

```json
{
  "game": "chess",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "pgn": "",
  "turn": "w",
  "halfmove": 0,
  "fullmove": 0,
  "check": false,
  "gameOver": false,
  "result": null,
  "opening": null
}
```

**Example (Go)**

```
new_game(game_type: "go", board_size: 9)
```

**Response**

```json
{
  "game": "go",
  "boardSize": 9,
  "turn": "black",
  "moveNumber": 0,
  "gameOver": false,
  "prisoners": { "black": 0, "white": 0 },
  "captures": { "black": 0, "white": 0 },
  "result": null,
  "kataGoMoves": []
}
```

---

### play_move

Play a move on the board.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `move` | string | Yes | Move in game-appropriate notation |

**Notation by game type**:
- **Chess**: UCI notation (`e2e4`, `g1f3`) or SAN (`e4`, `Nf3`, `O-O`)
- **Go**: GTP vertex notation (`Q16`, `D4`) or `pass`
- **Janggi**: Algebraic coordinates (`a1a2`, `e1e2`)

**Example**

```
play_move(move: "e2e4")
```

**Response** (success)

```json
{
  "game": "chess",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "pgn": "1. e4",
  "turn": "b",
  "halfmove": 1,
  "fullmove": 1,
  "check": false,
  "gameOver": false,
  "result": null,
  "opening": null
}
```

**Response** (illegal move)

```
Illegal move: e2e5
```

---

### get_position

Get the current board position with full game state.

**Parameters**: None

Returns the same position object as `new_game` and `play_move`, including FEN, turn, move count, game-over status, and result.

---

### get_legal_moves

List all legal moves in the current position.

**Parameters**: None

**Response** (Chess/Janggi)

Returns a map of source squares to arrays of target squares in UCI format:

```json
{
  "e2": ["e3", "e4"],
  "g1": ["f3", "h3"],
  "b1": ["a3", "c3"],
  "...": ["..."]
}
```

**Response** (Go)

```
Go: any empty intersection is legal (subject to ko rule and suicide prevention).
```

---

### get_opening

Identify the chess opening from the current move sequence.

**Parameters**: None

**Response** (recognized)

```
C50: Italian Game
```

**Response** (not recognized)

```
No recognized opening.
```

This tool only works with chess games. Uses the ECO (Encyclopaedia of Chess Openings) database with 172 openings.

---

### get_pgn

Export the current chess game in PGN format.

**Parameters**: None

**Response**

```
1. e4 e5 2. Nf3 Nc6 3. Bb5 a6
```

This tool only works with chess games.

---

## Usage Examples

### Play a Chess Game

```
1. new_game(game_type: "chess")
2. play_move(move: "e2e4")    → White plays e4
3. play_move(move: "e7e5")    → Black plays e5
4. play_move(move: "g1f3")    → White plays Nf3
5. get_opening()              → "C40: King's Knight Opening"
6. get_legal_moves()          → All legal moves for current side
7. get_pgn()                  → "1. e4 e5 2. Nf3"
```

### Play a Go Game

```
1. new_game(game_type: "go", board_size: 9)
2. play_move(move: "D4")     → Black places at D4
3. play_move(move: "F6")     → White places at F6
4. get_position()             → Board state with captures
5. play_move(move: "pass")   → Black passes
```

### Play a Janggi Game

```
1. new_game(game_type: "janggi")
2. play_move(move: "e2e3")   → Cho (red) moves
3. get_position()             → FEN, turn, check status
4. get_legal_moves()          → Legal moves by piece
```

## Notes

- The MCP server maintains a single game session. Starting a new game replaces the current one.
- The MCP server uses the shared game logic from `packages/shared/` for move validation. It does not connect to engine processes.
- No AI analysis or engine suggestions are available through MCP -- only game state management and move validation.
- The server name is `tess` and the version matches the package version.
