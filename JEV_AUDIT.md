# Jev Audit — Tess

> Which LLM calls in Tess are really decisions, and where would a typed decision make crude code smarter?
> Generated 2026-09-27 · Scanner hits: 1 file · Call sites reviewed: 3 LLM calls + 5 heuristic sites · jev-audit

## 1. Executive summary

- LLM call sites: **3**, all through one wrapper, `packages/server/src/gateway.ts:7` (`callGateway`, apicascade economy, no escalation).
- **0 Replace · 0 Split · 0 Hybrid · 3 Keep LLM · 5 Pure code (already code, correctly) · 0 Leave-alone migrations.**
- No site is worth moving to Jev. Every LLM call produces prose that the player reads; no code branches on its output. Every non-LLM decision is numeric over engine output, and the engines (Fairy-Stockfish, KataGo) are the right authority for those.
- Traffic: **zero** Tess requests in the gateway routing log (`~/.hermes/weft/routing-events.jsonl` and `.1`, 2026-09-2x). The only coaching record in PM2 logs is one failure from 2026-08-14 (invalid Gemini key). Even a good candidate would have nothing to save today.
- Best quick win: none for Jev. The one improvement found is pure code (§3.4): check coaching text against the move record before emitting it.

## 2. Inventory

| # | Location | Model | Job of the call | Calls/day | Tier |
|---|---|---|---|---|---|
| 1 | `packages/server/src/ai.ts:146`, `:169` (`analyzePosition`) | apicascade economy, job `position-coaching` | Three-section coaching prose per move (opponent intent, best move, position) in 5 languages | 0 observed | Keep LLM |
| 2 | `packages/server/src/ai.ts:223` (`generateGameSummary`), called from `gameRoom.ts:693`, `postGameEval.ts:237/250` | apicascade economy, job `game-summary` | 3–4 sentence post-game review | 0 observed | Keep LLM |
| 3 | `packages/shared/src/evaluation.ts:82` (`classifyMoveQuality`) | none | cpLoss → best/good/ok/inaccuracy/mistake/blunder | per move | Pure code |
| 4 | `packages/shared/src/evaluation.ts` (`SKILL_SCALE`, `getSkillLevel`) | none | ACPL → skill tier, calibrated per game | per game | Pure code |
| 5 | `packages/server/src/ai.ts:20` (`getPhase`) | none | Move count → opening/middle/end phase | per coaching call | Pure code (see §3.5) |
| 6 | `packages/shared/src/openings.ts:268` (`detectOpening`) | none | Move prefix → ECO opening name | per move | Pure code |
| 7 | `packages/server/src/multiplayerRoom.ts:277` (`PRESET_EMOJIS`) and i18n chat keys | none | Whitelist of chat/emoji payloads | per message | Pure code (security) |

## 3. Tier detail

### 3.1 Replace — none

No call's output is a label, yes/no, score or route consumed by code.

### 3.2 Hybrid — none worth building

The candidate seam was "Jev decides whether this move deserves a coaching card, LLM writes only those". Code already has that signal exactly: `classifyMoveQuality` from engine centipawn loss. A text model judging "is this move interesting" would be a worse copy of an engine measurement. If card volume ever needs trimming, gate on `lastQuality` in `gameRoom.ts` (pure code), not on Jev.

### 3.3 Keep on LLM

- **position-coaching** — the product is the explanation itself, localized, under 120 words. Generation by definition.
- **game-summary** — same: prose for a human, no branching on output.

### 3.4 Pure code — keep, and one addition

The engine-derived decisions (#3–#7) are exact functions of measured numbers or whitelists. Deterministic beats any model here, and Jev is text-only with no board reasoning, so it cannot out-judge an engine eval.

**Addition worth considering (not Jev):** the coaching prompt says "do not invent moves that are not in the record", but nothing checks it. A deterministic post-check can extract SAN/coordinate tokens from the reply and compare them against `history` plus the engine PVs; drop or regenerate a card that cites a move in neither. This is the "LLM writes, something verifies" pattern with a code verifier, which beats a Jev verifier because the rule can be written down.

### 3.5 Needs owner judgment

- `getPhase` uses fixed move-count thresholds (`ai.ts:8`). A material- or stone-count rule would be more accurate for chess/janggi endgames, but that is still pure code, and it only flavours prompt text. Low value; only if coaching quality comes up.

## 4. Target architecture

No change. Current flow is already the recommended layering:

```
engine (UCI / KataGo)  →  code: cpLoss, quality, accuracy, skill, opening   [decisions]
                       →  gateway economy LLM: coaching + summary prose       [generation]
```

There is no Jev layer to insert between them.

## 5. Savings estimate

Not applicable: no Replace set, and zero observed traffic.

## 6. Migration order

None. Revisit only if a future feature makes code branch on model output — for example auto-tagging a game's theme for a lesson library, or routing a player's free-text question (rules question vs. position question vs. off-topic). Those would be Jev `choice` questions with an escape option.

## Leave alone

Both LLM jobs, by tier (generation) and by traffic (none recorded in the gateway log). Re-audit after the isolated `weft-tess` service has run with real players and `routing-events.jsonl` shows `project: "tess"` volume.
