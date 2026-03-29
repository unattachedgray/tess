# Engine Calibration & Skill Evaluation

How we calibrate AI difficulty, evaluate player skill, and maintain a unified scale across all three games (Chess, Janggi, Go).

## Architecture: Single Source of Truth

All skill tiers, ACPL thresholds, and AI difficulty targets are defined in one place:

**`packages/shared/src/evaluation.ts` → `SKILL_SCALE`**

This array drives everything:
- Post-game skill labels (SKILL_EVAL message)
- Difficulty picker descriptions in the UI
- AI engine target Elo/visits per tier
- Client-side display (Home.svelte, Analysis.svelte)

Changing a threshold in SKILL_SCALE automatically updates evaluation, difficulty labels, and UI.

---

## Unified Skill Tiers

### Chess (Fairy-Stockfish UCI_LimitStrength)

| Tier | ACPL Threshold | Rating | AI Elo |
|------|---------------|--------|--------|
| Superhuman | ≤25 | 2800+ | Full strength |
| Pro+ | ≤45 | 2500-2800 | — |
| Pro | ≤75 | 2200-2500 | 2200 |
| Club+ | ≤120 | 1800-2200 | — |
| Club | ≤180 | 1600-1800 | 1600 |
| Casual+ | ≤260 | 1400-1600 | — |
| Casual | ≤350 | 1200-1400 | 1200 |
| Beginner | >350 | Under 1200 | 800 |

### Janggi (Fairy-Stockfish variant, separate calibration)

Janggi positions are more volatile (cannons, palace, jumping rules), producing higher ACPL for the same skill level.

| Tier | ACPL Threshold | Rating | AI Elo |
|------|---------------|--------|--------|
| Superhuman | ≤30 | 2800+ | Full strength |
| Pro+ | ≤55 | 2500-2800 | — |
| Pro | ≤90 | 2200-2500 | 2200 |
| Club+ | ≤140 | 1800-2200 | — |
| Club | ≤210 | 1600-1800 | 1600 |
| Casual+ | ≤300 | 1400-1600 | — |
| Casual | ≤400 | 1200-1400 | 1200 |
| Beginner | >400 | Under 1200 | 800 |

### Go (KataGo, recalibrated 2026-03-29)

Go ACPL thresholds are tighter than chess because KataGo multi-PV ranking produces narrower ACPL ranges than UCI engines. Thresholds calibrated from autoplay simulations using low-ranked multi-PV suggestions.

| Tier | ACPL Threshold | Rating | AI Visits |
|------|---------------|--------|-----------|
| Superhuman | ≤15 | 9 dan+ | 5000 |
| Pro+ | ≤30 | 4-6 dan | — |
| Pro | ≤60 | 1-3 dan | 1000 |
| Club+ | ≤100 | 1-3 kyu | — |
| Club | ≤150 | 4-8 kyu | 200 |
| Casual+ | ≤220 | 9-12 kyu | — |
| Casual | ≤300 | 13-15 kyu | 50 |
| Beginner | >300 | 16+ kyu | 10 |

---

## Weak Move Generation (How AI Plays at Lower Levels)

### Chess/Janggi: Two-Pass MultiPV Analysis

1. **Pass 1 (weak, 50ms)**: Search with 10 MultiPV at shallow depth. Produces 10 moves ranked by quality. Bottom-ranked moves are genuinely bad.
2. **Pass 2 (control, 300ms)**: Full-strength search for accurate position scoring and suggestion display.

Elo determines which rank to pick from the 10 moves:
- 800 → rank 6 (capped to avoid suicidal moves), 1200 → rank 4, 1600 → rank 2, 2200 → rank 0 (best)
- ±1 random variance for realism

### Go: KataGo Low-Ranked Multi-PV Suggestions

Previous approach (random intersections) was removed because it generated illegal moves on occupied intersections. Current approach:
- Request 8 candidate moves from KataGo with low visits (10)
- Pick from lower-ranked suggestions based on Elo: 800 → rank 7, 1200 → rank 4, 1600 → rank 2, 2200 → rank 0
- All suggested moves are guaranteed legal by KataGo
- Produces natural weakness (suboptimal shapes, missed fights) without suicidal play

---

## Scoring: ACPL as Primary Metric

### Why ACPL, Not Accuracy

Win-percentage accuracy (Lichess formula) saturates at extreme evaluations. Once a position is lost by 2000cp, a further 500cp blunder changes win% from 0.1% to 0.05% — the formula sees this as "100% accurate." This made 800 Elo (88%) nearly indistinguishable from 2200 Elo (92%).

ACPL (Average Centipawn Loss) measures raw move quality without saturation. A 500cp blunder is a 500cp blunder regardless of position.

### Chess/Janggi Scoring

Uses the standard `gameAccuracy()` function from `evaluation.ts`:
1. Replay game position by position with full-strength engine eval
2. Compute centipawn loss per move (eval before − eval after, from player's perspective)
3. Average over all moves after skipping opening (6 moves in SP, 3 in MP)

### Go Scoring

Bypasses `gameAccuracy()` due to winrate saturation. Computes ACPL directly from KataGo scoreLead-based evals:
```
cpLoss = max(0, evalBefore_playerPOV - evalAfter_playerPOV)
ACPL = average(cpLoss for all moves after opening)
```

Note: Go has black moving first, so odd-indexed evals are black's moves and even-indexed are white's (opposite to chess).

### SP vs MP Evaluation

- **Singleplayer**: Post-game replay evaluates every position with full engine strength. Most accurate ACPL.
- **Multiplayer**: Uses incrementally accumulated evals from during gameplay. Instant SKILL_EVAL (no replay needed). Slightly noisier ACPL, especially in lopsided games where weak opponent creates chaotic positions.

---

## Autoplay Simulation Results (2026-03-29)

### Validation: 5 Simultaneous Games

Ran 3 Go + 1 Chess + 1 Janggi games concurrently on i9-14900KF to validate:
- Multi-game engine isolation (separate UCI pools + KataGo)
- Skill scale accuracy across all three games
- No illegal moves or crashes

### Go Results (with KataGo multi-PV weak moves)

| Matchup | Blue ACPL | Blue Label | Red ACPL | Red Label | Gap |
|---------|-----------|------------|----------|-----------|-----|
| 800 vs 2200 | 344 | Beginner | 134 | Club | 42pp |
| 800 vs 2200 (run 2) | 192 | Casual+ | 74 | Club+ | 23pp |
| 1200 vs 1600 | 246/261 | Casual+/Casual+ | — | — | 3pp |
| 1600 vs 2800 | 194 | Casual+ | 51 | Pro | 29pp |

**Observations**:
- Wide Elo gaps (800v2200, 1600v2800) show clear differentiation
- Close Elo gaps (1200v1600) produce similar ACPL — KataGo multi-PV ranking doesn't differentiate well at narrow ranges (only 1 rank difference in the suggestion list)
- 2800 Elo gets ACPL 51 (Pro tier) — full-strength KataGo should be Superhuman, but MP accumulated evals are noisy in lopsided games

### Chess Results

| Matchup | Blue ACPL | Blue Label | Red ACPL | Red Label |
|---------|-----------|------------|----------|-----------|
| 800 vs 2200 | 230/291 | Casual+ | 78/117 | Club+ |
| 1200 vs 2200 | 182 | Casual+ | 65 | Pro |

### Janggi Results

| Matchup | Blue ACPL | Blue Label | Red ACPL | Red Label |
|---------|-----------|------------|----------|-----------|
| 800 vs 2200 | 293 | Casual+ | 34/105 | Pro+/Club+ |
| 1200 vs 2200 | 212 | Casual+ | 108 | Club+ |

---

## Autoplay Termination Logic

Games must terminate gracefully. Multi-layer detection:

1. **Move repeat**: Same move 2+ times in last 4 moves → resign (Chess/Janggi only; disabled for Go since same coordinate is valid at different board states)
2. **Position repeat**: Same FEN twice in last 10 positions (skip for Go)
3. **Drawn position**: Score=0 at depth 25+ after 40 moves
4. **Hopeless loss**: Score below threshold for N consecutive moves
   - Chess/Janggi: < -500 for 3 moves after move 20
   - Go: < -400 for 5 moves after move 60
5. **Pass while losing** (Go): PASS + score < -200 after move 100 → resign
6. **No legal moves**: Engine returns "(none)" → force game over

---

## File Reference

### Single Source of Truth
- `packages/shared/src/evaluation.ts` — `SKILL_SCALE`, `BEGINNER_TIER`, `getSkillLevel()`, `getDifficultyRating()`

### Engine Layer
- `packages/server/src/engine/gameEngine.ts` — `GameEngine` interface, `UciGameEngine`, `KataGoGameEngine`
- `packages/server/src/engine/difficulty.ts` — Derived from SKILL_SCALE (movetime, Elo limits, visit budgets)

### Game Rooms
- `packages/server/src/gameRoom.ts` — SP game via `IGame` + `GameEngine` polymorphism
- `packages/server/src/multiplayerRoom.ts` — MP game, incremental eval accumulation
- `packages/server/src/postGameEval.ts` — MP post-game SKILL_EVAL from accumulated evals

### Weak Move Generation
- `packages/server/src/ws.ts` — Two-pass analysis (weak 50ms + control 300ms), Elo rank selection

### Testing
- `test-mp-autoplay.cjs` — Automated test harness: `node test-mp-autoplay.cjs <game> <blueElo> <redElo>`
