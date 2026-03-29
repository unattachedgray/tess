import { randomUUID } from "node:crypto";
import type { DifficultyId, GameType } from "@tess/shared";
import type { KataGoAdapter } from "./engine/katago.js";
import type { UciPool } from "./engine/uciPool.js";
import { GameRoom } from "./gameRoom.js";
import { createLogger } from "./logger.js";

const log = createLogger("session");

export class SessionManager {
	private rooms = new Map<string, GameRoom>();

	constructor(
		private readonly chessPool: UciPool,
		private readonly janggiPool: UciPool | null,
		private readonly kataGo: KataGoAdapter | null,
	) {}

	createRoom(config: {
		gameType: GameType;
		difficulty: DifficultyId;
		playerColor: "white" | "black";
		boardSize?: number;
	}): GameRoom {
		const id = randomUUID().slice(0, 8);
		// Use Janggi pool if available, otherwise fall back to chess pool
		const uciPool =
			config.gameType === "janggi" && this.janggiPool ? this.janggiPool : this.chessPool;

		const room = new GameRoom({
			id,
			...config,
			uciPool,
			kataGo: this.kataGo,
			useJanggiVariant: config.gameType === "janggi" && !this.janggiPool,
		});

		this.rooms.set(id, room);
		log.info("room created", { id, gameType: config.gameType, difficulty: config.difficulty });
		return room;
	}

	getRoom(id: string): GameRoom | undefined {
		return this.rooms.get(id);
	}

	removeRoom(id: string): void {
		const room = this.rooms.get(id);
		room?.destroy();
		this.rooms.delete(id);
		log.info("room removed", { id });
	}

	get hasJanggiPool(): boolean { return !!this.janggiPool; }
	getChessPool(): UciPool { return this.chessPool; }
	getJanggiPool(): UciPool | null { return this.janggiPool; }

	get activeRoomCount(): number {
		return this.rooms.size;
	}

	/** Analyze a FEN position directly using the engine pool. For multiplayer. */
	async analyzeFen(
		gameType: GameType,
		fen: string,
		topN = 3,
		goMoves?: [string, string][],
		boardSize?: number,
		turn?: "white" | "black",
		movetime?: number,
		eloLimit?: number | null,
	): Promise<{ type: "SUGGESTIONS"; suggestions: Array<{ move: string; san?: string; score: number; depth: number; pv: string[] }> }> {
		if (gameType === "go") {
			if (!this.kataGo) return { type: "SUGGESTIONS", suggestions: [] };
			try {
				const turnColor = turn === "white" ? "w" : "b";
				const goTime = movetime ?? 800;
				const results = await this.kataGo.analyze(goMoves ?? [], turnColor, goTime, topN, boardSize ?? 19);
				// Never suggest pass in early/mid game
				const moveCount = (goMoves ?? []).length;
				const filtered = moveCount < 150
					? results.filter((info: any) => info.move?.toLowerCase() !== "pass")
					: results;
				const suggestions = (filtered.length > 0 ? filtered : results).slice(0, topN).map((info: any) => ({
					move: info.move,
					// Use scoreLead (points) * 100 for centipawn-equivalent.
					// scoreLead doesn't saturate like winrate, so ACPL works properly.
					score: Math.round((info.scoreLead ?? (info.winrate - 0.5) * 20) * 100),
					depth: info.visits ?? 0,
					pv: [info.move],
				}));
				return { type: "SUGGESTIONS", suggestions };
			} catch (err) {
				log.error("KataGo analysis failed", { error: (err as Error).message });
				return { type: "SUGGESTIONS", suggestions: [] };
			}
		}

		const pool = gameType === "janggi" && this.janggiPool ? this.janggiPool : this.chessPool;
		const variant = gameType === "janggi" ? "janggi" : undefined;

		const chessTime = movetime ?? 1000;
		try {
			const result = await pool.search(fen, chessTime, topN, variant, eloLimit);
			const suggestions = result.info
				.filter((info: any) => info.pv && info.pv.length > 0)
				.slice(0, topN)
				.map((info: any) => ({
					move: info.pv[0],
					score: info.score ?? 0,
					depth: info.depth ?? 0,
					pv: info.pv ?? [],
				}));
			return { type: "SUGGESTIONS", suggestions };
		} catch (err) {
			log.error("analyzeFen failed", { error: (err as Error).message });
			return { type: "SUGGESTIONS", suggestions: [] };
		}
	}
}
