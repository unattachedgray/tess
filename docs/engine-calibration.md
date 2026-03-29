# Engine Calibration Experiments

How we found the right approach for simulating different Elo levels in autoplay for each game engine (Fairy-Stockfish for Chess/Janggi, KataGo for Go), and how we score game quality accurately.

## The Problem

When two autoplay bots play at different Elo settings (e.g., 800 vs 2200), the post-game evaluation should clearly differentiate them — the 800-Elo player should be rated as a beginner while the 2200 should be rated as an expert. This requires two things:
1. **The weak player must actually play weak moves** (not just slightly suboptimal ones)
2. **The scoring system must detect the quality difference**

Both proved surprisingly hard.

---

## Part 1: Making the Engine Play Weak Moves

### Attempt 1: Reduced Movetime (Chess/Janggi)
**Approach**: Give Fairy-Stockfish less thinking time for lower Elo. 800 Elo → 10ms, 2200 Elo → 1000ms.

**Result**: Failed. Fairy-Stockfish reaches depth 12 even at 10ms. At that depth, it still finds near-perfect moves for Janggi. Both players got 96-98% accuracy.

**Why**: Modern chess engines use hash tables and fast evaluation. Even minimal time produces strong play for positions where good moves are "obvious" to the engine.

### Attempt 2: UCI_LimitStrength + UCI_Elo (Chess/Janggi)
**Approach**: Use Fairy-Stockfish's built-in `UCI_LimitStrength` and `UCI_Elo` options, which make the engine deliberately introduce errors calibrated to a target Elo.

**Result**: Partially worked but created a scoring problem. The same UCI_Elo was used for both playing moves AND evaluating positions. When the 800-Elo engine evaluates its own bad moves, it doesn't see them as bad — so ACPL was near 0 for both players.

**Key insight**: The engine that plays the move must be different from the engine that scores the move. Weak play + strong scoring.

### Attempt 3: Pick from Top-3 Engine Suggestions (Chess/Janggi)
**Approach**: Run the engine at full strength with 3 MultiPV suggestions. Lower Elo picks the 2nd or 3rd best move instead of the 1st.

**Result**: Failed. The top 3 moves at full strength are all very good (within 30cp of each other). Even the "worst" of three great moves doesn't create meaningful weakness. 800 Elo (93%) was barely distinguishable from 2200 Elo (88%).

**Why**: Full-strength engine suggestions are pre-filtered for quality. The 3rd-best move at 1000ms is still an excellent move.

### Attempt 4: Two-Pass Analysis with Shallow MultiPV ✅ (Final — Chess/Janggi)
**Approach**:
- **Pass 1 (weak, 50ms)**: Run engine with 10 MultiPV at shallow depth. This produces 10 moves ranked by quality, where the bottom-ranked moves are genuinely bad.
- **Pass 2 (control, 300ms)**: Run engine at full strength with 1 suggestion for accurate position evaluation.

Elo determines which rank to pick from the 10 moves:
- 800 → rank 9 (worst), 1200 → rank 6, 1600 → rank 4, 2200 → rank 0 (best)
- ±1 random variance added for realism

**Result**: Works well. The 50ms depth produces meaningful rank differentiation — the 10th best move at depth 8-10 is often a genuine mistake. The 300ms control search accurately identifies these as blunders/mistakes.

**Key numbers (Janggi)**:
| Elo | ACPL | Skill Label |
|-----|------|-------------|
| 800 | 175 | Intermediate |
| 1200 | 125 | Advanced |
| 1600 | 113 | Advanced |
| 2200 | 54 | Master |

### Go: All Movetime Approaches Failed
KataGo uses a neural network that produces strong move priors even with zero search. At 1ms/5ms/10ms/50ms with 10 MultiPV, all 10 candidate moves were still good because the policy network already knows which moves are playable.

### Attempt 5: Random Moves for Go ✅ (Final — Go)
**Approach**: For lower Elo, mix in random board intersections instead of engine moves.
- 800 Elo → 80% random intersections, 20% engine
- 1200 Elo → 50% random
- 1600 Elo → 20% random
- 2200 Elo → 0% random (pure engine)

The engine portion uses KataGo at 10ms with rank selection for additional weakness when not playing randomly.

**Result**: Dramatic quality difference. Random moves in Go are genuinely terrible (playing in your opponent's territory, ignoring critical fights, etc.)

---

## Part 2: Scoring Game Quality Accurately

### Attempt 1: Win-Percentage Accuracy (Lichess formula)
**Approach**: Use the standard Lichess accuracy formula: convert centipawn evaluations to win%, compute per-move accuracy from win% change, take harmonic/arithmetic mean.

**Result (Chess/Janggi)**: Accuracy was too forgiving. 800 Elo got 88% accuracy and 2200 Elo got 92% — only 4pp difference. The formula saturates at extreme evaluations: once you're losing by 2000cp, a further 500cp blunder changes win% from 0.1% to 0.05%, which the formula sees as "100% accurate."

**Result (Go)**: Completely broken. All players got 98-100% accuracy regardless of Elo. KataGo's winrate saturates even faster than chess (game decided after 4 bad moves).

### Attempt 2: ACPL with Aggressive Penalty ✅ (Final — Chess/Janggi)
**Approach**: Use Average Centipawn Loss (ACPL) as the primary metric for skill labels instead of accuracy. ACPL measures the raw quality of moves without the win% saturation problem.

Early iterations had the ACPL penalty too aggressive (2200 Elo with 95% accuracy and 134 ACPL mapped to "Beginner" because of a runaway penalty formula). The final formula uses ACPL directly for tier assignment:

| ACPL | Label |
|------|-------|
| ≤15 | Engine (2800+) |
| ≤35 | Grandmaster |
| ≤60 | Master |
| ≤100 | Expert |
| ≤150 | Advanced |
| ≤220 | Intermediate |
| ≤320 | Casual |
| >320 | Beginner |

### Attempt 3: Winrate-Based Scoring for Go (Failed)
**Approach**: Use KataGo's `(winrate - 0.5) * 2000` as centipawn-equivalent score.

**Result**: ACPL = 0 for everyone. Once the position is decided (winrate 99%+), all subsequent moves produce the same win%, so there's no measurable loss.

Tried 5x amplification multiplier — still ACPL = 0 because 5 × 0 = 0.

### Attempt 4: ScoreLead-Based Scoring for Go (Partially worked)
**Approach**: Use KataGo's `scoreLead` (estimated point difference on the board) instead of `winrate`. `scoreLead * 100` gives centipawn equivalents that don't saturate — a 50-point lead vs 100-point lead is a real difference.

**Result**: ACPL was still 0 when using the standard `gameAccuracy()` function, because that function internally uses `winPercent()` which saturates the converted values anyway.

### Attempt 5: Direct ACPL from ScoreLead ✅ (Final — Go)
**Approach**: Bypass the `gameAccuracy()` function entirely for Go. Compute ACPL directly from raw scoreLead-based evals:

```
cpLoss = max(0, evalBefore_playerPOV - evalAfter_playerPOV)
ACPL = average(cpLoss for all player's moves after opening)
```

**Critical bug found**: Go has black moving first, so odd-indexed evals are black's moves and even-indexed are white's. This is opposite to chess (white first). The initial implementation had the wrong parity, attributing black's moves to white and vice versa — producing ACPL=0 for the wrong player.

**Result after fixing parity**:
| Elo | ACPL | Skill Label |
|-----|------|-------------|
| 800 | 409 | Beginner (16+ kyu) |
| 1200 | 262 | Low Kyu (9-15 kyu) |
| 1600 | 397 | Low Kyu (9-15 kyu) |
| 2200 | 64 | Dan (1-3 dan) |

---

## Part 3: Autoplay Termination

### Problem: Games That Never End
Autoplay games would enter infinite loops — especially in Janggi where the engine found perpetual check patterns or repeated positions without the game detecting a draw.

### Solution: Multi-Layer Termination
1. **Move repeat**: Same move suggested 2+ times in last 4 moves → stop + resign in MP
2. **Position repeat**: Same FEN seen twice in last 10 positions (skip for Go — FEN is always empty)
3. **Drawn position**: Score=0 at depth 25+ after 40 moves
4. **Hopeless loss**: Score below threshold for N consecutive moves
   - Chess/Janggi: < -500 for 3 moves after move 20
   - Go: < -400 for 5 moves after move 60 (Go games are longer, positions swing more)
5. **Pass while losing** (Go only): If engine suggests PASS but score < -200 after move 100 → resign
6. **No legal moves**: Engine returns empty suggestions → server auto-resigns

### Problems Found:
- At 1ms search time, engine returned invalid moves like `e2e2` (same-square) → added filter
- Go FEN is always `""`, causing every position to match as "repeat" → use move-count+move-name as key instead
- Loss streak counter reset too aggressively — changed to slow decay (subtract 1 instead of reset to 0) so occasional good evals don't fully reset the counter

---

## Summary of Final Methods

| Game | Weak Play Method | Scoring Method | Control Search |
|------|-----------------|----------------|----------------|
| Chess | 50ms 10-MultiPV, pick by Elo rank | ACPL from standard gameAccuracy() | 300ms |
| Janggi | 50ms 10-MultiPV, pick by Elo rank | ACPL from standard gameAccuracy() | 300ms |
| Go | Random moves (80%@800, 0%@2200) | Direct ACPL from scoreLead evals | 800ms |

### Files Modified
- `packages/server/src/ws.ts` — Two-pass analysis, weak move generation, eval accumulation
- `packages/server/src/session.ts` — analyzeFen with movetime/eloLimit params, Go scoreLead scoring
- `packages/server/src/postGameEval.ts` — Instant SKILL_EVAL from accumulated evals, Go-specific ACPL
- `packages/server/src/multiplayerRoom.ts` — positionEvals accumulation, broadcastMessage
- `packages/shared/src/evaluation.ts` — ACPL-primary skill labels for all games
- `packages/client/src/App.svelte` — Autoplay move selection, repetition detection, resignation logic
- `test-mp-autoplay.cjs` — Automated test harness for running Elo matchups
