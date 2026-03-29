/**
 * GameEngine — abstracts engine interactions per game type.
 *
 * GameRoom calls GameEngine methods without knowing whether it's
 * talking to Fairy-Stockfish (UCI) or KataGo (GTP). Adding a new
 * game only requires implementing a new GameEngine.
 */
import type { IGame } from "@tess/shared";
import type { Suggestion, GameType } from "@tess/shared";
import type { UciPool } from "./uciPool.js";
import type { KataGoAdapter } from "./katago.js";
import { FULL_STRENGTH_MOVETIME, getElo, getTier } from "./difficulty.js";

export interface GameEngine {
	/** Get an AI move for the given difficulty level. */
	getAiMove(game: IGame, difficulty: string): Promise<string>;

	/** Get top-N move suggestions at full strength. */
	getSuggestions(
		game: IGame,
		count: number,
		strength: "fast" | "balanced" | "deep",
	): Promise<Suggestion[]>;

	/** Evaluate the current position. Returns score in centipawn-equivalents from white's perspective. */
	evaluate(game: IGame, movetime?: number): Promise<number>;

	/** Get a weak (Elo-limited) move for autoplay. */
	getWeakMove(game: IGame, elo: number): Promise<string>;
}

// ── Strength params ──

function strengthParams(strength: "fast" | "balanced" | "deep"): {
	movetime: number;
	goVisits: number;
} {
	switch (strength) {
		case "fast":
			return { movetime: 200, goVisits: 50 };
		case "balanced":
			return { movetime: 500, goVisits: 200 };
		default:
			return { movetime: FULL_STRENGTH_MOVETIME, goVisits: 500 };
	}
}

// ── UCI Engine (Chess + Janggi) ──

export class UciGameEngine implements GameEngine {
	constructor(
		private pool: UciPool,
		private variant?: string,
	) {}

	async getAiMove(game: IGame, difficulty: string): Promise<string> {
		const tier = getTier(difficulty);
		const elo = getElo(difficulty);
		const movetime =
			game.variant === "janggi" ? (tier?.janggiMovetime ?? 500) : (tier?.chessMovetime ?? 500);
		const snapshot = game.getSnapshot();
		const result = await this.pool.search(
			snapshot.fen,
			movetime,
			1,
			this.variant,
			elo,
		);
		return result.bestmove;
	}

	async getSuggestions(
		game: IGame,
		count: number,
		strength: "fast" | "balanced" | "deep",
	): Promise<Suggestion[]> {
		if (count <= 0) return [];
		const { movetime } = strengthParams(strength);
		const snapshot = game.getSnapshot();
		const result = await this.pool.search(
			snapshot.fen,
			movetime,
			count,
			this.variant,
			null,
		);
		return result.info
			.filter((i) => i.pv.length > 0)
			.sort((a, b) => a.multipv - b.multipv)
			.slice(0, count)
			.map((info) => {
				const move = info.pv[0];
				// Try to convert to SAN via the game's extra data
				const san = (game.getSnapshot().extra as any)?.uciToSan?.(move) ?? move;
				return {
					move,
					san,
					score:
						info.mate !== null ? (info.mate > 0 ? 99999 : -99999) : info.score,
					depth: info.depth,
					pv: info.pv,
				};
			});
	}

	async evaluate(game: IGame, movetime = 1000): Promise<number> {
		const snapshot = game.getSnapshot();
		const result = await this.pool.search(
			snapshot.fen,
			movetime,
			1,
			this.variant,
			null,
		);
		const score = result.info[0]?.score ?? 0;
		const turn = game.turn;
		return turn === "white" ? score : -score;
	}

	async getWeakMove(game: IGame, elo: number): Promise<string> {
		const snapshot = game.getSnapshot();
		const result = await this.pool.search(
			snapshot.fen,
			200,
			1,
			this.variant,
			elo,
		);
		return result.bestmove;
	}
}

// ── KataGo Engine (Go) ──

export class KataGoGameEngine implements GameEngine {
	constructor(private kataGo: KataGoAdapter) {}

	async getAiMove(game: IGame, difficulty: string): Promise<string> {
		const tier = getTier(difficulty);
		const visits = tier?.goVisits ?? 200;
		const extra = game.getSnapshot().extra as {
			kataGoMoves?: [string, string][];
			size?: number;
		};
		const moves = extra.kataGoMoves ?? [];
		const color = game.turn === "black" ? "b" : "w";
		const size = extra.size ?? 19;
		return this.kataGo.getMove(moves, color, visits, size);
	}

	async getSuggestions(
		game: IGame,
		count: number,
		strength: "fast" | "balanced" | "deep",
	): Promise<Suggestion[]> {
		if (count <= 0) return [];
		const { goVisits } = strengthParams(strength);
		const extra = game.getSnapshot().extra as {
			kataGoMoves?: [string, string][];
			size?: number;
		};
		const moves = extra.kataGoMoves ?? [];
		const color = game.turn === "black" ? "b" : "w";
		const size = extra.size ?? 19;
		const results = await this.kataGo.analyze(moves, color, goVisits, count, size);
		return results.map((info) => ({
			move: info.move,
			san: info.move,
			score: Math.round(info.winrate * 10000 - 5000),
			depth: info.visits,
			pv: info.pv,
		}));
	}

	async evaluate(game: IGame): Promise<number> {
		const extra = game.getSnapshot().extra as {
			kataGoMoves?: [string, string][];
			size?: number;
		};
		const moves = extra.kataGoMoves ?? [];
		const color = game.turn === "black" ? "b" : "w";
		const size = extra.size ?? 19;
		const results = await this.kataGo.analyze(moves, color, 100, 1, size);
		if (results.length > 0) {
			return Math.round(results[0].winrate * 10000 - 5000);
		}
		return 0;
	}

	async getWeakMove(game: IGame, _elo: number): Promise<string> {
		// Go doesn't have Elo limiting — use low visits instead
		const extra = game.getSnapshot().extra as {
			kataGoMoves?: [string, string][];
			size?: number;
		};
		const moves = extra.kataGoMoves ?? [];
		const color = game.turn === "black" ? "b" : "w";
		const size = extra.size ?? 19;
		// Low visits ≈ weak play
		return this.kataGo.getMove(moves, color, 10, size);
	}
}

/** Create the appropriate engine for a game type. */
export function createGameEngine(
	gameType: GameType,
	uciPool: UciPool,
	kataGo: KataGoAdapter | null,
	useJanggiVariant = false,
): GameEngine {
	if (gameType === "go") {
		if (!kataGo) throw new Error("KataGo not available for Go games");
		return new KataGoGameEngine(kataGo);
	}
	const variant = gameType === "janggi" && useJanggiVariant ? "janggi" : undefined;
	return new UciGameEngine(uciPool, variant);
}
