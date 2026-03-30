import {
	type DifficultyId,
	type GameType,
	type IGame,
	type Suggestion,
	ChessAdapter,
	GoAdapter,
	JanggiAdapter,
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
	private analysisInFlight = false;
	private analysisPending = false;
	private analyzedMoves = new Set<number>(); // move numbers already coached
	private backfillTimer: ReturnType<typeof setTimeout> | null = null;
	// Incremental eval accumulation from suggestions (like MP's positionEvals)
	private positionEvals: number[] = [0]; // evals[0] = starting position = 0
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
		if (this.game.isGameOver) return { success: false, error: "Game is over" };
		if (this.game.turn !== this.playerColor) return { success: false, error: "Not your turn" };

		this.moveInProgress = true;
		try {
			const moveResult = this.executeMove(move);
			if (!moveResult) return { success: false, error: "Illegal move" };

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });

			if (!this.game.isGameOver) {
				try {
					await this.makeAiMove();
				} catch (err) {
					log.error("AI move failed, skipping", { error: (err as Error).message });
					this.emit({ type: "ERROR", message: "AI failed to respond" });
				}
			}

			if (!this.game.isGameOver) {
				this.sendSuggestionsAndAnalysis(move);
			} else {
				// Emit explicit GAME_OVER so the client properly transitions
				const result = this.game.getResult();
				if (result) {
					this.emit({ type: "GAME_OVER", result });
				}
				this.emitSkillEvaluation();
			}

			return { success: true };
		} finally {
			this.moveInProgress = false;
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

			const moveResult = this.executeMove(aiMoveStr);
			if (!moveResult) {
				log.error("AI produced illegal move", { move: aiMoveStr, gameType: this.gameType });
				throw new Error(`AI illegal move: ${aiMoveStr}`);
			}

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });
		} catch (err) {
			log.error("AI move failed", { error: (err as Error).message });
			throw err;
		}
	}

	// --- Suggestions & Analysis ---

	private sendSuggestionsAndAnalysis(playerMove: string): void {
		this.getSuggestions(this.suggestionCount)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.lastSuggestions = sugPayload.suggestions;

				if (this.lastSuggestions.length > 0) {
					const quality = this.assessMoveQuality(playerMove);
					this.emit({ type: "MOVE_QUALITY", move: playerMove, quality });
				}
				if (this.coachingEnabled) {
					this.scheduleAnalysis();
				}
			})
			.catch((err) => {
				log.error("suggestions failed", { error: (err as Error).message });
				this.emit({ type: "SUGGESTIONS", suggestions: [] });
			});
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
		const moveNum = this.game.getSnapshot().moveHistory.length;

		this.requestAnalysis().finally(() => {
			this.analyzedMoves.add(moveNum);
			this.analysisInFlight = false;

			if (this.analysisPending && !this.game.isGameOver) {
				// Player moved again — analyze their latest position
				this.analysisPending = false;
				this.scheduleAnalysis();
			} else if (!this.game.isGameOver) {
				// Player is idle — schedule backfill for missed moves after a delay
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

		this.analysisInFlight = true;
		const moveIdx = targetMove;
		this.requestAnalysis().finally(() => {
			this.analyzedMoves.add(moveIdx);
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

	private assessMoveQuality(
		userMove: string,
	): "best" | "good" | "ok" | "inaccuracy" | "mistake" | "blunder" {
		if (this.lastSuggestions.length === 0) return "ok";
		const normalize = (m: string) => m.toLowerCase().replace(/\s/g, "");
		const normalizedUser = normalize(userMove);
		const bestMove = normalize(this.lastSuggestions[0].move);
		if (normalizedUser === bestMove) return "best";
		if (this.lastSuggestions.some((s) => normalize(s.move) === normalizedUser)) return "good";
		return "ok";
	}

	private async requestAnalysis(): Promise<void> {
		const snap = this.game.getSnapshot();
		const extra = snap.extra as Record<string, unknown>;
		const history = snap.moveHistory;
		const lastEntry = history.length > 0 ? history[history.length - 1] : null;

		const ctx: AnalysisContext = {
			gameType: this.gameType,
			fen: snap.fen,
			moveCount: history.length,
			playerColor: this.playerColor,
			lastMove: lastEntry?.display,
			lastMoveColor: snap.turn === "white" ? "Black" : "White",
			suggestions: this.lastSuggestions,
			pgn: extra.pgn as string | undefined,
			language: this.language,
		};

		const moveNum = history.length;
		const text = await analyzePosition(ctx);
		if (text) {
			this.emit({ type: "ANALYSIS", text, moveNumber: moveNum, gameId: this.id });
		}
	}

	async getSuggestions(topN = 3) {
		if (topN <= 0) return { type: "SUGGESTIONS" as const, suggestions: [] };

		try {
			const suggestions = await this.engine.getSuggestions(
				this.game,
				topN,
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

			// Record eval for incremental accuracy (avoid expensive post-game replay)
			if (suggestions.length > 0) {
				const score = suggestions[0].score;
				// Convert to white's perspective
				const scoreWhitePov = this.game.turn === "white" ? score : -score;
				this.positionEvals.push(scoreWhitePov);
			}

			return { type: "SUGGESTIONS" as const, suggestions };
		} catch (err) {
			log.error("suggestions failed", { error: (err as Error).message });
			return { type: "SUGGESTIONS" as const, suggestions: [] };
		}
	}

	async getHint() {
		if (this.lastSuggestions.length === 0) {
			const sug = await this.getSuggestions(1);
			this.lastSuggestions = sug.suggestions;
		}
		if (this.lastSuggestions.length === 0) return null;
		const bestMove = this.lastSuggestions[0].move;
		return {
			type: "HINT" as const,
			level: 3,
			piece: bestMove.slice(0, 2),
			destination: bestMove.length >= 4 ? bestMove.slice(2, 4) : bestMove,
			fullMove: bestMove,
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

		// Use incrementally accumulated evals if we have enough (>50% coverage)
		// This makes SKILL_EVAL near-instant instead of replaying every position
		let evals: number[];
		// Use accumulated evals if we have reasonable coverage (>30%)
		// Suggestions give ~1 eval per 2 moves, so 30% = most games qualify
		if (this.positionEvals.length > history.length * 0.3) {
			evals = this.positionEvals;
			log.info("using incremental evals", { collected: evals.length - 1, moves: history.length });
		} else {
			// Fallback: replay the game (expensive but accurate)
			log.info("replaying game for evals", { collected: this.positionEvals.length - 1, moves: history.length });
			const replay = createGame(this.gameType, snap.boardSize);
			evals = [0];
			for (const move of history) {
				replay.move(move.notation);
				try {
					const score = await this.engine.evaluate(replay);
					evals.push(score);
				} catch {
					evals.push(evals[evals.length - 1] ?? 0);
				}
			}
		}

		const flatHistory = history.map((m) => ({
			san: m.display,
			uci: m.notation,
			fen: m.position,
			moveNumber: m.moveNumber,
		}));

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
		const gameResult = this.game.getResult();
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
			pgn: extra.pgn as string | undefined,
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
			const result = this.game.getResult();
			if (result) {
				this.emit({ type: "GAME_OVER", result });
			}
			this.emitSkillEvaluation();
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
		const winner = color === "white" ? "black" : "white";
		// Go-specific resignation handling
		const inner = (this.game as any).inner;
		if (inner?.resign) inner.resign(color);
		return {
			type: "GAME_OVER" as const,
			result: { winner: winner as "white" | "black", reason: "resignation" },
		};
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
				this.lastSuggestions = sugPayload.suggestions;
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
