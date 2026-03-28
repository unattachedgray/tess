import { ChessGame, type DifficultyId, type GameType, type Suggestion } from "@tess/shared";
import { type AnalysisContext, analyzePosition } from "./ai.js";
import { FULL_STRENGTH_MOVETIME, getTier } from "./engine/difficulty.js";
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

export class GameRoom {
	readonly id: string;
	readonly gameType: GameType;
	readonly difficulty: DifficultyId;
	readonly playerColor: "white" | "black";
	private game: ChessGame;
	private uciPool: UciPool;
	private moveCallbacks: ((data: unknown) => void)[] = [];
	private moveInProgress = false;
	private lastSuggestions: Suggestion[] = [];
	coachingEnabled = true;

	constructor(config: {
		id: string;
		gameType: GameType;
		difficulty: DifficultyId;
		playerColor: "white" | "black";
		uciPool: UciPool;
	}) {
		this.id = config.id;
		this.gameType = config.gameType;
		this.difficulty = config.difficulty;
		this.playerColor = config.playerColor;
		this.uciPool = config.uciPool;
		this.game = new ChessGame();
	}

	onMove(cb: (data: unknown) => void): void {
		this.moveCallbacks.push(cb);
	}

	private emit(data: unknown): void {
		for (const cb of this.moveCallbacks) cb(data);
	}

	getState() {
		return {
			type: "GAME_STATE" as const,
			gameId: this.id,
			fen: this.game.fen,
			playerColor: this.playerColor,
			turn: this.game.turn,
			legalMoves: this.game.getLegalMovesObject(),
			moveHistory: this.game.getMoveHistory(),
			capturedPieces: this.game.getCapturedPieces(),
			isCheck: this.game.isCheck,
			isGameOver: this.game.isGameOver,
			result: this.game.getGameResult() ?? undefined,
			difficulty: this.difficulty,
		};
	}

	private buildMovePayload() {
		return {
			turn: this.game.turn,
			legalMoves: this.game.getLegalMovesObject(),
			capturedPieces: this.game.getCapturedPieces(),
			isCheck: this.game.isCheck,
			isGameOver: this.game.isGameOver,
			result: this.game.getGameResult() ?? undefined,
		};
	}

	async playMove(uci: string): Promise<{ success: boolean; error?: string }> {
		if (this.moveInProgress) return { success: false, error: "Move in progress" };
		if (this.game.isGameOver) return { success: false, error: "Game is over" };

		if (this.game.turn !== this.playerColor) {
			return { success: false, error: "Not your turn" };
		}

		this.moveInProgress = true;
		try {
			const result = this.game.moveUci(uci);
			if (!result) return { success: false, error: "Illegal move" };

			const history = this.game.getMoveHistory();
			const lastMove = history[history.length - 1];

			this.emit({
				type: "MOVE",
				move: lastMove,
				...this.buildMovePayload(),
			});

			if (!this.game.isGameOver) {
				await this.makeAiMove();
			}

			// After AI responds, send suggestions + analysis (fire-and-forget)
			if (!this.game.isGameOver) {
				this.sendSuggestionsAndAnalysis(uci);
			}

			return { success: true };
		} finally {
			this.moveInProgress = false;
		}
	}

	private async makeAiMove(): Promise<void> {
		const tier = getTier(this.difficulty);
		if (!tier) return;

		const delay = randomDelay(AI_DELAY[this.difficulty]);

		try {
			const [searchResult] = await Promise.all([
				this.uciPool.search(this.game.fen, tier.chessMovetime),
				new Promise((r) => setTimeout(r, delay)),
			]);

			const aiMove = this.game.moveUci(searchResult.bestmove);
			if (!aiMove) {
				log.error("AI produced illegal move", {
					move: searchResult.bestmove,
					fen: this.game.fen,
				});
				return;
			}

			const history = this.game.getMoveHistory();
			const lastMove = history[history.length - 1];

			this.emit({
				type: "MOVE",
				move: lastMove,
				...this.buildMovePayload(),
			});
		} catch (err) {
			log.error("AI move failed", { error: (err as Error).message });
			this.emit({
				type: "ERROR",
				message: "AI failed to respond. You can continue or start a new game.",
			});
		}
	}

	/** Fire-and-forget: sends suggestions then analysis to client */
	private sendSuggestionsAndAnalysis(playerMove: string): void {
		this.getSuggestions(3)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.lastSuggestions = sugPayload.suggestions;

				// Send move quality based on previous suggestions
				if (this.lastSuggestions.length > 0) {
					this.emit({
						type: "MOVE_QUALITY",
						move: playerMove,
						quality: this.assessMoveQuality(playerMove),
					});
				}

				// Request AI analysis if coaching enabled
				if (this.coachingEnabled) {
					this.requestAnalysis();
				}
			})
			.catch((err) => {
				log.error("suggestions+analysis failed", { error: (err as Error).message });
			});
	}

	private assessMoveQuality(
		userMove: string,
	): "best" | "good" | "ok" | "inaccuracy" | "mistake" | "blunder" {
		if (this.lastSuggestions.length === 0) return "ok";

		const bestMove = this.lastSuggestions[0].move;
		if (userMove.startsWith(bestMove) || bestMove.startsWith(userMove)) return "best";

		const inTop = this.lastSuggestions.some(
			(s) => s.move === userMove || userMove.startsWith(s.move),
		);
		if (inTop) return "good";

		// Score difference from the previous best
		const bestScore = Math.abs(this.lastSuggestions[0].score);
		if (bestScore < 30) return "ok";
		if (bestScore < 80) return "inaccuracy";
		if (bestScore < 200) return "mistake";
		return "blunder";
	}

	private async requestAnalysis(): Promise<void> {
		const history = this.game.getMoveHistory();
		const lastMoveEntry = history.length > 0 ? history[history.length - 1] : null;

		const ctx: AnalysisContext = {
			gameType: this.gameType,
			fen: this.game.fen,
			moveCount: history.length,
			playerColor: this.playerColor,
			lastMove: lastMoveEntry?.san,
			lastMoveColor: this.game.turn === "white" ? "Black" : "White",
			suggestions: this.lastSuggestions,
			pgn: this.game.pgn,
		};

		const text = await analyzePosition(ctx);
		if (text) {
			this.emit({ type: "ANALYSIS", text });
		}
	}

	async getSuggestions(topN = 3) {
		try {
			const result = await this.uciPool.search(this.game.fen, FULL_STRENGTH_MOVETIME, topN);
			const suggestions = result.info
				.filter((i) => i.pv.length > 0)
				.sort((a, b) => a.multipv - b.multipv)
				.slice(0, topN)
				.map((info) => ({
					move: info.pv[0],
					san: this.game.uciToSan(info.pv[0]) ?? info.pv[0],
					score: info.mate !== null ? (info.mate > 0 ? 99999 : -99999) : info.score,
					depth: info.depth,
					pv: info.pv,
				}));

			this.lastSuggestions = suggestions;
			return { type: "SUGGESTIONS" as const, suggestions };
		} catch (err) {
			log.error("suggestions failed", { error: (err as Error).message });
			return { type: "SUGGESTIONS" as const, suggestions: [] };
		}
	}

	get pgn(): string {
		return this.game.pgn;
	}

	async getHint(): Promise<{
		type: "HINT";
		level: number;
		piece?: string;
		destination?: string;
		fullMove?: string;
	} | null> {
		if (this.lastSuggestions.length === 0) {
			const sug = await this.getSuggestions(1);
			this.lastSuggestions = sug.suggestions;
		}
		if (this.lastSuggestions.length === 0) return null;

		const bestMove = this.lastSuggestions[0].move;
		const piece = bestMove.slice(0, 2);
		const dest = bestMove.slice(2, 4);

		// Progressive hints: call multiple times for more detail
		return {
			type: "HINT",
			level: 3,
			piece,
			destination: dest,
			fullMove: bestMove,
		};
	}

	resign(color: "white" | "black") {
		const winner = color === "white" ? "black" : "white";
		return {
			type: "GAME_OVER" as const,
			result: { winner: winner as "white" | "black", reason: "resignation" },
		};
	}

	async startIfAiFirst(): Promise<void> {
		if (this.game.turn !== this.playerColor) {
			await this.makeAiMove();
		}
		// Always send opening suggestions after game starts
		this.sendOpeningSuggestions();
	}

	/** Fire-and-forget: sends initial suggestions and opening analysis */
	private sendOpeningSuggestions(): void {
		this.getSuggestions(3)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.lastSuggestions = sugPayload.suggestions;

				if (this.coachingEnabled) {
					this.requestOpeningAnalysis();
				}
			})
			.catch((err) => {
				log.error("opening suggestions failed", { error: (err as Error).message });
			});
	}

	private async requestOpeningAnalysis(): Promise<void> {
		const history = this.game.getMoveHistory();
		const ctx: AnalysisContext = {
			gameType: this.gameType,
			fen: this.game.fen,
			moveCount: history.length,
			playerColor: this.playerColor,
			lastMove: history.length > 0 ? history[history.length - 1].san : undefined,
			lastMoveColor:
				history.length > 0 ? (this.game.turn === "white" ? "Black" : "White") : undefined,
			suggestions: this.lastSuggestions,
			pgn: this.game.pgn,
		};

		const text = await analyzePosition(ctx);
		if (text) {
			this.emit({ type: "ANALYSIS", text });
		}
	}
}
