import {
	ChessGame,
	type DifficultyId,
	type GameType,
	GoGame,
	JanggiGame,
	type Suggestion,
} from "@tess/shared";
import { type AnalysisContext, analyzePosition } from "./ai.js";
import { FULL_STRENGTH_MOVETIME, getTier } from "./engine/difficulty.js";
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
	private lastSuggestions: Suggestion[] = [];
	coachingEnabled = true;

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
		for (const cb of this.moveCallbacks) cb(data);
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
		return {
			type: "GAME_STATE" as const,
			gameId: this.id,
			gameType: this.gameType,
			fen: game.fen,
			playerColor: this.playerColor,
			turn: game.turn,
			legalMoves: game.getLegalMovesObject(),
			moveHistory: game.getMoveHistory(),
			capturedPieces: game.getCapturedPieces(),
			isCheck: game.isCheck,
			isGameOver: game.isGameOver,
			result: game.getGameResult() ?? undefined,
			difficulty: this.difficulty,
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
		return {
			turn: game.turn,
			legalMoves: game.getLegalMovesObject(),
			capturedPieces: game.getCapturedPieces(),
			isCheck: game.isCheck,
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
				await this.makeAiMove();
			}

			if (!this.isGameOver) {
				this.sendSuggestionsAndAnalysis(move);
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
					),
					new Promise((r) => setTimeout(r, delay)),
				]);
				aiMoveStr = searchResult.bestmove;
			} else {
				const [searchResult] = await Promise.all([
					this.uciPool.search(this.chessGame!.fen, tier.chessMovetime),
					new Promise((r) => setTimeout(r, delay)),
				]);
				aiMoveStr = searchResult.bestmove;
			}

			const moveResult = this.executeMove(aiMoveStr);
			if (!moveResult) {
				log.error("AI produced illegal move", { move: aiMoveStr, gameType: this.gameType });
				return;
			}

			this.emit({ type: "MOVE", move: moveResult, ...this.buildMovePayload() });
		} catch (err) {
			log.error("AI move failed", { error: (err as Error).message });
			this.emit({ type: "ERROR", message: "AI failed to respond." });
		}
	}

	// --- Suggestions & Analysis ---

	private sendSuggestionsAndAnalysis(playerMove: string): void {
		// Get suggestions first (fast), then start analysis with suggestion context
		this.getSuggestions(3)
			.then((sugPayload) => {
				this.emit(sugPayload);
				this.lastSuggestions = sugPayload.suggestions;
				if (this.lastSuggestions.length > 0) {
					this.emit({
						type: "MOVE_QUALITY",
						move: playerMove,
						quality: this.assessMoveQuality(playerMove),
					});
				}
				// Now start analysis with suggestions context
				if (this.coachingEnabled) {
					this.requestAnalysis();
				}
			})
			.catch((err) => log.error("suggestions failed", { error: (err as Error).message }));
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
			this.emit({ type: "ANALYSIS", text, moveNumber: moveNum });
		}
	}

	async getSuggestions(topN = 3) {
		try {
			let suggestions: Suggestion[];

			if (this.gameType === "go" && this.goGame && this.kataGo) {
				const moves = this.goGame.getKataGoMoves();
				const color = this.goGame.turn === "black" ? "b" : "w";
				// Use moderate visit count for suggestions (high counts too slow on CPU)
				const sugVisits = 100;
				log.info("Go suggestions query", { moves: moves.length, color, topN, visits: sugVisits });
				const results = await this.kataGo.analyze(moves, color, sugVisits, topN, this.goGame.size);
				log.info("Go suggestions result", { count: results.length });
				suggestions = results.map((info) => ({
					move: info.move,
					san: info.move,
					score: Math.round(info.winrate * 10000 - 5000), // normalize to centipawn-like
					depth: info.visits,
					pv: info.pv,
				}));
			} else {
				const fen = this.gameType === "janggi" ? this.janggiGame!.fen : this.chessGame!.fen;
				const variant = this.useJanggiVariant ? "janggi" : undefined;
				const result = await this.uciPool.search(fen, FULL_STRENGTH_MOVETIME, topN, variant);
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
		this.getSuggestions(3)
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
