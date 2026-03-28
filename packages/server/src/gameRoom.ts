import {
	ChessGame,
	type DifficultyId,
	type GameType,
	GoGame,
	JanggiGame,
	type Suggestion,
	detectOpening,
	gameAccuracy,
	getSkillLevel,
} from "@tess/shared";
import { type AnalysisContext, analyzePosition, generateGameSummary } from "./ai.js";
import { FULL_STRENGTH_MOVETIME, getElo, getTier } from "./engine/difficulty.js";
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

// Fairy-Stockfish Janggi uses the same 1-indexed coordinates as our game (a1-i10).
// No conversion needed — engine and game use identical coordinate systems.

export class GameRoom {
	readonly id: string;
	readonly gameType: GameType;
	readonly difficulty: DifficultyId;
	readonly playerColor: "white" | "black";
	private chessGame: ChessGame | null = null;
	private goGame: GoGame | null = null;
	private janggiGame: JanggiGame | null = null;
	private uciPool: UciPool;
	private kataGo: KataGoAdapter | null;
	private useJanggiVariant: boolean;
	private moveCallbacks: ((data: unknown) => void)[] = [];
	private moveInProgress = false;
	private destroyed = false;
	private lastSuggestions: Suggestion[] = [];
	coachingEnabled = true;
	suggestionCount = 3;
	suggestionStrength: "fast" | "balanced" | "deep" = "deep";
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
	}) {
		this.id = config.id;
		this.gameType = config.gameType;
		this.difficulty = config.difficulty;
		this.playerColor = config.playerColor;
		this.uciPool = config.uciPool;
		this.kataGo = config.kataGo;
		this.useJanggiVariant = config.useJanggiVariant ?? false;

		switch (config.gameType) {
			case "chess":
				this.chessGame = new ChessGame();
				break;
			case "go":
				this.goGame = new GoGame(config.boardSize ?? 19);
				break;
			case "janggi":
				this.janggiGame = new JanggiGame();
				break;
		}
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
	}

	// --- State accessors ---

	getState() {
		if (this.gameType === "go" && this.goGame) {
			return {
				type: "GAME_STATE" as const,
				gameId: this.id,
				gameType: this.gameType,
				fen: "",
				boardState: this.goGame.getBoardState(),
				boardSize: this.goGame.size,
				playerColor: this.playerColor,
				turn: this.goGame.turn,
				legalMoves: {} as Record<string, string[]>,
				moveHistory: this.goGame.getMoveHistory().map((m) => ({
					san: m.coord,
					uci: m.coord,
					fen: "",
					moveNumber: m.moveNumber,
				})),
				capturedPieces: {
					white: [] as string[],
					black: [] as string[],
				},
				prisoners: this.goGame.prisoners,
				isCheck: false,
				isGameOver: this.goGame.isGameOver,
				result: this.goGame.getGameResult() ?? undefined,
				difficulty: this.difficulty,
			};
		}

		if (this.gameType === "janggi" && this.janggiGame) {
			return {
				type: "GAME_STATE" as const,
				gameId: this.id,
				gameType: this.gameType,
				fen: this.janggiGame.fen,
				playerColor: this.playerColor,
				turn: this.janggiGame.turn,
				legalMoves: this.janggiGame.getLegalMovesObject(),
				moveHistory: this.janggiGame.getMoveHistory(),
				capturedPieces: {
					white: this.janggiGame.getCapturedPieces().blue,
					black: this.janggiGame.getCapturedPieces().red,
				},
				isCheck: false,
				isGameOver: this.janggiGame.isGameOver,
				result: this.janggiGame.getGameResult() ?? undefined,
				difficulty: this.difficulty,
			};
		}

		// Chess (default)
		const game = this.chessGame!;
		const history = game.getMoveHistory();
		return {
			type: "GAME_STATE" as const,
			gameId: this.id,
			gameType: this.gameType,
			fen: game.fen,
			playerColor: this.playerColor,
			turn: game.turn,
			legalMoves: game.getLegalMovesObject(),
			moveHistory: history,
			capturedPieces: game.getCapturedPieces(),
			isCheck: game.isCheck,
			isGameOver: game.isGameOver,
			result: game.getGameResult() ?? undefined,
			difficulty: this.difficulty,
			opening: detectOpening(history.map((m) => m.uci)) ?? undefined,
		};
	}

	private buildMovePayload() {
		if (this.gameType === "go" && this.goGame) {
			return {
				turn: this.goGame.turn,
				legalMoves: {} as Record<string, string[]>,
				capturedPieces: { white: [] as string[], black: [] as string[] },
				prisoners: this.goGame.prisoners,
				boardState: this.goGame.getBoardState(),
				lastStone: this.goGame.lastMove,
				isCheck: false,
				isGameOver: this.goGame.isGameOver,
				result: this.goGame.getGameResult() ?? undefined,
			};
		}

		if (this.gameType === "janggi" && this.janggiGame) {
			return {
				turn: this.janggiGame.turn,
				legalMoves: this.janggiGame.getLegalMovesObject(),
				capturedPieces: {
					white: this.janggiGame.getCapturedPieces().blue,
					black: this.janggiGame.getCapturedPieces().red,
				},
				isCheck: false,
				isGameOver: this.janggiGame.isGameOver,
				result: this.janggiGame.getGameResult() ?? undefined,
			};
		}

		const game = this.chessGame!;
		const chessHistory = game.getMoveHistory();
		return {
			turn: game.turn,
			legalMoves: game.getLegalMovesObject(),
			capturedPieces: game.getCapturedPieces(),
			isCheck: game.isCheck,
			opening: detectOpening(chessHistory.map((m) => m.uci)) ?? undefined,
			isGameOver: game.isGameOver,
			result: game.getGameResult() ?? undefined,
		};
	}

	// --- Move handling ---

	async playMove(move: string): Promise<{ success: boolean; error?: string }> {
		if (this.moveInProgress) return { success: false, error: "Move in progress" };
		if (this.isGameOver) return { success: false, error: "Game is over" };
		if (this.currentTurn !== this.playerColor) return { success: false, error: "Not your turn" };

		this.moveInProgress = true;
		try {
			const moveResult = this.executeMove(move);
			if (!moveResult) return { success: false, error: "Illegal move" };

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });

			if (!this.isGameOver) {
				try {
					await this.makeAiMove();
				} catch (err) {
					log.error("AI move failed, skipping", { error: (err as Error).message });
					this.emit({ type: "ERROR", message: "AI failed to respond" });
				}
			}

			if (!this.isGameOver) {
				this.sendSuggestionsAndAnalysis(move);
			} else {
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
		if (this.gameType === "go" && this.goGame) {
			if (move.toUpperCase() === "PASS") {
				if (!this.goGame.pass()) return null;
			} else {
				const coord = this.goGame.fromGtpCoord(move);
				if (!coord || !this.goGame.play(coord.x, coord.y)) return null;
			}
			const history = this.goGame.getMoveHistory();
			const last = history[history.length - 1];
			return { san: last.coord, uci: last.coord, fen: "", moveNumber: last.moveNumber };
		}

		if (this.gameType === "janggi" && this.janggiGame) {
			const result = this.janggiGame.moveUci(move);
			if (!result) return null;
			const history = this.janggiGame.getMoveHistory();
			return history[history.length - 1];
		}

		// Chess
		const result = this.chessGame!.moveUci(move);
		if (!result) return null;
		const history = this.chessGame!.getMoveHistory();
		return history[history.length - 1];
	}

	private get currentTurn(): "white" | "black" {
		if (this.goGame) return this.goGame.turn;
		if (this.janggiGame) return this.janggiGame.turn;
		return this.chessGame!.turn;
	}

	private get isGameOver(): boolean {
		if (this.goGame) return this.goGame.isGameOver;
		if (this.janggiGame) return this.janggiGame.isGameOver;
		return this.chessGame!.isGameOver;
	}

	private get currentFen(): string {
		if (this.janggiGame) return this.janggiGame.fen;
		if (this.chessGame) return this.chessGame.fen;
		return "";
	}

	// --- AI moves ---

	private async makeAiMove(): Promise<void> {
		const tier = getTier(this.difficulty);
		if (!tier) return;
		const delay = randomDelay(AI_DELAY[this.difficulty]);

		try {
			let aiMoveStr: string;

			const elo = getElo(this.difficulty);

			if (this.gameType === "go" && this.goGame && this.kataGo) {
				const moves = this.goGame.getKataGoMoves();
				const color = this.goGame.turn === "black" ? "b" : "w";
				const [moveResult] = await Promise.all([
					this.kataGo.getMove(moves, color, tier.goVisits, this.goGame.size),
					new Promise((r) => setTimeout(r, delay)),
				]);
				aiMoveStr = moveResult;
			} else if (this.gameType === "janggi" && this.janggiGame) {
				const [searchResult] = await Promise.all([
					this.uciPool.search(
						this.janggiGame.fen,
						tier.janggiMovetime,
						1,
						this.useJanggiVariant ? "janggi" : undefined,
						elo,
					),
					new Promise((r) => setTimeout(r, delay)),
				]);
				aiMoveStr = searchResult.bestmove;
			} else {
				const [searchResult] = await Promise.all([
					this.uciPool.search(this.chessGame!.fen, tier.chessMovetime, 1, undefined, elo),
					new Promise((r) => setTimeout(r, delay)),
				]);
				aiMoveStr = searchResult.bestmove;
			}

			const moveResult = this.executeMove(aiMoveStr);
			if (!moveResult) {
				log.error("AI produced illegal move", { move: aiMoveStr, gameType: this.gameType });
				throw new Error(`AI illegal move: ${aiMoveStr}`);
			}

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });
		} catch (err) {
			log.error("AI move failed", { error: (err as Error).message });
			throw err; // Propagate so playMove can handle it
		}
	}

	// --- Suggestions & Analysis ---

	private sendSuggestionsAndAnalysis(playerMove: string): void {
		// Get suggestions first (fast), then start analysis with suggestion context
		this.getSuggestions(this.suggestionCount)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.lastSuggestions = sugPayload.suggestions;

				if (this.lastSuggestions.length > 0) {
					const quality = this.assessMoveQuality(playerMove);
					this.emit({
						type: "MOVE_QUALITY",
						move: playerMove,
						quality,
					});
				}
				// Now start analysis with suggestions context
				if (this.coachingEnabled) {
					this.requestAnalysis();
				}
			})
			.catch((err) => {
				log.error("suggestions failed", { error: (err as Error).message });
				// Emit empty suggestions so UI doesn't stay stuck with loading dots
				this.emit({ type: "SUGGESTIONS", suggestions: [] });
			});
	}

	private assessMoveQuality(
		userMove: string,
	): "best" | "good" | "ok" | "inaccuracy" | "mistake" | "blunder" {
		if (this.lastSuggestions.length === 0) return "ok";
		// Check if user's move matches any suggestion
		const normalize = (m: string) => m.toLowerCase().replace(/\s/g, "");
		const normalizedUser = normalize(userMove);
		const bestMove = normalize(this.lastSuggestions[0].move);
		if (normalizedUser === bestMove) return "best";
		if (this.lastSuggestions.some((s) => normalize(s.move) === normalizedUser)) return "good";
		// For non-matching moves, be generous — we don't have proper eval delta
		return "ok";
	}

	private async requestAnalysis(): Promise<void> {
		const history =
			this.gameType === "go"
				? this.goGame!.getMoveHistory()
				: this.gameType === "janggi"
					? this.janggiGame!.getMoveHistory()
					: this.chessGame!.getMoveHistory();

		const lastEntry = history.length > 0 ? history[history.length - 1] : null;

		const ctx: AnalysisContext = {
			gameType: this.gameType,
			fen: this.currentFen,
			moveCount: history.length,
			playerColor: this.playerColor,
			lastMove: lastEntry
				? "san" in lastEntry
					? lastEntry.san
					: (lastEntry as { coord?: string }).coord
				: undefined,
			lastMoveColor: this.currentTurn === "white" ? "Black" : "White",
			suggestions: this.lastSuggestions,
			pgn: this.chessGame?.pgn,
		};

		const moveNum = history.length;
		const text = await analyzePosition(ctx);
		if (text) {
			this.emit({ type: "ANALYSIS", text, moveNumber: moveNum, gameId: this.id });
		}
	}

	private getSuggestionParams(): { movetime: number; goVisits: number } {
		switch (this.suggestionStrength) {
			case "fast":
				return { movetime: 200, goVisits: 50 };
			case "balanced":
				return { movetime: 500, goVisits: 200 };
			default:
				return { movetime: FULL_STRENGTH_MOVETIME, goVisits: 500 };
		}
	}

	async getSuggestions(topN = 3) {
		if (topN <= 0) return { type: "SUGGESTIONS" as const, suggestions: [] };

		const params = this.getSuggestionParams();

		try {
			let suggestions: Suggestion[];

			if (this.gameType === "go" && this.goGame && this.kataGo) {
				const moves = this.goGame.getKataGoMoves();
				const color = this.goGame.turn === "black" ? "b" : "w";
				const results = await this.kataGo.analyze(
					moves,
					color,
					params.goVisits,
					topN,
					this.goGame.size,
				);
				suggestions = results.map((info) => ({
					move: info.move,
					san: info.move,
					score: Math.round(info.winrate * 10000 - 5000),
					depth: info.visits,
					pv: info.pv,
				}));
			} else {
				const fen = this.gameType === "janggi" ? this.janggiGame!.fen : this.chessGame!.fen;
				const variant = this.useJanggiVariant ? "janggi" : undefined;
				const result = await this.uciPool.search(fen, params.movetime, topN, variant, null);
				suggestions = result.info
					.filter((i) => i.pv.length > 0)
					.sort((a, b) => a.multipv - b.multipv)
					.slice(0, topN)
					.map((info) => {
						const move = info.pv[0];
						const san = this.chessGame?.uciToSan(move) ?? move;
						return {
							move,
							san,
							score: info.mate !== null ? (info.mate > 0 ? 99999 : -99999) : info.score,
							depth: info.depth,
							pv: info.pv,
						};
					});
			}

			this.lastSuggestions = suggestions;
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
		// Fire-and-forget: analyze the full game asynchronously
		this.batchEvalGame().catch((err) => {
			log.error("skill evaluation failed", { error: (err as Error).message });
		});
	}

	private async batchEvalGame(): Promise<void> {
		const history =
			this.chessGame?.getMoveHistory() ??
			this.janggiGame?.getMoveHistory() ??
			this.goGame?.getMoveHistory().map((m) => ({
				san: m.coord,
				uci: m.coord,
				fen: "",
				moveNumber: m.moveNumber,
			})) ??
			[];

		if (history.length < 6) return;

		// For chess: replay game and eval each position
		if (this.gameType === "chess") {
			const evals: number[] = [0];
			const replay = new ChessGame();

			for (const move of history) {
				replay.moveUci(move.uci);
				try {
					const result = await this.uciPool.search(replay.fen, 500, 1, undefined, null);
					// Eval from white's perspective
					const score = result.info[0]?.score ?? 0;
					const sideToMove = replay.turn;
					evals.push(sideToMove === "white" ? score : -score);
				} catch {
					evals.push(evals[evals.length - 1] ?? 0);
				}
			}

			const chessResult = gameAccuracy(evals, this.playerColor);
			await this.emitAndSummarize(chessResult, history);
			return;
		}

		// For Janggi: replay and eval each position
		if (this.gameType === "janggi" && this.janggiGame) {
			const evals: number[] = [0];
			const replay = new JanggiGame();

			for (const move of history) {
				replay.moveUci(move.uci);
				try {
					const variant = this.useJanggiVariant ? "janggi" : undefined;
					const result = await this.uciPool.search(replay.fen, 300, 1, variant, null);
					const score = result.info[0]?.score ?? 0;
					evals.push(replay.turn === "white" ? score : -score);
				} catch {
					evals.push(evals[evals.length - 1] ?? 0);
				}
			}

			const result = gameAccuracy(evals, this.playerColor);
			await this.emitAndSummarize(result, history);
			return;
		}

		// For Go: eval each position with KataGo
		if (this.gameType === "go" && this.goGame && this.kataGo) {
			const evals: number[] = [0];
			const goHistory = this.goGame.getKataGoMoves();

			for (let i = 0; i <= goHistory.length; i++) {
				const movesUpToHere = goHistory.slice(0, i);
				const color = i % 2 === 0 ? "b" : "w";
				try {
					const results = await this.kataGo.analyze(movesUpToHere, color, 30, 1, this.goGame.size);
					if (results.length > 0) {
						evals.push(Math.round(results[0].winrate * 10000 - 5000));
					} else {
						evals.push(evals[evals.length - 1] ?? 0);
					}
				} catch {
					evals.push(evals[evals.length - 1] ?? 0);
				}
			}

			const result = gameAccuracy(evals, this.playerColor);
			await this.emitAndSummarize(result, history);
			return;
		}

		log.info("skill evaluation skipped — unsupported game type");
	}

	private async emitAndSummarize(
		result: { accuracy: number; acpl: number; moveAccuracies: number[] },
		history: { san: string; uci: string }[],
	): Promise<void> {
		const accuracy = Math.round(result.accuracy);
		const skill = getSkillLevel(accuracy, this.gameType);

		log.info("skill evaluation", {
			accuracy,
			acpl: result.acpl,
			label: skill.label,
			moves: result.moveAccuracies.length,
		});

		// Emit engine-based eval immediately
		this.emit({
			type: "SKILL_EVAL",
			accuracy,
			acpl: result.acpl,
			skill,
		});

		// Fire off LLM narrative summary (arrives later)
		const gameResult =
			this.chessGame?.getGameResult() ??
			this.janggiGame?.getGameResult() ??
			this.goGame?.getGameResult();

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
			pgn: this.chessGame?.pgn,
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
				whiteUserId: this.playerColor === "white" ? undefined : "ai",
				blackUserId: this.playerColor === "black" ? undefined : "ai",
				difficulty: this.difficulty,
				result: gameResult?.winner,
				resultReason: gameResult?.reason,
				moves: history,
				pgn: this.chessGame?.pgn,
				boardSize: this.goGame?.size,
				accuracyWhite: this.playerColor === "white" ? accuracy : undefined,
				accuracyBlack: this.playerColor === "black" ? accuracy : undefined,
				acplWhite: this.playerColor === "white" ? result.acpl : undefined,
				acplBlack: this.playerColor === "black" ? result.acpl : undefined,
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

		while (this.autoplay && !this.isGameOver && !this.destroyed) {
			const isHumanTurn = this.currentTurn === this.playerColor;
			const elo = isHumanTurn ? (this.autoplayHumanElo ?? aiElo) : aiElo;
			const movetime = 200; // Fast play

			try {
				let moveStr: string;

				if (this.gameType === "go" && this.goGame && this.kataGo) {
					const moves = this.goGame.getKataGoMoves();
					const color = this.goGame.turn === "black" ? "b" : "w";
					const visits = isHumanTurn
						? Math.min(50, getTier(this.difficulty)?.goVisits ?? 50)
						: (getTier(this.difficulty)?.goVisits ?? 50);
					moveStr = await this.kataGo.getMove(moves, color, visits, this.goGame.size);
				} else {
					const fen = this.gameType === "janggi" ? this.janggiGame!.fen : this.chessGame!.fen;
					const variant = this.useJanggiVariant ? "janggi" : undefined;
					const result = await this.uciPool.search(fen, movetime, 1, variant, elo);
					moveStr = result.bestmove;
				}

				// Engine returns "(none)" when no legal moves exist (checkmate/stalemate)
				if (moveStr === "(none)") {
					log.info("autoplay: engine returned (none), ending game");
					if (this.janggiGame) {
						this.janggiGame.forceGameOver();
					}
					// For chess, the game should already be over via isGameOver check,
					// but break the loop regardless
					break;
				}

				const moveResult = this.executeMove(moveStr);
				if (!moveResult) {
					log.error("autoplay illegal move", { move: moveStr });
					break;
				}

				this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });

				// Small delay so the UI can render
				await new Promise((r) => setTimeout(r, 150));
			} catch (err) {
				log.error("autoplay error", { error: (err as Error).message });
				break;
			}
		}

		this.autoplayRunning = false;

		if (this.isGameOver) {
			this.emitSkillEvaluation();
		}
	}

	stopAutoplay(): void {
		this.autoplay = false;
	}

	get pgn(): string {
		return this.chessGame?.pgn ?? "";
	}

	resign(color: "white" | "black") {
		const winner = color === "white" ? "black" : "white";
		if (this.goGame) this.goGame.resign(color);
		return {
			type: "GAME_OVER" as const,
			result: { winner: winner as "white" | "black", reason: "resignation" },
		};
	}

	async startIfAiFirst(): Promise<void> {
		if (this.currentTurn !== this.playerColor) {
			await this.makeAiMove();
		}
		this.sendOpeningSuggestions();
	}

	private sendOpeningSuggestions(): void {
		this.getSuggestions(this.suggestionCount)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.lastSuggestions = sugPayload.suggestions;
				if (this.coachingEnabled) this.requestAnalysis();
			})
			.catch((err) => {
				log.error("opening suggestions failed", { error: (err as Error).message });
			});
	}
}
