---
name: Engine Elo Tuning & Evaluation System
description: How autoplay Elo simulation works for each game, scoring approach, and the pitfalls discovered during tuning
type: project
---

## Autoplay Elo System (MP multiplayer)

### Architecture: Two-Pass Analysis Per Move
1. **Weak search** (fast): generates a move the player will actually play
2. **Control search** (accurate): evaluates the position for scoring/ACPL

### Chess/Janggi (Fairy-Stockfish)
- **Weak search**: 50ms, 10 MultiPV. Pick move by rank based on Elo:
  - 800 Elo → rank 9 (worst), 1200 → rank 6, 1600 → rank 4, 2200 → rank 0 (best)
  - ±1 random variance for realism
  - Invalid moves (same-square like `e2e2`) filtered out
- **Control search**: 300ms, 1 suggestion, full strength
- **UCI_Elo**: NOT used — it doesn't differentiate enough for Janggi. The MultiPV rank approach works better.
- **Scoring**: ACPL-primary for skill labels. Accuracy formula (winPercent-based) is too forgiving for one-sided games.

### Go (KataGo)
- **Weak search**: Mix of random moves + engine moves
  - 800 Elo → 80% random intersections, 20% engine rank
  - 1200 Elo → 50% random, 1600 → 20%, 2200 → 0%
  - KataGo's neural network is too strong at any time setting — even 1ms produces good moves
- **Control search**: 800ms, 1 suggestion (Go needs more visits than chess)
- **Scoring**: Uses `scoreLead * 100` instead of `(winrate - 0.5) * 2000`
  - **Why**: winrate saturates at 0%/100% after a few bad moves, making ACPL=0 for everyone
  - scoreLead (points on board) doesn't saturate: -50 points vs -100 points is a real difference
- **Move parity**: Black moves first in Go! evals[1] = after black's move (odd = black, even = white). Opposite of chess.
- **ACPL computation**: Custom direct computation in postGameEval.ts, bypasses `gameAccuracy()` which uses `winPercent()` that saturates
- **Resignation**: Score < -400 for 5 consecutive moves after move 60. Also resign instead of passing when losing (score < -200 after move 100).

### Skill Labels (ACPL-primary)
Chess/Janggi:
| ACPL | Label | Rating |
|------|-------|--------|
| ≤15 | Engine | 2800+ |
| ≤35 | Grandmaster | 2500-2700 |
| ≤60 | Master | 2200-2500 |
| ≤100 | Expert | 2000-2200 |
| ≤150 | Advanced | 1800-2000 |
| ≤220 | Intermediate | 1500-1800 |
| ≤320 | Casual | 1200-1500 |
| >320 | Beginner | Under 1200 |

Go (same ACPL ranges but Go-specific labels):
| ACPL | Label | Rating |
|------|-------|--------|
| ≤20 | Pro | 9 dan+ |
| ≤50 | High Dan | 4-6 dan |
| ≤100 | Dan | 1-3 dan |
| ≤160 | High Kyu | 1-3 kyu |
| ≤250 | Mid Kyu | 4-8 kyu |
| ≤400 | Low Kyu | 9-15 kyu |
| >400 | Beginner | 16+ kyu |

### Test Results (verified)
Janggi 800 vs 2200: Intermediate (ACPL 175) vs Grandmaster (ACPL 54) ✓
Go 800 vs 2200: Beginner (ACPL 409) vs Dan (ACPL 64) ✓
Go 1200 vs 2200: Low Kyu (ACPL 262) vs Dan (ACPL 64) ✓
Go 1600 vs 2200: Low Kyu (ACPL 397) vs High Kyu (ACPL 151) ✓

### Key Pitfalls Discovered
1. **UCI_Elo doesn't work well for Janggi** — Fairy-Stockfish at depth 12 even at 10ms
2. **KataGo is too good at any time setting** — neural network policy already strong at 1ms
3. **winrate-based scoring saturates** — once a position is decided, ACPL=0 for everyone
4. **Go has opposite move parity** — black moves first (odd evals = black, even = white)
5. **Accuracy formula is too forgiving** — use ACPL as primary metric, not accuracy
6. **Random moves in Go can hit occupied intersections** — need validation

### Test Script
`node test-mp-autoplay.cjs <game> <blueElo> <redElo>`
Example: `node test-mp-autoplay.cjs janggi 800 2200`
