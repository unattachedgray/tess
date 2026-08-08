import {
	type DifficultyId,
	type GameType,
	type IGame,
	type MoveQuality,
	type Suggestion,
	ChessAdapter,
	GO_KOMI,
	GoAdapter,
	JanggiAdapter,
	accuracyFromMoves,
	classifyMoveQuality,
	detectOpening,
	gameAccuracy,
	getSkillLevel,
} from "@tess/shared";
import { type AnalysisContext, analyzePosition, generateGameSummary } from "./ai.js";
import { getElo } from "./engine/difficulty.js";
import { type GameEngine, createGameEngine } from "./engine/gameEngine.js";
import type { KataGoAdapter } from "./engine/katago.js";
import type { UciPool } from "./engine/uciPool.js";
import { createLogger } from "./logger.js";

const log = createLogger("game-room");

const AI_DELAY: Record<DifficultyId, [number, number]> = {
	beginner: [400, 800],
	casual: [300, 700],
	club: [200, 600],
	pro: [200, 500],
	superhuman: [100, 300],
};

function randomDelay(range: [number, number]): number {
	return range[0] + Math.random() * (range[1] - range[0]);
}

/** Coarse board-area i18n key for a Go coordinate (level-1 hints). */
function goAreaKey(coord: string, size: number): string {
	const GO_COLS = "ABCDEFGHJKLMNOPQRST";
	const x = GO_COLS.indexOf(coord[0]?.toUpperCase() ?? "");
	const row = Number.parseInt(coord.slice(1), 10);
	if (x < 0 || Number.isNaN(row)) return "hint.area.center";
	const third = (v: number) => (v < size / 3 ? 0 : v < (2 * size) / 3 ? 1 : 2);
	const horiz = ["Left", "", "Right"][third(x)];
	const vert = ["bottom", "middle", "top"][third(row - 1)];
	const key = `${vert}${horiz}`;
	return `hint.area.${key === "middle" ? "center" : key}`;
}

/** Create an IGame instance for the given game type. */
function createGame(gameType: GameType, boardSize?: number): IGame {
	switch (gameType) {
		case "chess":
			return new ChessAdapter();
		case "go":
			return new GoAdapter(boardSize ?? 19);
		case "janggi":
			return new JanggiAdapter();
	}
}

export class GameRoom {
	readonly id: string;
	readonly gameType: GameType;
	readonly difficulty: DifficultyId;
	readonly playerColor: "white" | "black";
	readonly userId: string | undefined;
	private game: IGame;
	private engine: GameEngine;
	private moveCallbacks: ((data: unknown) => void)[] = [];
	private moveInProgress = false;
	private destroyed = false;
	private lastSuggestions: Suggestion[] = [];
	/** moveCount the lastSuggestions were computed for — guards against stale baselines */
	private suggestionsMoveCount = -1;
	private analysisInFlight = false;
	private analysisPending = false;
	private analyzedMoves = new Set<number>(); // move numbers already coached
	private backfillTimer: ReturnType<typeof setTimeout> | null = null;
	// Per-player-move eval records (mover's POV) for incremental accuracy.
	// Unlike a raw eval array this makes no ply-parity assumption, so it stays
	// correct even though the engine only scores positions on the player's turns.
	private playerMoveEvals: { evalBefore: number; cpLoss: number }[] = [];
	/** Player move awaiting quality grading until the next engine pass */
	private pendingQuality: { move: string; preScore: number } | null = null;
	/** Most recent graded player move — feeds the coaching prompt */
	private lastQuality: { move: string; quality: MoveQuality; cpLoss: number } | null = null;
	private overrideResult: { winner: "white" | "black" | "draw"; reason: string; margin?: number } | null = null;
	private hintState = { moveCount: -1, level: 0 };
	coachingEnabled = true;
	suggestionCount = 3;
	suggestionStrength: "fast" | "balanced" | "deep" = "deep";
	language = "en";
	autoplay = false;
	autoplayHumanElo: number | null = null;
	private autoplayRunning = false;

	constructor(config: {
		id: string;
		gameType: GameType;
		difficulty: DifficultyId;
		playerColor: "white" | "black";
		uciPool: UciPool;
		kataGo: KataGoAdapter | null;
		boardSize?: number;
		useJanggiVariant?: boolean;
		userId?: string;
	}) {
		this.id = config.id;
		this.gameType = config.gameType;
		this.difficulty = config.difficulty;
		this.playerColor = config.playerColor;
		this.userId = config.userId;
		this.game = createGame(config.gameType, config.boardSize);
		this.engine = createGameEngine(
			config.gameType,
			config.uciPool,
			config.kataGo,
			config.useJanggiVariant,
		);
	}

	onMove(cb: (data: unknown) => void): void {
		this.moveCallbacks.push(cb);
	}

	private emit(data: unknown): void {
		if (this.destroyed) return;
		for (const cb of this.moveCallbacks) cb(data);
	}

	destroy(): void {
		this.destroyed = true;
		this.moveCallbacks = [];
		if (this.backfillTimer) clearTimeout(this.backfillTimer);
	}

	// --- State accessors ---

	/** Build GAME_STATE payload from IGame snapshot. */
	getState() {
		const snap = this.game.getSnapshot();
		const extra = snap.extra as Record<string, unknown>;
		const moveHistory = snap.moveHistory.map((m) => ({
			san: m.display,
			uci: m.notation,
			fen: m.position,
			moveNumber: m.moveNumber,
		}));

		const base = {
			type: "GAME_STATE" as const,
			gameId: this.id,
			gameType: this.gameType,
			fen: snap.fen,
			playerColor: this.playerColor,
			turn: snap.turn,
			legalMoves: snap.legalMoves,
			moveHistory,
			capturedPieces: snap.captured,
			isCheck: !!(extra.isCheck),
			...(extra.checkSquare ? { checkSquare: extra.checkSquare } : {}),
			isGameOver: this.game.isGameOver,
			result: this.game.getResult() ?? undefined,
			difficulty: this.difficulty,
			// Game-specific fields
			...(snap.boardState ? { boardState: snap.boardState } : {}),
			...(snap.boardSize ? { boardSize: snap.boardSize } : {}),
			...(extra.prisoners ? { prisoners: extra.prisoners } : {}),
			...(extra.pgn && this.gameType === "chess"
				? { opening: detectOpening(moveHistory.map((m) => m.uci)) ?? undefined }
				: {}),
		};

		return base;
	}

	/** Build per-move payload (sent after each MOVE). */
	private buildMovePayload() {
		const snap = this.game.getSnapshot();
		const extra = snap.extra as Record<string, unknown>;
		const moveHistory = snap.moveHistory.map((m) => ({
			san: m.display,
			uci: m.notation,
			fen: m.position,
			moveNumber: m.moveNumber,
		}));

		return {
			turn: snap.turn,
			legalMoves: snap.legalMoves,
			capturedPieces: snap.captured,
			isCheck: !!(extra.isCheck),
			...(extra.checkSquare ? { checkSquare: extra.checkSquare } : {}),
			isGameOver: this.game.isGameOver,
			result: this.game.getResult() ?? undefined,
			// Game-specific
			...(snap.boardState ? { boardState: snap.boardState } : {}),
			...(extra.prisoners ? { prisoners: extra.prisoners } : {}),
			...(extra.lastMove ? { lastStone: extra.lastMove } : {}),
			...(extra.pgn && this.gameType === "chess"
				? { opening: detectOpening(moveHistory.map((m) => m.uci)) ?? undefined }
				: {}),
		};
	}

	// --- Move handling ---

	async playMove(move: string): Promise<{ success: boolean; error?: string }> {
		if (this.moveInProgress) return { success: false, error: "Move in progress" };
		if (this.game.isGameOver || this.overrideResult) return { success: false, error: "Game is over" };
		if (this.game.turn !== this.playerColor) return { success: false, error: "Not your turn" };

		this.moveInProgress = true;
		try {
			// Baseline for grading: suggestions computed for THIS position, before the move
			const baseline = this.suggestionsMoveCount === this.game.moveCount ? this.lastSuggestions : [];

			const moveResult = this.executeMove(move);
			if (!moveResult) return { success: false, error: "Illegal move" };

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });
			this.gradePlayerMove(move, baseline);

			if (!this.game.isGameOver) {
				try {
					await this.makeAiMove();
				} catch (err) {
					log.error("AI move failed, skipping", { error: (err as Error).message });
					this.emit({ type: "ERROR", message: "AI failed to respond" });
				}
			}

			if (!this.game.isGameOver) {
				this.sendSuggestionsAndAnalysis();
			} else {
				await this.finalizeGameOver();
			}

			return { success: true };
		} finally {
			this.moveInProgress = false;
		}
	}

	/**
	 * Grade the player's move against the engine's pre-move suggestions.
	 * If the move is in the list, its cp-loss is known immediately. Otherwise
	 * grading is deferred: the next engine pass (after the AI reply) scores the
	 * player's next position, and the round-trip eval drop approximates cp-loss.
	 */
	private gradePlayerMove(move: string, baseline: Suggestion[]): void {
		if (baseline.length === 0) return;
		const normalize = (m: string) => m.toLowerCase().replace(/\s/g, "");
		const best = baseline[0].score;
		const match = baseline.find((s) => normalize(s.move) === normalize(move));
		if (match) {
			this.finishQuality(move, best, Math.max(0, best - match.score));
		} else {
			this.pendingQuality = { move, preScore: best };
		}
	}

	private finishQuality(move: string, evalBefore: number, cpLoss: number): void {
		const quality = classifyMoveQuality(cpLoss);
		this.lastQuality = { move, quality, cpLoss };
		this.playerMoveEvals.push({ evalBefore, cpLoss });
		this.emit({ type: "MOVE_QUALITY", move, quality });
	}

	/** Emit GAME_OVER (scoring drawn Go double-passes for real) + evaluation. */
	private async finalizeGameOver(): Promise<void> {
		let result = this.game.getResult();
		if (result && this.gameType === "go" && result.reason === "double pass") {
			result = await this.scoreGoGame();
			this.overrideResult = result; // summary + DB save use the scored result
		}
		if (result) {
			this.emit({ type: "GAME_OVER", result });
		}
		this.emitSkillEvaluation();
	}

	/** Score a finished Go game: KataGo's scoreLead (komi-aware), falling back to naive area count. */
	private async scoreGoGame(): Promise<{
		winner: "white" | "black" | "draw";
		reason: string;
		margin?: number;
	}> {
		try {
			// evaluate() returns scoreLead*100 from the side-to-move's perspective
			const score = await this.engine.evaluate(this.game);
			const lead = (this.game.turn === "black" ? score : -score) / 100; // black's POV, points
			if (Math.abs(lead) < 0.25) return { winner: "draw", reason: "score", margin: 0 };
			return {
				winner: lead > 0 ? "black" : "white",
				reason: "score",
				margin: Math.round(Math.abs(lead) * 2) / 2,
			};
		} catch (err) {
			log.warn("KataGo scoring failed, using naive count", { error: (err as Error).message });
			const inner = (this.game as { inner?: { scoreWithKomi?: (k: number) => { winner: "white" | "black" | "draw"; margin: number } } }).inner;
			const fallback = inner?.scoreWithKomi?.(GO_KOMI);
			if (!fallback) return { winner: "draw", reason: "double pass" };
			return { winner: fallback.winner, reason: "score", margin: fallback.margin };
		}
	}

	private executeMove(
		move: string,
	): { san: string; uci: string; fen: string; moveNumber: number } | null {
		const result = this.game.move(move);
		if (!result) return null;
		return {
			san: result.display,
			uci: result.notation,
			fen: result.position,
			moveNumber: result.moveNumber,
		};
	}

	// --- AI moves ---

	private async makeAiMove(): Promise<void> {
		const delay = randomDelay(AI_DELAY[this.difficulty]);

		try {
			const [aiMoveStr] = await Promise.all([
				this.engine.getAiMove(this.game, this.difficulty),
				new Promise((r) => setTimeout(r, delay)),
			]);

			let moveResult = this.executeMove(aiMoveStr);
			if (!moveResult) {
				// Never leave the game stuck on the AI's turn: fall back to any
				// legal move (Go: pass is always legal)
				log.error("AI produced illegal move, using fallback", {
					move: aiMoveStr,
					gameType: this.gameType,
				});
				const fallback =
					this.gameType === "go" ? "PASS" : this.firstLegalMove();
				moveResult = fallback ? this.executeMove(fallback) : null;
				if (!moveResult) throw new Error(`AI illegal move: ${aiMoveStr}`);
			}

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });
		} catch (err) {
			log.error("AI move failed", { error: (err as Error).message });
			throw err;
		}
	}

	private firstLegalMove(): string | null {
		const legal = this.game.getLegalMoves();
		for (const [from, tos] of Object.entries(legal)) {
			if (tos.length > 0) return `${from}${tos[0]}`;
		}
		return null;
	}

	// --- Suggestions & Analysis ---

	private sendSuggestionsAndAnalysis(): void {
		this.getSuggestions(this.suggestionCount)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.resolvePendingQuality();
				if (this.coachingEnabled) {
					this.scheduleAnalysis();
				}
			})
			.catch((err) => {
				log.error("suggestions failed", { error: (err as Error).message });
				this.emit({ type: "SUGGESTIONS", suggestions: [] });
			});
	}

	/**
	 * Finish grading a player move that wasn't in the suggestion list.
	 * lastSuggestions now scores the player's NEXT position, so the eval drop
	 * across the round (player move + AI reply) approximates the move's cp-loss.
	 * The AI can only give eval back, never take extra, so this under-penalizes
	 * slightly rather than inventing losses.
	 */
	private resolvePendingQuality(): void {
		if (!this.pendingQuality || this.lastSuggestions.length === 0) {
			this.pendingQuality = null;
			return;
		}
		const { move, preScore } = this.pendingQuality;
		this.pendingQuality = null;
		const newScore = this.lastSuggestions[0].score; // player's POV again
		this.finishQuality(move, preScore, Math.max(0, preScore - newScore));
	}

	/** Throttle coaching: analyze latest move first, then backfill
	 *  older unanalyzed moves when the player is idle. */
	private scheduleAnalysis(): void {
		// Cancel any pending backfill — player just moved, prioritize latest
		if (this.backfillTimer) {
			clearTimeout(this.backfillTimer);
			this.backfillTimer = null;
		}

		if (this.analysisInFlight) {
			this.analysisPending = true;
			return;
		}

		this.analysisInFlight = true;
		this.analysisPending = false;

		this.requestAnalysis().finally(() => {
			this.analysisInFlight = false;

			if (this.analysisPending && !this.game.isGameOver) {
				// Player moved again — analyze their latest position
				this.analysisPending = false;
				this.scheduleAnalysis();
			} else if (!this.game.isGameOver) {
				// Player is idle — schedule backfill for missed (or failed) moves
				this.backfillTimer = setTimeout(() => this.backfillAnalysis(), 5000);
			}
		});
	}

	/** Backfill coaching for older moves the player skipped past.
	 *  Runs one at a time with 3s gaps. Stops if player makes a new move. */
	private backfillAnalysis(): void {
		if (this.game.isGameOver || this.analysisInFlight || this.destroyed) return;

		const history = this.game.getSnapshot().moveHistory;
		// Find the most recent unanalyzed player move (skip AI moves)
		let targetMove: number | null = null;
		for (let i = history.length; i >= 1; i--) {
			if (this.analyzedMoves.has(i)) continue;
			// Only backfill player's moves (odd = white's move 1,3,5... even = black's 2,4,6...)
			const isPlayerMove = this.playerColor === "white" ? i % 2 === 1 : i % 2 === 0;
			if (!isPlayerMove) continue;
			// Skip opening moves (first 4)
			if (i <= 4) continue;
			targetMove = i;
			break;
		}

		if (targetMove === null) return; // all moves analyzed

		// requestAnalysis can only analyze the live position. If that position
		// is already covered, calling again would emit a duplicate of the
		// latest card and waste an API call — mark stale targets done instead.
		if (this.analyzedMoves.has(history.length)) {
			for (let i = 1; i <= history.length; i++) this.analyzedMoves.add(i);
			return;
		}

		this.analysisInFlight = true;
		const moveIdx = targetMove;
		this.requestAnalysis().then((delivered) => {
			// The delivered card covers the live position, which supersedes the
			// older target. On failure leave both unmarked so we retry later.
			if (delivered) this.analyzedMoves.add(moveIdx);
		}).finally(() => {
			this.analysisInFlight = false;

			if (this.analysisPending) {
				// Player moved — stop backfill, handle new move
				this.analysisPending = false;
				this.scheduleAnalysis();
			} else if (!this.game.isGameOver) {
				// Continue backfilling after a pause
				this.backfillTimer = setTimeout(() => this.backfillAnalysis(), 3000);
			}
		});
	}

	/** Returns true when a card was emitted (or the position was already covered). */
	private async requestAnalysis(): Promise<boolean> {
		const snap = this.game.getSnapshot();
		const extra = snap.extra as Record<string, unknown>;
		const history = snap.moveHistory;
		// Queued/backfill runs can land on a position that was already covered
		// when moves outpace the LLM — emitting again would duplicate the card.
		if (this.analyzedMoves.has(history.length)) return true;
		this.analyzedMoves.add(history.length);
		const lastEntry = history.length > 0 ? history[history.length - 1] : null;

		const ctx: AnalysisContext = {
			gameType: this.gameType,
			fen: snap.fen,
			moveCount: history.length,
			playerColor: this.playerColor,
			lastMove: lastEntry?.display,
			lastMoveColor: snap.turn === "white" ? "Black" : "White",
			suggestions: this.lastSuggestions,
			history: history.map((m) => m.display),
			pgn: extra.pgn as string | undefined,
			language: this.language,
			// What the player's own last move cost — lets the coach explain
			// mistakes concretely instead of guessing
			playerLastMove: this.lastQuality ?? undefined,
		};

		const moveNum = history.length;
		const text = await analyzePosition(ctx);
		if (text) {
			this.emit({ type: "ANALYSIS", text, moveNumber: moveNum, gameId: this.id });
			return true;
		}
		// Transient failure (Gemini overload etc.) — un-mark so a later
		// scheduleAnalysis/backfill pass retries instead of dropping the card.
		this.analyzedMoves.delete(moveNum);
		return false;
	}

	async getSuggestions(topN = 3) {
		// Always fetch at least the best move: it is the baseline for move
		// quality, accuracy, and hints even when the player hides suggestions.
		const fetchN = Math.max(1, topN);

		try {
			const suggestions = await this.engine.getSuggestions(
				this.game,
				fetchN,
				this.suggestionStrength,
			);

			// For UCI games, convert UCI notation to SAN if possible
			const extra = this.game.getSnapshot().extra as Record<string, unknown>;
			const uciToSan = extra.uciToSan as ((uci: string) => string | null) | undefined;
			if (uciToSan) {
				for (const s of suggestions) {
					const san = uciToSan(s.move);
					if (san) s.san = san;
				}
			}

			this.lastSuggestions = suggestions;
			this.suggestionsMoveCount = this.game.moveCount;

			return { type: "SUGGESTIONS" as const, suggestions: suggestions.slice(0, topN) };
		} catch (err) {
			log.error("suggestions failed", { error: (err as Error).message });
			return { type: "SUGGESTIONS" as const, suggestions: [] };
		}
	}

	/**
	 * Progressive hint from the engine's best move.
	 * First request on a position: level 1 (where to look — origin square, or
	 * board area for Go). Second request: level 2 (the full move).
	 */
	async getHint() {
		if (this.game.isGameOver || this.overrideResult) return null;
		const moveCount = this.game.moveCount;
		if (this.hintState.moveCount === moveCount) {
			this.hintState.level = Math.min(2, this.hintState.level + 1);
		} else {
			this.hintState = { moveCount, level: 1 };
		}

		if (this.suggestionsMoveCount !== moveCount || this.lastSuggestions.length === 0) {
			await this.getSuggestions(this.suggestionCount);
		}
		if (this.lastSuggestions.length === 0) return null;

		const best = this.lastSuggestions[0];
		const level = this.hintState.level;

		if (this.gameType === "go") {
			return {
				type: "HINT" as const,
				level,
				...(level >= 2
					? { move: best.move }
					: { area: goAreaKey(best.move, this.game.getSnapshot().boardSize ?? 19) }),
			};
		}

		const m = best.move.match(/^([a-i]\d{1,2})([a-i]\d{1,2})/);
		return {
			type: "HINT" as const,
			level,
			from: m?.[1] ?? best.move.slice(0, 2),
			...(level >= 2 ? { to: m?.[2] ?? best.move.slice(2, 4), move: best.move, san: best.san } : {}),
		};
	}

	/** Batch-analyze all positions after game ends to compute player accuracy */
	private emitSkillEvaluation(): void {
		this.batchEvalGame().catch((err) => {
			log.error("skill evaluation failed", { error: (err as Error).message });
		});
	}

	private async batchEvalGame(): Promise<void> {
		const snap = this.game.getSnapshot();
		const history = snap.moveHistory;
		if (history.length < 6) return;

		const skipMoves = this.autoplay ? 2 : 6;

		const flatHistory = history.map((m) => ({
			san: m.display,
			uci: m.notation,
			fen: m.position,
			moveNumber: m.moveNumber,
		}));

		// Instant path: per-move cp-losses accumulated during play. These are
		// sampled on the player's turns only, so no ply-parity assumption.
		const playerPlies = Math.ceil(history.length / 2);
		if (!this.autoplay && this.playerMoveEvals.length >= Math.max(4, playerPlies * 0.5)) {
			log.info("using incremental move evals", {
				collected: this.playerMoveEvals.length,
				playerPlies,
			});
			const playerResult = accuracyFromMoves(this.playerMoveEvals, skipMoves);
			await this.emitAndSummarize(playerResult, flatHistory);
			return;
		}

		// Fallback: replay the game (expensive but accurate); needed for
		// autoplay (both sides evaluated) and games with sparse coverage.
		log.info("replaying game for evals", {
			collected: this.playerMoveEvals.length,
			moves: history.length,
		});
		const replay = createGame(this.gameType, snap.boardSize);
		const evals: number[] = [0];
		for (const move of history) {
			replay.move(move.notation);
			try {
				const score = await this.engine.evaluate(replay);
				evals.push(score);
			} catch {
				evals.push(evals[evals.length - 1] ?? 0);
			}
		}

		const playerResult = gameAccuracy(evals, this.playerColor, skipMoves);
		if (this.autoplay) {
			const opponentColor = this.playerColor === "white" ? "black" : "white";
			const opponentResult = gameAccuracy(evals, opponentColor, skipMoves);
			await this.emitAndSummarize(playerResult, flatHistory, opponentResult);
		} else {
			await this.emitAndSummarize(playerResult, flatHistory);
		}
	}

	private async emitAndSummarize(
		result: { accuracy: number; acpl: number; moveAccuracies: number[] },
		history: { san: string; uci: string }[],
		opponentResult?: { accuracy: number; acpl: number; moveAccuracies: number[] },
	): Promise<void> {
		const accuracy = Math.round(result.accuracy);
		const skill = getSkillLevel(accuracy, this.gameType, result.acpl);

		log.info("skill evaluation", {
			accuracy,
			acpl: result.acpl,
			label: skill.label,
			moves: result.moveAccuracies.length,
			...(opponentResult
				? {
						opponentAccuracy: Math.round(opponentResult.accuracy),
						opponentAcpl: opponentResult.acpl,
					}
				: {}),
		});

		const evalPayload: Record<string, unknown> = {
			type: "SKILL_EVAL",
			accuracy,
			acpl: result.acpl,
			skill,
		};
		if (opponentResult) {
			const opAcc = Math.round(opponentResult.accuracy);
			evalPayload.opponentAccuracy = opAcc;
			evalPayload.opponentAcpl = opponentResult.acpl;
			evalPayload.opponentSkill = getSkillLevel(opAcc, this.gameType, opponentResult.acpl);
		}
		this.emit(evalPayload);

		// Game result via IGame
		// overrideResult wins: it carries resignations and scored Go results
		// that the raw game object doesn't know about
		const gameResult = this.overrideResult ?? this.game.getResult();
		const extra = this.game.getSnapshot().extra as Record<string, unknown>;

		const summary = await generateGameSummary({
			gameType: this.gameType,
			playerColor: this.playerColor,
			accuracy,
			acpl: result.acpl,
			skillLabel: skill.label,
			skillRating: skill.rating,
			totalMoves: history.length,
			result: gameResult
				? `${gameResult.winner === this.playerColor ? "Player wins" : gameResult.winner === "draw" ? "Draw" : "Player loses"} — ${gameResult.reason}`
				: "Unknown",
			pgn: (extra.pgn as string | undefined) ?? history.map((m) => m.san).join(" "),
			language: this.language,
			moveAccuracies: result.moveAccuracies,
		});

		if (summary) {
			this.emit({ type: "GAME_SUMMARY", text: summary });
		}

		// Save game to database
		try {
			const { saveGame } = await import("./db.js");
			saveGame({
				id: this.id,
				gameType: this.gameType,
				whiteUserId: this.playerColor === "white" ? (this.userId ?? undefined) : "ai",
				blackUserId: this.playerColor === "black" ? (this.userId ?? undefined) : "ai",
				difficulty: this.difficulty,
				result: gameResult?.winner,
				resultReason: gameResult?.reason,
				moves: history,
				pgn: extra.pgn as string | undefined,
				boardSize: this.game.getSnapshot().boardSize,
				accuracyWhite:
					this.playerColor === "white"
						? accuracy
						: opponentResult
							? Math.round(opponentResult.accuracy)
							: undefined,
				accuracyBlack:
					this.playerColor === "black"
						? accuracy
						: opponentResult
							? Math.round(opponentResult.accuracy)
							: undefined,
				acplWhite:
					this.playerColor === "white"
						? result.acpl
						: opponentResult
							? opponentResult.acpl
							: undefined,
				acplBlack:
					this.playerColor === "black"
						? result.acpl
						: opponentResult
							? opponentResult.acpl
							: undefined,
				skillLabel: skill.label,
				skillRating: skill.rating,
				gameSummary: summary ?? undefined,
				moveCount: history.length,
			});
		} catch (err) {
			log.error("failed to save game", { error: (err as Error).message });
		}
	}

	/** Run autoplay: both sides play as AI in rapid succession */
	async startAutoplay(humanElo: number | null): Promise<void> {
		this.autoplay = true;
		this.autoplayHumanElo = humanElo;
		if (this.autoplayRunning) return;
		this.autoplayRunning = true;

		const aiElo = getElo(this.difficulty);

		while (this.autoplay && !this.game.isGameOver && !this.destroyed) {
			const isHumanTurn = this.game.turn === this.playerColor;
			const elo = isHumanTurn ? (this.autoplayHumanElo ?? aiElo) : aiElo;

			try {
				let moveStr: string;

				if (isHumanTurn && elo !== null) {
					moveStr = await this.engine.getWeakMove(this.game, elo);
				} else {
					moveStr = await this.engine.getAiMove(this.game, this.difficulty);
				}

				// Engine returns "(none)" when no legal moves exist
				if (moveStr === "(none)") {
					log.info("autoplay: engine returned (none), ending game");
					// Force game over for games that don't auto-detect it
					const inner = (this.game as any).inner;
					if (inner?.forceGameOver) inner.forceGameOver();
					break;
				}

				const moveResult = this.executeMove(moveStr);
				if (!moveResult) {
					log.error("autoplay illegal move", { move: moveStr });
					break;
				}

				this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });
				await new Promise((r) => setTimeout(r, 150));
			} catch (err) {
				log.error("autoplay error", { error: (err as Error).message });
				break;
			}
		}

		this.autoplayRunning = false;

		if (this.game.isGameOver) {
			await this.finalizeGameOver();
		}
	}

	stopAutoplay(): void {
		this.autoplay = false;
	}

	get pgn(): string {
		const extra = this.game.getSnapshot().extra as Record<string, unknown>;
		return (extra.pgn as string) ?? "";
	}

	resign(color: "white" | "black") {
		const winner: "white" | "black" = color === "white" ? "black" : "white";
		// Go-specific resignation handling
		const inner = (this.game as any).inner;
		if (inner?.resign) inner.resign(color);
		this.overrideResult = { winner, reason: "resignation" };
		// A resigned game still deserves its evaluation, summary, and save.
		// The room stays alive (cleaned up on NEW_GAME/disconnect) so the
		// SKILL_EVAL and GAME_SUMMARY emits can reach the client.
		this.emitSkillEvaluation();
		return {
			type: "GAME_OVER" as const,
			result: this.overrideResult,
		};
	}

	/**
	 * Take back the player's last move (and everything after it) by replaying
	 * the record on a fresh game — works for all games through IGame, no
	 * per-game undo support needed.
	 */
	undo(): { ok: boolean; error?: string } {
		if (this.moveInProgress) return { ok: false, error: "Move in progress" };
		if (this.overrideResult) return { ok: false, error: "Game is over" };

		const snap = this.game.getSnapshot();
		const history = snap.moveHistory;
		const firstMover = this.gameType === "go" ? "black" : "white";
		const other = firstMover === "white" ? "black" : "white";
		let lastPlayerIdx = -1;
		for (let i = history.length - 1; i >= 0; i--) {
			if ((i % 2 === 0 ? firstMover : other) === this.playerColor) {
				lastPlayerIdx = i;
				break;
			}
		}
		if (lastPlayerIdx < 0) return { ok: false, error: "Nothing to undo" };

		const fresh = createGame(this.gameType, snap.boardSize);
		for (const m of history.slice(0, lastPlayerIdx)) {
			if (!fresh.move(m.notation)) return { ok: false, error: "Undo failed" };
		}
		this.game = fresh;

		// Invalidate everything derived from the removed moves
		this.lastSuggestions = [];
		this.suggestionsMoveCount = -1;
		this.pendingQuality = null;
		this.lastQuality = null;
		this.playerMoveEvals.pop();
		this.hintState = { moveCount: -1, level: 0 };
		for (const n of [...this.analyzedMoves]) {
			if (n > lastPlayerIdx) this.analyzedMoves.delete(n);
		}

		this.emit(this.getState());
		this.sendOpeningSuggestions();
		return { ok: true };
	}

	async startIfAiFirst(): Promise<void> {
		if (this.game.turn !== this.playerColor) {
			await this.makeAiMove();
		}
		this.sendOpeningSuggestions();
	}

	private sendOpeningSuggestions(retries = 2): void {
		this.getSuggestions(this.suggestionCount)
			.then((sugPayload) => {
				this.emit(sugPayload);
				if (this.coachingEnabled) this.scheduleAnalysis();
			})
			.catch((err) => {
				log.error("opening suggestions failed", { error: (err as Error).message, retries });
				if (retries > 0 && !this.destroyed) {
					setTimeout(() => this.sendOpeningSuggestions(retries - 1), 1000);
				} else {
					this.emit({ type: "SUGGESTIONS", suggestions: [] });
				}
			});
	}
}
