import { ChessGame, type DifficultyId, type GameType } from "@tess/shared";
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
				log.error("AI produced illegal move", { move: searchResult.bestmove, fen: this.game.fen });
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

			return { type: "SUGGESTIONS" as const, suggestions };
		} catch (err) {
			log.error("suggestions failed", { error: (err as Error).message });
			return { type: "SUGGESTIONS" as const, suggestions: [] };
		}
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
	}
}
